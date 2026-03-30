import crypto from "node:crypto";
import type { Query, SDKMessage, SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  appendMessageToSession,
  backfillSessionMessageRunProvider,
  createSession,
  enqueueSessionPrompt,
  getSessionAgentConfig,
  getSessionClaudeThreadId,
  getSessionMessages,
  getSessionProjectPath,
  getSessionProjectServer,
  getSessionStatus,
  getStoredWorkspaceSettings,
  getWorkspacePayload,
  removeQueuedSessionPrompt,
  resolveWorkspaceSessionId,
  saveSessionAgentConfig,
  saveSessionClaudeThreadId,
  SESSION_STATUS_COMPLETED,
  SESSION_STATUS_PENDING,
  updateSessionStatus,
} from "@/lib/db";
import {
  resolveConfiguredClaudeProvider,
  resolveConfiguredClaudeProviderCandidates,
  resolveClaudeProviderLaunchConfig,
} from "@/lib/server/claude-provider-config";
import { publishWorkspaceRealtimeEvent } from "@/lib/server/realtime-events";
import {
  getWorkspaceClaudeProviderById,
  normalizeClaudeModel,
  type WorkspaceClaudeProvider,
} from "@/lib/settings";
import {
  normalizeSessionReasoningEffortForProjectServer,
  type WorkspaceAgentReasoningEffort,
} from "@/lib/session-agent";
import type { CodexBridgeEvent } from "@/lib/server/codex-bridge";
import {
  appendRunTranscriptText,
  type WorkspaceMessage,
  type WorkspaceMessageMetadata,
  type WorkspaceRunDetails,
  type WorkspaceRunItem,
  type WorkspaceRunTranscriptEntry,
  type WorkspaceRunUsage,
  upsertRunTranscriptItem,
} from "@/lib/workspace";

type ClaudeBridgeSource = "ui";
type ClaudeBridgeUsage = WorkspaceRunUsage | null;
const CLAUDE_DETAILED_OUTPUT_SYSTEM_PROMPT = [
  "请默认提供更详细、更完整的回答。",
  "先给出结论，再展开原因。",
  "尽量补充具体步骤、示例、边界情况与注意事项。",
  "如果存在多种可选方案，请明确说明差异与适用场景。",
].join("\n");

export type RunClaudePromptOptions = {
  prompt: string;
  sessionId?: number | null;
  projectId?: number | null;
  server?: string | null;
  model?: string | null;
  reasoningEffort?: WorkspaceAgentReasoningEffort | null;
  providerId?: string | null;
  skipQueueIfBusy?: boolean;
  queuedPromptId?: number | null;
  source?: ClaudeBridgeSource;
  onEvent?: (event: CodexBridgeEvent) => void;
};

export type RunClaudePromptResult = {
  status: "completed" | "queued" | "stopped";
  requestId: string;
  sessionId: number;
  providerId: string;
  model: string;
  reasoningEffort: WorkspaceAgentReasoningEffort;
  userMessage: WorkspaceMessage | null;
  assistantMessage: WorkspaceMessage | null;
  outputText: string;
  usage: ClaudeBridgeUsage;
  threadId: string | null;
  queuedPromptId?: number;
};

export type StopClaudeRunResult = {
  state: "stopping" | "stopped" | "idle";
  workspace?: ReturnType<typeof getWorkspacePayload>;
};

type ActiveClaudeRun = {
  requestId: string;
  sessionId: number;
  providerKey: string;
  abortController: AbortController;
  queryHandle: Query | null;
};

declare global {
  var __playcodeActiveClaudeRunsBySessionId:
    | Map<number, ActiveClaudeRun>
    | undefined;
  var __playcodeQueuedClaudeDrainPromise: Promise<void> | undefined;
}

function emitClaudeEvent(
  onEvent: RunClaudePromptOptions["onEvent"],
  event: CodexBridgeEvent,
) {
  publishWorkspaceRealtimeEvent(event);
  onEvent?.(event);
}

function publishWorkspaceSnapshot() {
  const workspace = getWorkspacePayload();

  publishWorkspaceRealtimeEvent({
    type: "workspace.snapshot",
    workspace,
  });

  return workspace;
}

