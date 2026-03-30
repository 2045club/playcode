export type WorkspaceRole = "user" | "assistant" | "system";
export type WorkspaceCodexReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type WorkspaceReasoningEffort = WorkspaceCodexReasoningEffort | "max";
export type WorkspaceRunUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
export type WorkspaceCommandExecutionStatus =
  | "in_progress"
  | "completed"
  | "failed";
export type WorkspacePatchApplyStatus = "completed" | "failed";
export type WorkspaceMcpToolCallStatus =
  | "in_progress"
  | "completed"
  | "failed";
export type WorkspaceWebSearchStatus = "in_progress" | "completed";
export type WorkspaceRunTodoItem = {
  text: string;
  completed: boolean;
};
export type WorkspaceRunItem =
  | {
      id: string;
      type: "reasoning";
      text: string;
    }
  | {
      id: string;
      type: "command_execution";
      command: string;
      aggregatedOutput: string;
      exitCode: number | null;
      status: WorkspaceCommandExecutionStatus;
    }
  | {
      id: string;
      type: "file_change";
      changes: Array<{
        path: string;
        kind: "add" | "delete" | "update";
      }>;
      status: WorkspacePatchApplyStatus;
    }
  | {
      id: string;
      type: "mcp_tool_call";
      server: string;
      tool: string;
      argumentsSummary: string;
      resultSummary: string | null;
      errorMessage: string | null;
      status: WorkspaceMcpToolCallStatus;
    }
  | {
      id: string;
      type: "web_search";
      query: string;
      title?: string | null;
      url?: string | null;
      status: WorkspaceWebSearchStatus;
    }
  | {
      id: string;
      type: "todo_list";
      items: WorkspaceRunTodoItem[];
    }
  | {
      id: string;
      type: "error";
      message: string;
    };
export type WorkspaceRunTranscriptEntry =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "item";
      item: WorkspaceRunItem;
    };
export type WorkspaceRunDetails = {
  requestId?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  providerId?: string | null;
  providerLabel?: string | null;
  model: string;
  reasoningEffort: WorkspaceReasoningEffort;
  threadId: string | null;
  usage: WorkspaceRunUsage | null;
  items: WorkspaceRunItem[];
  transcript?: WorkspaceRunTranscriptEntry[];
};
export type WorkspaceMessageMetadata = {
  run?: WorkspaceRunDetails | null;
};

export function appendRunTranscriptText(
  transcript: WorkspaceRunTranscriptEntry[],
  delta: string,
) {
  if (!delta) {
    return transcript;
  }

  const lastEntry = transcript[transcript.length - 1];

  if (lastEntry?.type === "text") {
    return [
      ...transcript.slice(0, -1),
      {
        type: "text",
        text: lastEntry.text + delta,
      } satisfies WorkspaceRunTranscriptEntry,
    ];
  }

  return [
    ...transcript,
    {
      type: "text",
      text: delta,
    } satisfies WorkspaceRunTranscriptEntry,
  ];
}

export function upsertRunTranscriptItem(
  transcript: WorkspaceRunTranscriptEntry[],
  item: WorkspaceRunItem,
) {
  const existingEntryIndex = transcript.findIndex(
    (entry) => entry.type === "item" && entry.item.id === item.id,
  );

  if (existingEntryIndex === -1) {
    return [
      ...transcript,
      {
        type: "item",
        item,
      } satisfies WorkspaceRunTranscriptEntry,
    ];
  }

  return transcript.map((entry, index) =>
    index === existingEntryIndex
      ? ({
          type: "item",
          item,
        } satisfies WorkspaceRunTranscriptEntry)
      : entry,
  );
}

export function buildWorkspaceWebSearchFallbackUrl(query: string) {
  const searchParams = new URLSearchParams({
    q: query,
  });

  return `https://www.bing.com/search?${searchParams.toString()}`;
}

export const DEFAULT_WORKSPACE_MODEL = "gpt-5.4";
export const DEFAULT_WORKSPACE_REASONING_EFFORT = "medium";
export const DEFAULT_WORKSPACE_PROJECT_SERVER = "codex";

export const WORKSPACE_PROJECT_SERVER_OPTIONS = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
] as const;

export type WorkspaceProjectServer =
  (typeof WORKSPACE_PROJECT_SERVER_OPTIONS)[number]["value"];

export const WORKSPACE_MODEL_OPTIONS = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
  { value: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max" },
  { value: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini" },
] as const;

export const WORKSPACE_REASONING_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
] as const satisfies ReadonlyArray<{
  value: WorkspaceCodexReasoningEffort;
  label: string;
}>;

