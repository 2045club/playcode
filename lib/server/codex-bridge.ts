import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import type {
  ModelReasoningEffort,
  ThreadEvent,
  ThreadItem,
  Usage,
} from "@openai/codex-sdk";
import {
  appendMessageToSession,
  backfillSessionMessageRunProvider,
  createSession,
  enqueueSessionPrompt,
  getSessionAgentConfig,
  getSessionCodexThreadId,
  getSessionMessages,
  getSessionProjectPath,
  getSessionStatus,
  getStoredWorkspaceSettings,
  getWorkspacePayload,
  removeQueuedSessionPrompt,
  resolveWorkspaceSessionId,
  saveSessionAgentConfig,
  saveSessionCodexThreadId,
  SESSION_STATUS_PENDING,
  updateSessionStatus,
} from "@/lib/db";
import {
  resolveConfiguredCodexProvider,
  resolveConfiguredCodexProviderCandidates,
  resolveCodexProviderLaunchConfig,
} from "@/lib/server/codex-provider-config";
import { resolveCodexSandboxMode } from "@/lib/server/codex-sandbox";
import { publishWorkspaceRealtimeEvent } from "@/lib/server/realtime-events";
import {
  getWorkspaceCodexProviderById,
  type WorkspaceCodexProvider,
  type WorkspaceSettings,
} from "@/lib/settings";
import {
  DEFAULT_WORKSPACE_REASONING_EFFORT,
  appendRunTranscriptText,
  normalizeReasoningEffort,
  normalizeWorkspaceModel,
  type WorkspaceMessage,
  type WorkspaceMessageMetadata,
  type WorkspaceRunDetails,
  type WorkspaceRunItem,
  type WorkspaceRunTranscriptEntry,
  type WorkspaceRunUsage,
  type WorkspaceReasoningEffort,
  upsertRunTranscriptItem,
} from "@/lib/workspace";

const DEFAULT_CODEX_MODEL =
  normalizeWorkspaceModel(process.env.CODEX_BRIDGE_MODEL?.trim());
const DEFAULT_CODEX_REASONING_EFFORT = normalizeReasoningEffort(
  process.env.CODEX_BRIDGE_REASONING_EFFORT?.trim() ??
    DEFAULT_WORKSPACE_REASONING_EFFORT,
);

type CodexBridgeSource = "ui";

type CodexBridgeUsage = WorkspaceRunUsage | null;

export type CodexBridgeEvent =
  | {
      type: "workspace.message.created";
      source: CodexBridgeSource;
      sessionId: number;
      message: WorkspaceMessage;
    }
  | {
      type: "codex.run.started";
      source: CodexBridgeSource;
      requestId: string;
      sessionId: number;
      model: string;
      reasoningEffort: WorkspaceReasoningEffort;
    }
  | {
      type: "codex.run.delta";
      source: CodexBridgeSource;
      requestId: string;
      sessionId: number;
      delta: string;
    }
  | {
      type: "codex.run.item.updated";
      source: CodexBridgeSource;
      requestId: string;
      sessionId: number;
      item: WorkspaceRunItem;
    }
  | {
      type: "codex.run.completed";
      source: CodexBridgeSource;
      requestId: string;
      sessionId: number;
      model: string;
      reasoningEffort: WorkspaceReasoningEffort;
      threadId: string | null;
      outputText: string;
      usage: CodexBridgeUsage;
      message: WorkspaceMessage;
    }
  | {
      type: "codex.run.failed";
      source: CodexBridgeSource;
      requestId: string;
      sessionId: number;
      model: string;
      reasoningEffort: WorkspaceReasoningEffort;
      error: string;
      message?: WorkspaceMessage;
    }
  | {
      type: "codex.run.stopped";
      source: CodexBridgeSource;
      requestId: string;
      sessionId: number;
      model: string;
      reasoningEffort: WorkspaceReasoningEffort;
      threadId: string | null;
      outputText: string;
      usage: CodexBridgeUsage;
      message?: WorkspaceMessage;
    };

export type RunCodexPromptOptions = {
  prompt: string;
  sessionId?: number | null;
  projectId?: number | null;
  server?: string | null;
  model?: string | null;
  reasoningEffort?: ModelReasoningEffort | null;
  providerId?: string | null;
  skipQueueIfBusy?: boolean;
  queuedPromptId?: number | null;
  source?: CodexBridgeSource;
  onEvent?: (event: CodexBridgeEvent) => void;
};