function getActiveClaudeRunsBySessionId() {
  if (!globalThis.__playcodeActiveClaudeRunsBySessionId) {
    globalThis.__playcodeActiveClaudeRunsBySessionId = new Map();
  }

  return globalThis.__playcodeActiveClaudeRunsBySessionId;
}

function getActiveClaudeRun(sessionId: number) {
  return getActiveClaudeRunsBySessionId().get(sessionId) ?? null;
}

function countActiveClaudeRunsByProvider(providerKey: string) {
  return [...getActiveClaudeRunsBySessionId().values()].filter(
    (activeRun) => activeRun.providerKey === providerKey,
  ).length;
}

function registerActiveClaudeRun(
  run: ActiveClaudeRun,
  options: {
    maxConcurrentRuns: number;
    providerTitle: string;
  },
) {
  const activeRunsBySessionId = getActiveClaudeRunsBySessionId();

  if (activeRunsBySessionId.has(run.sessionId)) {
    throw new Error("当前会话正在执行中，请先停止当前运行。");
  }

  if (
    countActiveClaudeRunsByProvider(run.providerKey) >= options.maxConcurrentRuns
  ) {
    throw new Error(
      `Provider「${options.providerTitle}」已达到并发上限（${options.maxConcurrentRuns}），请稍后重试。`,
    );
  }

  activeRunsBySessionId.set(run.sessionId, run);
}

function unregisterActiveClaudeRun(sessionId: number, requestId: string) {
  const activeRunsBySessionId = getActiveClaudeRunsBySessionId();
  const activeRun = activeRunsBySessionId.get(sessionId);

  if (activeRun?.requestId === requestId) {
    activeRunsBySessionId.delete(sessionId);
  }
}

function getResolvedClaudeProviderRunIdentity(
  configuredProvider: WorkspaceClaudeProvider | null,
) {
  return {
    providerKey: configuredProvider?.id.trim() || "__default__",
    providerTitle: configuredProvider?.title.trim() || "默认环境",
  };
}

function resolveAvailableClaudeProviderForNewSession(
  storedSettings: ReturnType<typeof getStoredWorkspaceSettings>,
  preferredProviderId?: string | null,
) {
  const candidateProviders = resolveConfiguredClaudeProviderCandidates(
    storedSettings,
    preferredProviderId,
  );

  if (candidateProviders.length === 0) {
    return null;
  }

  return (
    candidateProviders.find((provider) => {
      const providerRunIdentity = getResolvedClaudeProviderRunIdentity(provider);

      return (
        countActiveClaudeRunsByProvider(providerRunIdentity.providerKey) <
        storedSettings.claudeProviderConcurrentSessionLimit
      );
    }) ?? null
  );
}

function getQueuedClaudePromptDrainCandidates() {
  return getWorkspacePayload()
    .projects
    .flatMap((project) =>
      project.sessions
        .filter((session) => session.server === "claude")
        .filter(
          (session) =>
            !session.isArchived && !getActiveClaudeRunsBySessionId().has(session.id),
        )
        .flatMap((session) =>
          session.queuedPrompts.map((queuedPrompt) => ({
            ...queuedPrompt,
            sessionId: session.id,
          })),
        ),
    )
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.createdAt);
      const rightTimestamp = Date.parse(right.createdAt);
      const normalizedLeftTimestamp = Number.isFinite(leftTimestamp)
        ? leftTimestamp
        : 0;
      const normalizedRightTimestamp = Number.isFinite(rightTimestamp)
        ? rightTimestamp
        : 0;

      return normalizedLeftTimestamp - normalizedRightTimestamp || left.id - right.id;
    });
}

async function drainQueuedClaudePromptQueue() {
  while (true) {
    const candidates = getQueuedClaudePromptDrainCandidates();

    if (candidates.length === 0) {
      return;
    }

    let startedRun = false;

    for (const queuedPrompt of candidates) {
      try {
        const result = await runClaudePrompt({
          prompt: queuedPrompt.content,
          sessionId: queuedPrompt.sessionId,
          model: queuedPrompt.model,
          reasoningEffort: queuedPrompt.reasoningEffort,
          skipQueueIfBusy: true,
          queuedPromptId: queuedPrompt.id,
          source: "ui",
        });

        if (result.status !== "queued") {
          startedRun = true;
          break;
        }
      } catch {
        startedRun = true;
        break;
      }
    }

    if (!startedRun) {
      return;
    }
  }
}