const workspaceModelAliases = new Map<string, string>([
  ["gpt-5.4", "gpt-5.4"],
  ["gpt-5.4-mini", "gpt-5.4"],
  ["gpt-5.3", "gpt-5.3-codex"],
  ["gpt-5.2", "gpt-5.2"],
  ["gpt-5.1", "gpt-5.1-codex-max"],
  ["gpt-5.1-codex", "gpt-5.1-codex-max"],
]);
const projectServerAliases = new Set<WorkspaceProjectServer>(
  WORKSPACE_PROJECT_SERVER_OPTIONS.map((option) => option.value),
);

const reasoningEffortAliases = new Set<WorkspaceCodexReasoningEffort>(
  WORKSPACE_REASONING_OPTIONS.map((option) => option.value),
);
const SESSION_TITLE_MAX_CHARS = 20;

function getFirstSentenceBreakIndex(content: string) {
  const punctuationBreakIndex = content.search(/[。！？!?；;]/u);
  const lineBreakIndex = content.search(/[\r\n]/u);
  const validIndices = [punctuationBreakIndex, lineBreakIndex].filter(
    (index) => index >= 0,
  );

  return validIndices.length > 0 ? Math.min(...validIndices) : -1;
}

export function buildSessionTitle(content: string) {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return "新会话";
  }

  const firstSentenceBreakIndex = getFirstSentenceBreakIndex(trimmedContent);
  const firstSentence =
    firstSentenceBreakIndex >= 0
      ? trimmedContent.slice(0, firstSentenceBreakIndex)
      : trimmedContent;
  const compactSentence = firstSentence.replace(/\s+/g, " ").trim();
  const fallbackContent = trimmedContent.replace(/\s+/g, " ").trim();
  const resolvedSentence = compactSentence || fallbackContent;

  if (!resolvedSentence) {
    return "新会话";
  }

  return (
    Array.from(resolvedSentence).slice(0, SESSION_TITLE_MAX_CHARS).join("") ||
    "新会话"
  );
}

export function normalizeWorkspaceModel(model?: string | null) {
  const normalizedModel = model?.trim().toLowerCase() ?? "";

  if (!normalizedModel) {
    return DEFAULT_WORKSPACE_MODEL;
  }

  const directMatch = WORKSPACE_MODEL_OPTIONS.find(
    (option) => option.value === normalizedModel,
  );

  if (directMatch) {
    return directMatch.value;
  }

  return (
    workspaceModelAliases.get(normalizedModel) ?? DEFAULT_WORKSPACE_MODEL
  );
}

export function normalizeReasoningEffort(
  reasoningEffort?: string | null,
): WorkspaceCodexReasoningEffort {
  const normalizedReasoningEffort = reasoningEffort?.trim().toLowerCase() ?? "";

  if (
    reasoningEffortAliases.has(
      normalizedReasoningEffort as WorkspaceCodexReasoningEffort,
    )
  ) {
    return normalizedReasoningEffort as WorkspaceCodexReasoningEffort;
  }

  return DEFAULT_WORKSPACE_REASONING_EFFORT;
}

export function formatWorkspaceModelLabel(model: string) {
  return (
    WORKSPACE_MODEL_OPTIONS.find(
      (option) => option.value === normalizeWorkspaceModel(model),
    )?.label ?? WORKSPACE_MODEL_OPTIONS[0].label
  );
}

export function normalizeWorkspaceProjectServer(server?: string | null) {
  const normalizedServer = server?.trim().toLowerCase() ?? "";

  if (projectServerAliases.has(normalizedServer as WorkspaceProjectServer)) {
    return normalizedServer as WorkspaceProjectServer;
  }

  return DEFAULT_WORKSPACE_PROJECT_SERVER;
}

export function formatWorkspaceProjectServerLabel(
  server: WorkspaceProjectServer,
) {
  return (
    WORKSPACE_PROJECT_SERVER_OPTIONS.find(
      (option) => option.value === normalizeWorkspaceProjectServer(server),
    )?.label ?? WORKSPACE_PROJECT_SERVER_OPTIONS[0].label
  );
}

export function formatReasoningEffortLabel(
  reasoningEffort: WorkspaceReasoningEffort,
) {
  if (reasoningEffort === "max") {
    return "最高";
  }

  return (
    WORKSPACE_REASONING_OPTIONS.find(
      (option) => option.value === normalizeReasoningEffort(reasoningEffort),
    )?.label ??
    WORKSPACE_REASONING_OPTIONS.find(
      (option) => option.value === DEFAULT_WORKSPACE_REASONING_EFFORT,
    )?.label ??
    "中"
  );
}

export type WorkspaceMessage = {
  id: number;
  role: WorkspaceRole;
  content: string;
  createdAt: string;
  model?: string | null;
  reasoningEffort?: WorkspaceReasoningEffort | null;
  runDurationMs?: number | null;
  metadata?: WorkspaceMessageMetadata | null;
};