export type RunCodexPromptResult = {
  status: "completed" | "queued" | "stopped";
  requestId: string;
  sessionId: number;
  providerId: string;
  model: string;
  reasoningEffort: ModelReasoningEffort;
  userMessage: WorkspaceMessage | null;
  assistantMessage: WorkspaceMessage | null;
  outputText: string;
  usage: CodexBridgeUsage;
  threadId: string | null;
  queuedPromptId?: number;
};

export type StopCodexRunResult = {
  state: "stopping" | "stopped" | "idle";
  workspace?: ReturnType<typeof getWorkspacePayload>;
};

type ActiveCodexRun = {
  requestId: string;
  sessionId: number;
  providerKey: string;
  abortController: AbortController;
};

function emitCodexEvent(
  onEvent: RunCodexPromptOptions["onEvent"],
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

declare global {
  var __playcodeActiveCodexRunsBySessionId:
    | Map<number, ActiveCodexRun>
    | undefined;
  var __playcodeQueuedCodexDrainPromise: Promise<void> | undefined;
}

function getActiveCodexRunsBySessionId() {
  if (!globalThis.__playcodeActiveCodexRunsBySessionId) {
    globalThis.__playcodeActiveCodexRunsBySessionId = new Map();
  }

  return globalThis.__playcodeActiveCodexRunsBySessionId;
}

function getActiveCodexRun(sessionId: number) {
  return getActiveCodexRunsBySessionId().get(sessionId) ?? null;
}

function countActiveCodexRunsByProvider(providerKey: string) {
  return [...getActiveCodexRunsBySessionId().values()].filter(
    (activeRun) => activeRun.providerKey === providerKey,
  ).length;
}

function registerActiveCodexRun(
  run: ActiveCodexRun,
  options: {
    maxConcurrentRuns: number;
    providerTitle: string;
  },
) {
  const activeRunsBySessionId = getActiveCodexRunsBySessionId();

  if (activeRunsBySessionId.has(run.sessionId)) {
    throw new Error("当前会话正在执行中，请先停止当前运行。");
  }

  if (
    countActiveCodexRunsByProvider(run.providerKey) >= options.maxConcurrentRuns
  ) {
    throw new Error(
      `Provider「${options.providerTitle}」最多只能同时执行 ${options.maxConcurrentRuns} 个会话，请稍后再试。`,
    );
  }

  activeRunsBySessionId.set(run.sessionId, run);
}

function unregisterActiveCodexRun(sessionId: number, requestId: string) {
  const activeRunsBySessionId = getActiveCodexRunsBySessionId();
  const activeRun = activeRunsBySessionId.get(sessionId);

  if (activeRun?.requestId === requestId) {
    activeRunsBySessionId.delete(sessionId);
  }
}

function getQueuedPromptDrainCandidates() {
  return getWorkspacePayload()
    .projects
    .flatMap((project) =>
      project.sessions
        .filter((session) => session.server === "codex")
        .filter(
          (session) =>
            !session.isArchived && !getActiveCodexRunsBySessionId().has(session.id),
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

async function drainQueuedPromptQueue() {
  while (true) {
    const candidates = getQueuedPromptDrainCandidates();

    if (candidates.length === 0) {
      return;
    }

    let startedRun = false;

    for (const queuedPrompt of candidates) {
      try {
        const result = await runCodexPrompt({
          prompt: queuedPrompt.content,
          sessionId: queuedPrompt.sessionId,
          model: queuedPrompt.model,
          reasoningEffort: normalizeReasoningEffort(queuedPrompt.reasoningEffort),
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

function scheduleQueuedPromptDrain() {
  if (globalThis.__playcodeQueuedCodexDrainPromise) {
    return globalThis.__playcodeQueuedCodexDrainPromise;
  }

  const drainPromise = drainQueuedPromptQueue().finally(() => {
    if (globalThis.__playcodeQueuedCodexDrainPromise === drainPromise) {
      globalThis.__playcodeQueuedCodexDrainPromise = undefined;
    }
  });

  globalThis.__playcodeQueuedCodexDrainPromise = drainPromise;

  return drainPromise;
}

export function stopCodexRun(sessionId: number): StopCodexRunResult {
  const activeRun = getActiveCodexRun(sessionId);

  if (activeRun) {
    activeRun.abortController.abort();

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
    void scheduleQueuedPromptDrain();

    return {
      state: "stopped",
      workspace,
    };
  }

  return {
    state: "idle",
  };
}

function getResolvedProviderRunIdentity(
  configuredProvider: WorkspaceCodexProvider | null,
) {
  return {
    providerKey: configuredProvider?.id.trim() || "__default__",
    providerTitle: configuredProvider?.title.trim() || "默认环境",
  };
}

function resolveAvailableProviderForNewSession(
  storedSettings: WorkspaceSettings,
  preferredProviderId?: string | null,
) {
  const candidateProviders = resolveConfiguredCodexProviderCandidates(
    storedSettings,
    preferredProviderId,
  );

  if (candidateProviders.length === 0) {
    return null;
  }

  const availableProvider =
    candidateProviders.find((provider) => {
      const providerRunIdentity = getResolvedProviderRunIdentity(provider);

      return (
        countActiveCodexRunsByProvider(providerRunIdentity.providerKey) <
        storedSettings.codexProviderConcurrentSessionLimit
      );
    }) ?? null;

  return availableProvider;
}

function resolveCodexPathOverride() {
  const overridePath = process.env.CODEX_CLI_PATH?.trim();

  return overridePath ? overridePath : undefined;
}

async function createCodexClient(
  launchConfig: ReturnType<typeof resolveCodexProviderLaunchConfig>,
) {
  const { Codex } = await import("@openai/codex-sdk");
  const codexOptions = {
    apiKey: launchConfig.apiKey,
    config: launchConfig.config,
    env: launchConfig.env,
    codexPathOverride: resolveCodexPathOverride(),
  };

  // console.log(
  //   `[codex.run] Creating Codex client\n${inspectValueForConsoleLog(codexOptions)}`,
  // );

  return new Codex(codexOptions);
}

function logCodexLaunchConfig({
  requestId,
  source,
  sessionId,
  providerId,
  providerTitle,
  model,
  modelProvider,
  baseUrl,
  apiKey,
  sandboxMode,
}: {
  requestId: string;
  source: CodexBridgeSource;
  sessionId: number;
  providerId: string;
  providerTitle: string;
  model: string;
  modelProvider: string;
  baseUrl: string;
  apiKey: string;
  sandboxMode?: string | null;
}) {
  console.log("[codex.run] Launching request", {
    requestId,
    source,
    sessionId,
    providerId,
    providerTitle,
    model,
    modelProvider,
    baseUrl,
    apiKey,
    sandboxMode,
  });
}

function inspectValueForConsoleLog(value: unknown) {
  return inspect(value, {
    depth: null,
    colors: false,
    compact: false,
  });
}

function logCodexErrorDetails(label: string, payload: unknown) {
  console.log(`${label}\n${inspectValueForConsoleLog(payload)}`);
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

function buildThreadInput(messages: WorkspaceMessage[], hasThreadId: boolean) {
  if (messages.length === 0) {
    return "";
  }

  if (hasThreadId) {
    return messages[messages.length - 1]?.content ?? "";
  }

  if (messages.length === 1 && messages[0]?.role === "user") {
    return messages[0].content;
  }

  return [
    "以下是当前 Playcode 会话的历史记录，请把它们视为同一条 Codex 线程的上下文继续处理。",
    "请直接回应最后一条用户消息，不要完整复述整段历史。",
    messages.map(formatBootstrapMessage).join("\n\n"),
  ].join("\n\n");
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Codex 请求失败。";
}

function resolveSessionWorkingDirectory(sessionId: number) {
  const projectPath = getSessionProjectPath(sessionId);

  if (!projectPath) {
    throw new Error("当前会话未关联项目目录，无法启动 Codex。");
  }

  const workingDirectory = path.resolve(projectPath);

  if (!fs.existsSync(workingDirectory)) {
    throw new Error(`当前项目目录不存在：${workingDirectory}`);
  }

  return workingDirectory;
}

function mapUsage(usage?: Usage | null): CodexBridgeUsage {
  if (!usage) {
    return null;
  }

  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
  };
}

function summarizeUnknownValue(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

function summarizeMcpToolResult(
  result: {
    content: Array<{
      type?: string;
      text?: string;
    }>;
    structured_content: unknown;
  } | undefined,
) {
  if (!result) {
    return null;
  }

  const textContent = result.content
    .map((item) => (typeof item.text === "string" ? item.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (textContent) {
    return textContent;
  }

  const structuredSummary = summarizeUnknownValue(
    result.structured_content,
    "",
  ).trim();

  return structuredSummary || null;
}

type ExtractedSourceLink = {
  title: string | null;
  url: string;
  hostname: string;
};

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^www\./, "");
}

function extractSourceLinks(content: string) {
  const extractedLinks: ExtractedSourceLink[] = [];
  const seenUrls = new Set<string>();

  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

  for (const match of content.matchAll(markdownLinkPattern)) {
    const [, rawTitle, rawUrl] = match;

    if (!rawUrl || seenUrls.has(rawUrl)) {
      continue;
    }

    try {
      const parsedUrl = new URL(rawUrl);
      extractedLinks.push({
        title: rawTitle?.trim() || null,
        url: rawUrl,
        hostname: parsedUrl.hostname,
      });
      seenUrls.add(rawUrl);
    } catch {
      continue;
    }
  }

  const bareUrlPattern = /https?:\/\/[^\s)]+/g;

  for (const match of content.matchAll(bareUrlPattern)) {
    const rawUrl = match[0];

    if (!rawUrl || seenUrls.has(rawUrl)) {
      continue;
    }

    try {
      const parsedUrl = new URL(rawUrl);
      extractedLinks.push({
        title: null,
        url: rawUrl,
        hostname: parsedUrl.hostname,
      });
      seenUrls.add(rawUrl);
    } catch {
      continue;
    }
  }

  return extractedLinks;
}

function extractQueryDomainHints(query: string) {
  const domainHints = new Set<string>();

  for (const match of query.matchAll(/site:([^\s]+)/gi)) {
    const rawDomain = match[1]?.trim();

    if (!rawDomain) {
      continue;
    }

    const normalizedDomain = rawDomain
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .trim();

    if (normalizedDomain) {
      domainHints.add(normalizeHostname(normalizedDomain));
    }
  }

  return [...domainHints];
}

function extractQueryTokens(query: string) {
  const stopTokens = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "news",
    "site",
  ]);

  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) =>
      token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.:/-]+$/gu, ""),
    )
    .filter(
      (token) =>
        token &&
        !token.startsWith("site:") &&
        !stopTokens.has(token) &&
        (token.length >= 3 || /[\u4e00-\u9fff]/u.test(token)),
    );
}

function resolveWebSearchLink(
  query: string,
  sourceLinks: ExtractedSourceLink[],
) {
  const domainHints = extractQueryDomainHints(query);

  if (domainHints.length > 0) {
    const matchingDomainLink = sourceLinks.find((link) => {
      const normalizedLinkHostname = normalizeHostname(link.hostname);

      return domainHints.some(
        (domainHint) =>
          normalizedLinkHostname === domainHint ||
          normalizedLinkHostname.endsWith(`.${domainHint}`) ||
          domainHint.endsWith(`.${normalizedLinkHostname}`),
      );
    });

    if (matchingDomainLink) {
      return {
        title: matchingDomainLink.title || query,
        url: matchingDomainLink.url,
      };
    }
  }

  const queryTokens = extractQueryTokens(query);

  if (queryTokens.length > 0) {
    const rankedLink = sourceLinks
      .map((link) => {
        const haystack = `${link.title ?? ""} ${link.url}`.toLowerCase();
        const score = queryTokens.reduce(
          (currentScore, token) =>
            haystack.includes(token) ? currentScore + 1 : currentScore,
          0,
        );

        return {
          link,
          score,
        };
      })
      .sort((left, right) => right.score - left.score)[0];

    if (rankedLink && rankedLink.score > 0) {
      return {
        title: rankedLink.link.title || query,
        url: rankedLink.link.url,
      };
    }
  }

  return {
    title: query,
    url: null,
  };
}

function enrichWebSearchRunItems(
  items: WorkspaceRunItem[],
  content: string,
) {
  const sourceLinks = extractSourceLinks(content);

  return items.map((item) => {
    if (item.type !== "web_search") {
      return item;
    }

    const resolvedLink = resolveWebSearchLink(item.query, sourceLinks);

    return {
      ...item,
      title: resolvedLink.title,
      url: resolvedLink.url,
    } satisfies WorkspaceRunItem;
  });
}

function enrichRunTranscriptEntries(
  transcript: WorkspaceRunTranscriptEntry[],
  items: WorkspaceRunItem[],
) {
  const itemsById = new Map(items.map((item) => [item.id, item]));

  return transcript.map((entry) => {
    if (entry.type !== "item") {
      return entry;
    }

    const nextItem = itemsById.get(entry.item.id);

    return nextItem
      ? ({
          type: "item",
          item: nextItem,
        } satisfies WorkspaceRunTranscriptEntry)
      : entry;
  });
}

function mapThreadItemToWorkspaceRunItem(
  item: ThreadItem,
  eventType?: "item.started" | "item.updated" | "item.completed",
): WorkspaceRunItem | null {
  switch (item.type) {
    case "agent_message":
      return null;
    case "reasoning":
      return {
        id: item.id,
        type: "reasoning",
        text: item.text,
      };
    case "command_execution":
      return {
        id: item.id,
        type: "command_execution",
        command: item.command,
        aggregatedOutput: item.aggregated_output,
        exitCode: item.exit_code ?? null,
        status: item.status,
      };
    case "file_change":
      return {
        id: item.id,
        type: "file_change",
        changes: item.changes,
        status: item.status,
      };
    case "mcp_tool_call":
      return {
        id: item.id,
        type: "mcp_tool_call",
        server: item.server,
        tool: item.tool,
        argumentsSummary: summarizeUnknownValue(item.arguments, ""),
        resultSummary: summarizeMcpToolResult(item.result),
        errorMessage: item.error?.message ?? null,
        status: item.status,
      };
    case "web_search":
      return {
        id: item.id,
        type: "web_search",
        query: item.query,
        title: item.query,
        url: null,
        status: eventType === "item.completed" ? "completed" : "in_progress",
      };
    case "todo_list":
      return {
        id: item.id,
        type: "todo_list",
        items: item.items,
      };
    case "error":
      return {
        id: item.id,
        type: "error",
        message: item.message,
      };
    default:
      return null;
  }
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
  reasoningEffort: ReturnType<typeof normalizeReasoningEffort>;
  threadId: string | null;
  usage: CodexBridgeUsage;
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

function resolveAgentTextDelta(
  event: ThreadEvent,
  previousText: string,
) {
  if (
    (event.type !== "item.updated" && event.type !== "item.completed") ||
    event.item.type !== "agent_message"
  ) {
    return null;
  }

  const nextText = event.item.text;
  const delta = nextText.startsWith(previousText)
    ? nextText.slice(previousText.length)
    : nextText;

  return {
    nextText,
    delta,
  };
}

export async function runCodexPrompt({
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
}: RunCodexPromptOptions): Promise<RunCodexPromptResult> {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new Error("请输入要发送的内容。");
  }

  const requestId = crypto.randomUUID();
  const requestedModelValue = normalizeWorkspaceModel(
    requestedModel ?? DEFAULT_CODEX_MODEL,
  );
  const requestedReasoningEffortValue = normalizeReasoningEffort(
    requestedReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT,
  );
  const normalizedRequestedProviderId = requestedProviderId?.trim() ?? "";
  const storedSettings = getStoredWorkspaceSettings();
  let resolvedSessionId: number;
  let model = requestedModelValue;
  let reasoningEffort = requestedReasoningEffortValue;
  let createdSession = false;
  let savedSessionConfig: ReturnType<typeof getSessionAgentConfig> | null = null;
  let configuredProvider: WorkspaceCodexProvider | null = null;
  let sessionProviderId = normalizedRequestedProviderId;

  if (typeof sessionId === "number") {
    resolvedSessionId = resolveWorkspaceSessionId(sessionId);
    savedSessionConfig = getSessionAgentConfig(resolvedSessionId);
    sessionProviderId = normalizedRequestedProviderId || savedSessionConfig?.providerId || "";
    configuredProvider = resolveConfiguredCodexProvider(
      storedSettings,
      sessionProviderId,
    );

    model = normalizeWorkspaceModel(
      requestedModel ?? savedSessionConfig?.model ?? DEFAULT_CODEX_MODEL,
    );
    reasoningEffort = normalizeReasoningEffort(
      requestedReasoningEffort ??
        savedSessionConfig?.reasoningEffort ??
        DEFAULT_CODEX_REASONING_EFFORT,
    );
  } else if (typeof projectId === "number") {
    sessionProviderId =
      normalizedRequestedProviderId ||
      storedSettings.selectedCodexProviderId ||
      storedSettings.defaultCodexProviderId ||
      "";
    configuredProvider = resolveAvailableProviderForNewSession(
      storedSettings,
      sessionProviderId,
    );
    resolvedSessionId = createSession({
      projectId,
      server: requestedServer,
      initialPrompt: trimmedPrompt,
      model: requestedModelValue,
      reasoningEffort: requestedReasoningEffortValue,
      providerId: configuredProvider?.id ?? sessionProviderId,
      status: configuredProvider ? "进行中" : SESSION_STATUS_PENDING,
    }).id;
    model = requestedModelValue;
    reasoningEffort = requestedReasoningEffortValue;
    createdSession = true;
  } else {
    resolvedSessionId = resolveWorkspaceSessionId(sessionId);
    savedSessionConfig = getSessionAgentConfig(resolvedSessionId);
    sessionProviderId = normalizedRequestedProviderId || savedSessionConfig?.providerId || "";
    configuredProvider = resolveConfiguredCodexProvider(
      storedSettings,
      sessionProviderId,
    );

    model = normalizeWorkspaceModel(
      requestedModel ?? savedSessionConfig?.model ?? DEFAULT_CODEX_MODEL,
    );
    reasoningEffort = normalizeReasoningEffort(
      requestedReasoningEffort ??
        savedSessionConfig?.reasoningEffort ??
        DEFAULT_CODEX_REASONING_EFFORT,
    );
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
      const previousProvider = getWorkspaceCodexProviderById(
        storedSettings.codexProviders,
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
      reasoningEffort,
      providerId: resolvedProviderId,
    });
  }

  if (createdSession || shouldPersistSessionConfig) {
    publishWorkspaceSnapshot();
  }

  const queuePrompt = (options?: {
    markPending?: boolean;
  }): RunCodexPromptResult => {
    const persistedQueuedPromptId =
      typeof queuedPromptId === "number"
        ? queuedPromptId
        : enqueueSessionPrompt({
            sessionId: resolvedSessionId,
            content: trimmedPrompt,
            model,
            reasoningEffort,
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
      threadId: getSessionCodexThreadId(resolvedSessionId),
      queuedPromptId: persistedQueuedPromptId,
    };
  };

  if (!createdSession && !skipQueueIfBusy && getActiveCodexRun(resolvedSessionId)) {
    return queuePrompt();
  }

  const providerRunIdentity = configuredProvider
    ? getResolvedProviderRunIdentity(configuredProvider)
    : null;
  const hasAvailableProviderCapacity =
    configuredProvider !== null &&
    providerRunIdentity !== null &&
    countActiveCodexRunsByProvider(providerRunIdentity.providerKey) <
      storedSettings.codexProviderConcurrentSessionLimit;

  if (!configuredProvider || !providerRunIdentity || !hasAvailableProviderCapacity) {
    return queuePrompt({
      markPending: !getActiveCodexRun(resolvedSessionId),
    });
  }

  const workingDirectory = resolveSessionWorkingDirectory(resolvedSessionId);
  const existingThreadId = getSessionCodexThreadId(resolvedSessionId);
  let responseId = existingThreadId ?? "";
  let latestAssistantText = "";
  let finalResponse = "";
  let usage: CodexBridgeUsage = null;
  const runStartedAtMs = Date.now();
  const runStartedAt = new Date(runStartedAtMs).toISOString();
  const runItemsById = new Map<string, WorkspaceRunItem>();
  const runItemOrder: string[] = [];
  let runTranscript: WorkspaceRunTranscriptEntry[] = [];
  const abortController = new AbortController();
  let userMessage: WorkspaceMessage | null = null;
  const networkAccessEnabled = true;

  registerActiveCodexRun({
    requestId,
    sessionId: resolvedSessionId,
    providerKey: providerRunIdentity.providerKey,
    abortController,
  }, {
    maxConcurrentRuns: storedSettings.codexProviderConcurrentSessionLimit,
    providerTitle: providerRunIdentity.providerTitle,
  });

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

    emitCodexEvent(onEvent, {
      type: "workspace.message.created",
      source,
      sessionId: resolvedSessionId,
      message: userMessage,
    });

    const launchConfig = resolveCodexProviderLaunchConfig(configuredProvider);
    const sandboxMode = resolveCodexSandboxMode();

    logCodexLaunchConfig({
      requestId,
      source,
      sessionId: resolvedSessionId,
      providerId: resolvedProviderId,
      providerTitle: providerRunIdentity.providerTitle,
      model,
      modelProvider: launchConfig.modelProvider,
      baseUrl: launchConfig.baseUrl,
      apiKey: launchConfig.apiKey,
      sandboxMode: sandboxMode ?? "default",
    });

    const codex = await createCodexClient(launchConfig);
    const sessionMessages = getSessionMessages(resolvedSessionId);
    const threadOptions = {
      model,
      workingDirectory,
      skipGitRepoCheck: true,
      approvalPolicy: "never" as const,
      modelReasoningEffort: reasoningEffort,
      networkAccessEnabled,
      ...(sandboxMode ? { sandboxMode } : {}),
    };
    const thread = existingThreadId
      ? codex.resumeThread(existingThreadId, threadOptions)
      : codex.startThread(threadOptions);
    const input = buildThreadInput(sessionMessages, Boolean(existingThreadId));
    const { events } = await thread.runStreamed(input, {
      signal: abortController.signal,
    });

    emitCodexEvent(onEvent, {
      type: "codex.run.started",
      source,
      requestId,
      sessionId: resolvedSessionId,
      model,
      reasoningEffort,
    });

    for await (const event of events) {
      if (event.type === "thread.started") {
        responseId = event.thread_id;
        saveSessionCodexThreadId(resolvedSessionId, event.thread_id);
        continue;
      }

      if (event.type === "turn.completed") {
        usage = mapUsage(event.usage);
        continue;
      }

      if (event.type === "turn.failed") {
        logCodexErrorDetails("[codex.run] Received turn.failed event", {
          requestId,
          source,
          sessionId: resolvedSessionId,
          providerId: resolvedProviderId,
          providerTitle: providerRunIdentity.providerTitle,
          model,
          reasoningEffort,
          threadId: responseId || thread.id || null,
          event,
        });
        throw new Error(event.error.message);
      }

      if (event.type === "error") {
        logCodexErrorDetails("[codex.run] Received error event", {
          requestId,
          source,
          sessionId: resolvedSessionId,
          providerId: resolvedProviderId,
          providerTitle: providerRunIdentity.providerTitle,
          model,
          reasoningEffort,
          threadId: responseId || thread.id || null,
          event,
        });
        throw new Error(event.message);
      }

      if (
        event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed"
      ) {
        const runItem = mapThreadItemToWorkspaceRunItem(event.item, event.type);

        if (runItem) {
          upsertRunItem(runItemsById, runItemOrder, runItem);
          runTranscript = upsertRunTranscriptItem(runTranscript, runItem);
          emitCodexEvent(onEvent, {
            type: "codex.run.item.updated",
            source,
            requestId,
            sessionId: resolvedSessionId,
            item: runItem,
          });
        }
      }

      const textUpdate = resolveAgentTextDelta(event, latestAssistantText);

      if (!textUpdate) {
        continue;
      }

      latestAssistantText = textUpdate.nextText;

      if (textUpdate.delta) {
        runTranscript = appendRunTranscriptText(runTranscript, textUpdate.delta);
        emitCodexEvent(onEvent, {
          type: "codex.run.delta",
          source,
          requestId,
          sessionId: resolvedSessionId,
          delta: textUpdate.delta,
        });
      }

      if (event.type === "item.completed") {
        finalResponse = textUpdate.nextText;
      }
    }

    const threadId = responseId || thread.id || null;
    const finalOutputText =
      finalResponse.trim() || latestAssistantText.trim() || "Codex 未返回文本内容。";
    const runItems = enrichWebSearchRunItems(
      buildOrderedRunItems(runItemsById, runItemOrder),
      finalOutputText,
    );
    const enrichedRunTranscript = enrichRunTranscriptEntries(
      runTranscript,
      runItems,
    );
    const runCompletedAtMs = Date.now();
    const runCompletedAt = new Date(runCompletedAtMs).toISOString();
    const runDurationMs = Math.max(runCompletedAtMs - runStartedAtMs, 0);
    const assistantMessage = appendMessageToSession({
      sessionId: resolvedSessionId,
      role: "assistant",
      content: finalOutputText,
      model,
      reasoningEffort,
      runDurationMs,
      metadata: buildRunMessageMetadata({
        requestId,
        startedAt: runStartedAt,
        completedAt: runCompletedAt,
        durationMs: runDurationMs,
        providerId: resolvedProviderId,
        providerLabel: providerRunIdentity.providerTitle,
        model,
        reasoningEffort,
        threadId,
        usage,
        items: runItems,
        transcript: enrichedRunTranscript,
      }),
      setActive: false,
      markUnread: true,
    });
    updateSessionStatus(resolvedSessionId, "已完成");

    if (threadId) {
      saveSessionCodexThreadId(resolvedSessionId, threadId);
    }

    emitCodexEvent(onEvent, {
      type: "workspace.message.created",
      source,
      sessionId: resolvedSessionId,
      message: assistantMessage,
    });
    emitCodexEvent(onEvent, {
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
    const runItems = enrichWebSearchRunItems(
      buildOrderedRunItems(runItemsById, runItemOrder),
      finalOutputText,
    );
    const enrichedRunTranscript = enrichRunTranscriptEntries(
      runTranscript,
      runItems,
    );
    const runCompletedAtMs = Date.now();
    const runCompletedAt = new Date(runCompletedAtMs).toISOString();
    const runDurationMs = Math.max(runCompletedAtMs - runStartedAtMs, 0);

    if (threadId) {
      saveSessionCodexThreadId(resolvedSessionId, threadId);
    }

    if (abortController.signal.aborted) {
      const stoppedMessage =
        finalOutputText || runItems.length > 0
          ? appendMessageToSession({
              sessionId: resolvedSessionId,
              role: finalOutputText ? "assistant" : "system",
              content: finalOutputText || "本次运行已手动停止。",
              model,
              reasoningEffort,
              runDurationMs,
              metadata: buildRunMessageMetadata({
                requestId,
                startedAt: runStartedAt,
                completedAt: runCompletedAt,
                durationMs: runDurationMs,
                providerId: resolvedProviderId,
                providerLabel: providerRunIdentity.providerTitle,
                model,
                reasoningEffort,
                threadId,
                usage,
                items: runItems,
                transcript: enrichedRunTranscript,
              }),
              setActive: false,
              markUnread: true,
            })
          : null;

      updateSessionStatus(resolvedSessionId, "已暂停");

      if (stoppedMessage) {
        emitCodexEvent(onEvent, {
          type: "workspace.message.created",
          source,
          sessionId: resolvedSessionId,
          message: stoppedMessage,
        });
      }

      emitCodexEvent(onEvent, {
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
    logCodexErrorDetails("[codex.run] Request failed", {
      requestId,
      source,
      sessionId: resolvedSessionId,
      providerId: resolvedProviderId,
      providerTitle: providerRunIdentity.providerTitle,
      model,
      reasoningEffort,
      threadId,
      partialOutputText: finalOutputText || null,
      usage,
      error,
    });
    const systemMessage = appendMessageToSession({
      sessionId: resolvedSessionId,
      role: "system",
      content: `Codex 请求失败：${errorMessage}`,
      model,
      reasoningEffort,
      runDurationMs,
      metadata: buildRunMessageMetadata({
        requestId,
        startedAt: runStartedAt,
        completedAt: runCompletedAt,
        durationMs: runDurationMs,
        providerId: resolvedProviderId,
        providerLabel: providerRunIdentity.providerTitle,
        model,
        reasoningEffort,
        threadId,
        usage,
        items: runItems,
        transcript: enrichedRunTranscript,
      }),
      setActive: false,
      markUnread: true,
    });
    updateSessionStatus(resolvedSessionId, "失败");

    emitCodexEvent(onEvent, {
      type: "workspace.message.created",
      source,
      sessionId: resolvedSessionId,
      message: systemMessage,
    });
    emitCodexEvent(onEvent, {
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
    unregisterActiveCodexRun(resolvedSessionId, requestId);
    void scheduleQueuedPromptDrain();
  }
}