function scheduleQueuedClaudePromptDrain() {
  if (globalThis.__playcodeQueuedClaudeDrainPromise) {
    return globalThis.__playcodeQueuedClaudeDrainPromise;
  }

  const drainPromise = drainQueuedClaudePromptQueue().finally(() => {
    if (globalThis.__playcodeQueuedClaudeDrainPromise === drainPromise) {
      globalThis.__playcodeQueuedClaudeDrainPromise = undefined;
    }
  });

  globalThis.__playcodeQueuedClaudeDrainPromise = drainPromise;

  return drainPromise;
}

export function stopClaudeRun(sessionId: number): StopClaudeRunResult {
  const activeRun = getActiveClaudeRun(sessionId);

  if (activeRun) {
    activeRun.abortController.abort();
    const interruptPromise = activeRun.queryHandle?.interrupt();

    void interruptPromise?.catch(() => undefined);

    return {
      state: "stopping",
    };
  }

  const status = getSessionStatus(sessionId);

  if (status === null) {
    throw new Error("会话不存在。");
  }

  if (status === "进行中") {
    updateSessionStatus(sessionId, "已暂停");
    const workspace = publishWorkspaceSnapshot();
    void scheduleQueuedClaudePromptDrain();

    return {
      state: "stopped",
      workspace,
    };
  }

  return {
    state: "idle",
  };
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Claude 请求失败。";
}

function resolveSessionWorkingDirectory(sessionId: number) {
  const projectPath = getSessionProjectPath(sessionId);

  if (!projectPath) {
    throw new Error("当前会话未关联项目目录，无法启动 Claude。");
  }

  return projectPath;
}

function formatBootstrapMessage(message: WorkspaceMessage) {
  if (message.role === "user") {
    return `[用户]\n${message.content}`;
  }

  if (message.role === "assistant") {
    return `[助手]\n${message.content}`;
  }

  return `[系统]\n${message.content}`;
}

function buildThreadInput(messages: WorkspaceMessage[], hasSessionId: boolean) {
  if (messages.length === 0) {
    return "";
  }

  if (hasSessionId) {
    return messages[messages.length - 1]?.content ?? "";
  }

  if (messages.length === 1 && messages[0]?.role === "user") {
    return messages[0].content;
  }

  return [
    "以下是当前 Playcode 会话的历史记录，请把它们视为同一条 Claude 会话的上下文继续处理。",
    "请直接回应最后一条用户消息，不要完整复述整段历史。",
    messages.map(formatBootstrapMessage).join("\n\n"),
  ].join("\n\n");
}

function readNumericField(
  value: unknown,
  ...keys: string[]
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return 0;
  }

  for (const key of keys) {
    const candidateValue = (value as Record<string, unknown>)[key];

    if (typeof candidateValue === "number" && Number.isFinite(candidateValue)) {
      return candidateValue;
    }
  }

  return 0;
}

function mapUsage(usage?: unknown): ClaudeBridgeUsage {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const inputTokens =
    readNumericField(usage, "input_tokens", "inputTokens") +
    readNumericField(
      usage,
      "cache_creation_input_tokens",
      "cacheCreationInputTokens",
    );
  const cachedInputTokens = readNumericField(
    usage,
    "cache_read_input_tokens",
    "cacheReadInputTokens",
  );
  const outputTokens = readNumericField(usage, "output_tokens", "outputTokens");

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens + cachedInputTokens + outputTokens,
  };
}

function extractTextBlocks(content: unknown) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((block) => {
    if (!block || typeof block !== "object") {
      return [];
    }

    const textBlock = block as {
      type?: string;
      text?: string;
    };

    return textBlock.type === "text" && typeof textBlock.text === "string"
      ? [textBlock.text]
      : [];
  });
}