export type WorkspaceQueuedPrompt = {
  id: number;
  content: string;
  createdAt: string;
  model: string;
  reasoningEffort: WorkspaceReasoningEffort;
};

export type WorkspaceSession = {
  id: number;
  projectId: number;
  server: WorkspaceProjectServer;
  createdAt: string;
  name: string;
  preview: string;
  providerId: string;
  model: string;
  reasoningEffort: WorkspaceReasoningEffort;
  durationMs: number;
  durationMinutes: number;
  status: string;
  hasUnread: boolean;
  isArchived: boolean;
  usageTotals?: WorkspaceRunUsage;
  queuedPromptCount: number;
  queuedPrompts: WorkspaceQueuedPrompt[];
  messages: WorkspaceMessage[];
};

export type WorkspaceProject = {
  id: number;
  name: string;
  server: WorkspaceProjectServer;
  path: string;
  createdAt: string;
  validSessionCount: number;
  activeSessionCount: number;
  archivedSessionCount: number;
  sessions: WorkspaceSession[];
};

export type WorkspacePayload = {
  projects: WorkspaceProject[];
  selectedSessionId: number | null;
};

function dedupeWorkspaceEntriesById<T extends { id: number }>(entries: T[]) {
  const seenIds = new Set<number>();
  let hasDuplicates = false;
  const nextEntries: T[] = [];

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      hasDuplicates = true;
      continue;
    }

    seenIds.add(entry.id);
    nextEntries.push(entry);
  }

  return hasDuplicates ? nextEntries : entries;
}

export function upsertWorkspaceEntryById<T extends { id: number }>(
  entries: T[],
  entry: T,
) {
  const existingEntryIndex = entries.findIndex((item) => item.id === entry.id);

  if (existingEntryIndex === -1) {
    return [...entries, entry];
  }

  if (entries[existingEntryIndex] === entry) {
    return entries;
  }

  return entries.map((item, index) =>
    index === existingEntryIndex ? entry : item,
  );
}

export function normalizeWorkspaceSession(session: WorkspaceSession) {
  const messages = dedupeWorkspaceEntriesById(session.messages);
  const queuedPrompts = dedupeWorkspaceEntriesById(session.queuedPrompts);
  const queuedPromptCount = queuedPrompts.length;

  if (
    messages === session.messages &&
    queuedPrompts === session.queuedPrompts &&
    queuedPromptCount === session.queuedPromptCount
  ) {
    return session;
  }

  return {
    ...session,
    queuedPromptCount,
    queuedPrompts,
    messages,
  } satisfies WorkspaceSession;
}

export function normalizeWorkspaceProject(project: WorkspaceProject) {
  let hasSessionChanges = false;

  const normalizedSessions = project.sessions.map((session) => {
    const normalizedSession = normalizeWorkspaceSession(session);

    if (normalizedSession !== session) {
      hasSessionChanges = true;
    }

    return normalizedSession;
  });
  const uniqueSessions = dedupeWorkspaceEntriesById(normalizedSessions);

  if (uniqueSessions !== normalizedSessions) {
    hasSessionChanges = true;
  }

  const resolvedSessions = hasSessionChanges ? uniqueSessions : project.sessions;
  const validSessionCount = resolvedSessions.filter(
    (session) => !session.isArchived,
  ).length;
  const activeSessionCount = resolvedSessions.filter(
    (session) => !session.isArchived && session.status === "进行中",
  ).length;
  const archivedSessionCount = resolvedSessions.filter(
    (session) => session.isArchived,
  ).length;

  if (
    !hasSessionChanges &&
    validSessionCount === project.validSessionCount &&
    activeSessionCount === project.activeSessionCount &&
    archivedSessionCount === project.archivedSessionCount
  ) {
    return project;
  }

  return {
    ...project,
    validSessionCount,
    activeSessionCount,
    archivedSessionCount,
    sessions: resolvedSessions,
  } satisfies WorkspaceProject;
}

export function normalizeWorkspacePayload(workspace: WorkspacePayload) {
  let hasProjectChanges = false;

  const normalizedProjects = workspace.projects.map((project) => {
    const normalizedProject = normalizeWorkspaceProject(project);

    if (normalizedProject !== project) {
      hasProjectChanges = true;
    }

    return normalizedProject;
  });
  const uniqueProjects = dedupeWorkspaceEntriesById(normalizedProjects);

  if (uniqueProjects !== normalizedProjects) {
    hasProjectChanges = true;
  }

  if (!hasProjectChanges) {
    return workspace;
  }

  return {
    ...workspace,
    projects: uniqueProjects,
  } satisfies WorkspacePayload;
}

export const demoWorkspace: WorkspacePayload = {
  selectedSessionId: null,
  projects: [],
};