function extractAssistantText(message: SDKMessage) {
  if (message.type !== "assistant") {
    return "";
  }

  const content = extractTextBlocks(message.message?.content);

  return content.join("").trim();
}

function extractAssistantTextDelta(message: SDKPartialAssistantMessage) {
  const event = message.event as {
    type?: string;
    delta?: {
      type?: string;
      text?: string;
    };
    content_block?: {
      type?: string;
      text?: string;
    };
  };

  if (event.type === "content_block_delta") {
    return event.delta?.type === "text_delta" &&
      typeof event.delta.text === "string"
      ? event.delta.text
      : null;
  }

  if (event.type === "content_block_start") {
    return event.content_block?.type === "text" &&
      typeof event.content_block.text === "string"
      ? event.content_block.text
      : null;
  }

  return null;
}

function mapClaudeMessageToRunItem(message: SDKMessage): WorkspaceRunItem | null {
  if (message.type === "tool_progress") {
    return {
      id: `tool:${message.tool_use_id}`,
      type: "reasoning",
      text: `正在执行 ${message.tool_name}`,
    };
  }

  if (message.type === "tool_use_summary") {
    return {
      id: message.uuid,
      type: "reasoning",
      text: message.summary,
    };
  }

  if (message.type === "system" && message.subtype === "task_started") {
    return {
      id: `task:${message.task_id}`,
      type: "reasoning",
      text: message.description,
    };
  }

  if (message.type === "system" && message.subtype === "task_progress") {
    return {
      id: `task:${message.task_id}`,
      type: "reasoning",
      text: message.summary?.trim() || message.description,
    };
  }

  if (message.type === "system" && message.subtype === "task_notification") {
    return {
      id: `task:${message.task_id}`,
      type: "reasoning",
      text: message.summary.trim(),
    };
  }

  if (message.type === "system" && message.subtype === "local_command_output") {
    return {
      id: message.uuid,
      type: "reasoning",
      text: message.content,
    };
  }

  return null;
}

function upsertRunItem(
  runItemsById: Map<string, WorkspaceRunItem>,
  runItemOrder: string[],
  item: WorkspaceRunItem,
) {
  if (!runItemsById.has(item.id)) {
    runItemOrder.push(item.id);
  }

  runItemsById.set(item.id, item);
}

function buildOrderedRunItems(
  runItemsById: Map<string, WorkspaceRunItem>,
  runItemOrder: string[],
) {
  return runItemOrder.flatMap((itemId) => {
    const item = runItemsById.get(itemId);
    return item ? [item] : [];
  });
}

function buildRunMessageMetadata({
  requestId,
  startedAt,
  completedAt,
  durationMs,
  providerId,
  providerLabel,
  model,
  reasoningEffort,
  threadId,
  usage,
  items,
  transcript,
}: {
  requestId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  providerId: string;
  providerLabel: string;
  model: string;
  reasoningEffort: WorkspaceAgentReasoningEffort;
  threadId: string | null;
  usage: ClaudeBridgeUsage;
  items: WorkspaceRunItem[];
  transcript: WorkspaceRunTranscriptEntry[];
}): WorkspaceMessageMetadata {
  return {
    run: {
      requestId,
      startedAt,
      completedAt,
      durationMs,
      providerId,
      providerLabel,
      model,
      reasoningEffort,
      threadId,
      usage,
      items,
      transcript,
    } satisfies WorkspaceRunDetails,
  };
}

export async function runClaudePrompt({
  prompt,
  sessionId,
  projectId,
  server: requestedServer,
  model: requestedModel,
  reasoningEffort: requestedReasoningEffort,
  providerId: requestedProviderId,
  skipQueueIfBusy = false,
  queuedPromptId,
  source = "ui",
  onEvent,
}: RunClaudePromptOptions): Promise<RunClaudePromptResult> {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new Error("请输入要发送的内容。");
  }

  const requestId = crypto.randomUUID();
  const storedSettings = getStoredWorkspaceSettings();
  const hasEnabledClaudeProvider = storedSettings.claudeProviders.some(
    (provider) => provider.enabled,
  );
  let resolvedSessionId: number;
  let model = normalizeClaudeModel(requestedModel ?? storedSettings.claudeModel);
  let reasoningEffort =
    requestedReasoningEffort ??
    normalizeSessionReasoningEffortForProjectServer(
      "claude",
      storedSettings.claudeReasoningEffort,
    );
  const normalizedRequestedProviderId = requestedProviderId?.trim() ?? "";
  let createdSession = false;
  let savedSessionConfig: ReturnType<typeof getSessionAgentConfig> | null = null;
  let configuredProvider: WorkspaceClaudeProvider | null = null;
  let sessionProviderId = normalizedRequestedProviderId;

  if (typeof sessionId === "number") {
    resolvedSessionId = resolveWorkspaceSessionId(sessionId);
    const projectServer = getSessionProjectServer(resolvedSessionId);

    if (projectServer !== "claude") {
      throw new Error("当前会话不属于 Claude 项目。");
    }

    savedSessionConfig = getSessionAgentConfig(resolvedSessionId);
    sessionProviderId =
      normalizedRequestedProviderId || savedSessionConfig?.providerId || "";
    configuredProvider = resolveConfiguredClaudeProvider(
      storedSettings,
      sessionProviderId,
    );
    model = normalizeClaudeModel(requestedModel ?? savedSessionConfig?.model ?? model);
    reasoningEffort =
      requestedReasoningEffort ??
      savedSessionConfig?.reasoningEffort ??
      reasoningEffort;
  } else if (typeof projectId === "number") {
    sessionProviderId =
      normalizedRequestedProviderId ||
      storedSettings.selectedClaudeProviderId ||
      storedSettings.defaultClaudeProviderId ||
      "";
    configuredProvider = resolveAvailableClaudeProviderForNewSession(
      storedSettings,
      sessionProviderId,
    );

    if (
      !configuredProvider &&
      !hasEnabledClaudeProvider
    ) {
      throw new Error("当前没有启用的 Claude Provider，请先在系统设置中完成配置。");
    }

    resolvedSessionId = createSession({
      projectId,
      server: requestedServer,
      initialPrompt: trimmedPrompt,
      model,
      reasoningEffort: String(reasoningEffort),
      providerId: configuredProvider?.id ?? sessionProviderId,
      status: configuredProvider ? "进行中" : SESSION_STATUS_PENDING,
    }).id;
    createdSession = true;
  } else {
    resolvedSessionId = resolveWorkspaceSessionId(sessionId);
    const projectServer = getSessionProjectServer(resolvedSessionId);

    if (projectServer !== "claude") {
      throw new Error("当前会话不属于 Claude 项目。");
    }

    savedSessionConfig = getSessionAgentConfig(resolvedSessionId);
    sessionProviderId =
      normalizedRequestedProviderId || savedSessionConfig?.providerId || "";
    configuredProvider = resolveConfiguredClaudeProvider(
      storedSettings,
      sessionProviderId,
    );
    model = normalizeClaudeModel(requestedModel ?? savedSessionConfig?.model ?? model);
    reasoningEffort =
      requestedReasoningEffort ??
      savedSessionConfig?.reasoningEffort ??
      reasoningEffort;
  }

  if (!configuredProvider && !hasEnabledClaudeProvider) {
    throw new Error("当前没有启用的 Claude Provider，请先在系统设置中完成配置。");
  }

  const resolvedProviderId = configuredProvider?.id.trim() || sessionProviderId;
  const shouldPersistSessionConfig =
    !createdSession &&
    Boolean(
      requestedModel ||
        requestedReasoningEffort ||
        (normalizedRequestedProviderId &&
          normalizedRequestedProviderId !== savedSessionConfig?.providerId) ||
        (configuredProvider &&
          savedSessionConfig?.providerId !== resolvedProviderId),
    );

  if (shouldPersistSessionConfig) {
    if (
      savedSessionConfig?.providerId &&
      savedSessionConfig.providerId !== resolvedProviderId
    ) {
      const previousProvider = getWorkspaceClaudeProviderById(
        storedSettings.claudeProviders,
        savedSessionConfig.providerId,
      );

      backfillSessionMessageRunProvider({
        sessionId: resolvedSessionId,
        providerId: savedSessionConfig.providerId,
        providerLabel: previousProvider?.title.trim() || "默认环境",
      });
    }

    saveSessionAgentConfig({
      sessionId: resolvedSessionId,
      model,
      reasoningEffort: String(reasoningEffort),
      providerId: resolvedProviderId,
    });
  }

  if (createdSession || shouldPersistSessionConfig) {
    publishWorkspaceSnapshot();
  }

  const queuePrompt = (options?: {
    markPending?: boolean;
  }): RunClaudePromptResult => {
    const persistedQueuedPromptId =
      typeof queuedPromptId === "number"
        ? queuedPromptId
        : enqueueSessionPrompt({
            sessionId: resolvedSessionId,
            content: trimmedPrompt,
            model,
            reasoningEffort: String(reasoningEffort),
          }).id;

    if (
      options?.markPending &&
      getSessionStatus(resolvedSessionId) !== SESSION_STATUS_PENDING
    ) {
      updateSessionStatus(resolvedSessionId, SESSION_STATUS_PENDING);
    }

    if (!skipQueueIfBusy || options?.markPending) {
      publishWorkspaceSnapshot();
    }

    return {
      status: "queued",
      requestId,
      sessionId: resolvedSessionId,
      providerId: resolvedProviderId,
      model,
      reasoningEffort,
      userMessage: null,
      assistantMessage: null,
      outputText: "",
      usage: null,
      threadId: getSessionClaudeThreadId(resolvedSessionId),
      queuedPromptId: persistedQueuedPromptId,
    };
  };

  if (!createdSession && !skipQueueIfBusy && getActiveClaudeRun(resolvedSessionId)) {
    return queuePrompt();
  }

  const providerRunIdentity = configuredProvider
    ? getResolvedClaudeProviderRunIdentity(configuredProvider)
    : null;
  const hasAvailableProviderCapacity =
    configuredProvider !== null &&
    providerRunIdentity !== null &&
    countActiveClaudeRunsByProvider(providerRunIdentity.providerKey) <
      storedSettings.claudeProviderConcurrentSessionLimit;

  if (!configuredProvider || !providerRunIdentity || !hasAvailableProviderCapacity) {
    return queuePrompt({
      markPending: !getActiveClaudeRun(resolvedSessionId),
    });
  }

  const workingDirectory = resolveSessionWorkingDirectory(resolvedSessionId);
  const existingSessionId = getSessionClaudeThreadId(resolvedSessionId);
  let responseId = existingSessionId ?? "";
  let latestAssistantText = "";
  let finalResponse = "";
  let usage: ClaudeBridgeUsage = null;
  const runStartedAtMs = Date.now();
  const runStartedAt = new Date(runStartedAtMs).toISOString();
  const runItemsById = new Map<string, WorkspaceRunItem>();
  const runItemOrder: string[] = [];
  let runTranscript: WorkspaceRunTranscriptEntry[] = [];
  const abortController = new AbortController();
  let userMessage: WorkspaceMessage | null = null;
  const providerTitle = providerRunIdentity.providerTitle;

  registerActiveClaudeRun(
    {
      requestId,
      sessionId: resolvedSessionId,
      providerKey: providerRunIdentity.providerKey,
      abortController,
      queryHandle: null,
    },
    {
      maxConcurrentRuns: storedSettings.claudeProviderConcurrentSessionLimit,
      providerTitle: providerRunIdentity.providerTitle,
    },
  );

  try {
    if (typeof queuedPromptId === "number") {
      const removedSessionId = removeQueuedSessionPrompt(queuedPromptId);

      if (removedSessionId !== null) {
        publishWorkspaceSnapshot();
      }
    }

    userMessage = appendMessageToSession({
      sessionId: resolvedSessionId,
      role: "user",
      content: trimmedPrompt,
    });

    emitClaudeEvent(onEvent, {
      type: "workspace.message.created",
      source,
      sessionId: resolvedSessionId,
      message: userMessage,
    });

    const launchConfig = resolveClaudeProviderLaunchConfig(configuredProvider);

    const sessionMessages = getSessionMessages(resolvedSessionId);
    const input = buildThreadInput(sessionMessages, Boolean(existingSessionId));

    const queryHandle = query({
      prompt: input,
      options: {
        abortController,
        allowDangerouslySkipPermissions: true,
        cwd: workingDirectory,
        env: launchConfig.env,
        effort:
          reasoningEffort === "max" ||
          reasoningEffort === "high" ||
          reasoningEffort === "medium" ||
          reasoningEffort === "low"
            ? reasoningEffort
            : "medium",
        includePartialMessages: true,
        model,
        permissionMode: "bypassPermissions",
        resume: existingSessionId ?? undefined,
        settingSources: ["project", "local"],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: CLAUDE_DETAILED_OUTPUT_SYSTEM_PROMPT,
        },
      },
    });
    const activeRun = getActiveClaudeRun(resolvedSessionId);

    if (activeRun?.requestId === requestId) {
      activeRun.queryHandle = queryHandle;
    }

    emitClaudeEvent(onEvent, {
      type: "codex.run.started",
      source,
      requestId,
      sessionId: resolvedSessionId,
      model,
      reasoningEffort,
    });

    for await (const message of queryHandle) {
      responseId = message.session_id || responseId;

      if (message.type === "stream_event") {
        const delta = extractAssistantTextDelta(message);

        if (delta) {
          latestAssistantText += delta;
          runTranscript = appendRunTranscriptText(runTranscript, delta);
          emitClaudeEvent(onEvent, {
            type: "codex.run.delta",
            source,
            requestId,
            sessionId: resolvedSessionId,
            delta,
          });
        }

        continue;
      }

      const runItem = mapClaudeMessageToRunItem(message);

      if (runItem) {
        upsertRunItem(runItemsById, runItemOrder, runItem);
        runTranscript = upsertRunTranscriptItem(runTranscript, runItem);
        emitClaudeEvent(onEvent, {
          type: "codex.run.item.updated",
          source,
          requestId,
          sessionId: resolvedSessionId,
          item: runItem,
        });
      }

      if (message.type === "assistant") {
        const assistantText = extractAssistantText(message);

        if (assistantText) {
          finalResponse = assistantText;
        }

        continue;
      }

      if (message.type === "result") {
        usage = mapUsage(message.usage);

        if (message.subtype === "success" && !finalResponse.trim()) {
          finalResponse = message.result.trim();
        }

        continue;
      }
    }

    const threadId = responseId || null;
    const finalOutputText =
      finalResponse.trim() || latestAssistantText.trim() || "Claude 未返回文本内容。";
    const runItems = buildOrderedRunItems(runItemsById, runItemOrder);
    const runCompletedAtMs = Date.now();
    const runCompletedAt = new Date(runCompletedAtMs).toISOString();
    const runDurationMs = Math.max(runCompletedAtMs - runStartedAtMs, 0);
    const assistantMessage = appendMessageToSession({
      sessionId: resolvedSessionId,
      role: "assistant",
      content: finalOutputText,
      model,
      reasoningEffort: String(reasoningEffort),
      runDurationMs,
      metadata: buildRunMessageMetadata({
        requestId,
        startedAt: runStartedAt,
        completedAt: runCompletedAt,
        durationMs: runDurationMs,
        providerId: resolvedProviderId,
        providerLabel: providerTitle,
        model,
        reasoningEffort,
        threadId,
        usage,
        items: runItems,
        transcript: runTranscript,
      }),
      setActive: false,
      markUnread: true,
    });
    updateSessionStatus(resolvedSessionId, "已完成");

    if (threadId) {
      saveSessionClaudeThreadId(resolvedSessionId, threadId);
    }

    emitClaudeEvent(onEvent, {
      type: "workspace.message.created",
      source,
      sessionId: resolvedSessionId,
      message: assistantMessage,
    });
    emitClaudeEvent(onEvent, {
      type: "codex.run.completed",
      source,
      requestId,
      sessionId: resolvedSessionId,
      model,
      reasoningEffort,
      threadId,
      outputText: finalOutputText,
      usage,
      message: assistantMessage,
    });

    return {
      status: "completed",
      requestId,
      sessionId: resolvedSessionId,
      providerId: resolvedProviderId,
      model,
      reasoningEffort,
      userMessage,
      assistantMessage,
      outputText: finalOutputText,
      usage,
      threadId,
    };
  } catch (error) {
    const threadId = responseId || null;
    const finalOutputText = finalResponse.trim() || latestAssistantText.trim();
    const runItems = buildOrderedRunItems(runItemsById, runItemOrder);
    const runCompletedAtMs = Date.now();
    const runCompletedAt = new Date(runCompletedAtMs).toISOString();
    const runDurationMs = Math.max(runCompletedAtMs - runStartedAtMs, 0);

    if (threadId) {
      saveSessionClaudeThreadId(resolvedSessionId, threadId);
    }

    if (abortController.signal.aborted) {
      const stoppedMessage =
        finalOutputText || runItems.length > 0
          ? appendMessageToSession({
              sessionId: resolvedSessionId,
              role: finalOutputText ? "assistant" : "system",
              content: finalOutputText || "本次运行已手动停止。",
              model,
              reasoningEffort: String(reasoningEffort),
              runDurationMs,
              metadata: buildRunMessageMetadata({
                requestId,
                startedAt: runStartedAt,
                completedAt: runCompletedAt,
                durationMs: runDurationMs,
                providerId: resolvedProviderId,
                providerLabel: providerTitle,
                model,
                reasoningEffort,
                threadId,
                usage,
                items: runItems,
                transcript: runTranscript,
              }),
              setActive: false,
              markUnread: true,
            })
          : null;

      updateSessionStatus(resolvedSessionId, "已暂停");

      if (stoppedMessage) {
        emitClaudeEvent(onEvent, {
          type: "workspace.message.created",
          source,
          sessionId: resolvedSessionId,
          message: stoppedMessage,
        });
      }

      emitClaudeEvent(onEvent, {
        type: "codex.run.stopped",
        source,
        requestId,
        sessionId: resolvedSessionId,
        model,
        reasoningEffort,
        threadId,
        outputText: finalOutputText,
        usage,
        message: stoppedMessage ?? undefined,
      });

      return {
        status: "stopped",
        requestId,
        sessionId: resolvedSessionId,
        providerId: resolvedProviderId,
        model,
        reasoningEffort,
        userMessage,
        assistantMessage: stoppedMessage,
        outputText: finalOutputText,
        usage,
        threadId,
      };
    }

    const errorMessage = normalizeErrorMessage(error);
    const systemMessage = appendMessageToSession({
      sessionId: resolvedSessionId,
      role: "system",
      content: `Claude 请求失败：${errorMessage}`,
      model,
      reasoningEffort: String(reasoningEffort),
      runDurationMs,
      metadata: buildRunMessageMetadata({
        requestId,
        startedAt: runStartedAt,
        completedAt: runCompletedAt,
        durationMs: runDurationMs,
        providerId: resolvedProviderId,
        providerLabel: providerTitle,
        model,
        reasoningEffort,
        threadId,
        usage,
        items: runItems,
        transcript: runTranscript,
      }),
      setActive: false,
      markUnread: true,
    });
    updateSessionStatus(resolvedSessionId, "失败");

    emitClaudeEvent(onEvent, {
      type: "workspace.message.created",
      source,
      sessionId: resolvedSessionId,
      message: systemMessage,
    });
    emitClaudeEvent(onEvent, {
      type: "codex.run.failed",
      source,
      requestId,
      sessionId: resolvedSessionId,
      model,
      reasoningEffort,
      error: errorMessage,
      message: systemMessage,
    });

    throw new Error(errorMessage);
  } finally {
    const activeRun = getActiveClaudeRun(resolvedSessionId);
    activeRun?.queryHandle?.close();
    unregisterActiveClaudeRun(resolvedSessionId, requestId);
    void scheduleQueuedClaudePromptDrain();
  }
}

export function scheduleClaudeQueuedPromptDrain() {
  return scheduleQueuedClaudePromptDrain();
}

export function markClaudeSessionCompletedIfIdle(sessionId: number) {
  if (getActiveClaudeRun(sessionId)) {
    return;
  }

  if (getSessionStatus(sessionId) === "进行中") {
    updateSessionStatus(sessionId, SESSION_STATUS_COMPLETED);
  }
}
