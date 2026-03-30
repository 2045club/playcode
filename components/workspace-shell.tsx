"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode, UIEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Code2,
  Clock3,
  Folder,
  GitBranch,
  Hourglass,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { LanguageToggle } from "@/components/language-toggle";
import { useLocale } from "@/components/locale-provider";
import { ProjectCodeBrowser } from "@/components/project-code-browser";
import { ProjectDirectoryPickerModal } from "@/components/project-directory-picker-modal";
import { WorkspaceFilePreviewDrawer } from "@/components/workspace-file-preview-drawer";
import { ProjectGitInfoCard } from "@/components/project-git-info-card";
import { WorkspaceFileChangeCard } from "@/components/workspace-file-change-card";
import type { WorkspaceNavigationPage } from "@/components/workspace-global-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MessageMarkdown } from "@/components/message-markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspaceSettingsModal } from "@/components/workspace-settings-modal";
import {
  type ConnectionStatus,
} from "@/lib/settings";
import {
  formatSessionModelLabel,
  formatSessionReasoningEffortLabel,
  getModelOptionsForProjectServer,
  getProviderLabelForProjectServer,
  getReasoningOptionsForProjectServer,
  resolveDefaultSessionConfigForProjectServer,
} from "@/lib/session-agent";
import { useWorkspaceSettings } from "@/lib/use-workspace-settings";
import { type AppLocale, translateSessionStatus } from "@/lib/locale";
import type {
  WorkspaceRunDetails,
  WorkspaceRunItem,
  WorkspaceRunTranscriptEntry,
  WorkspaceRunUsage,
  WorkspaceQueuedPrompt,
  WorkspaceReasoningEffort,
  WorkspacePayload,
  WorkspaceProject,
  WorkspaceSession,
} from "@/lib/workspace";
import {
  DEFAULT_WORKSPACE_REASONING_EFFORT,
  WORKSPACE_MODEL_OPTIONS,
  WORKSPACE_PROJECT_SERVER_OPTIONS,
  appendRunTranscriptText,
  buildWorkspaceWebSearchFallbackUrl,
  buildSessionTitle,
  formatWorkspaceProjectServerLabel,
  normalizeWorkspacePayload,
  normalizeWorkspaceProjectServer,
  upsertRunTranscriptItem,
  upsertWorkspaceEntryById,
  type WorkspaceProjectServer,
} from "@/lib/workspace";
import type { ProjectGitInfo } from "@/lib/project-git";
import { cn } from "@/lib/utils";

type SidebarSessionItem = WorkspaceSession & {
  projectName: string;
};

type ProjectHomeSessionListTab = "valid" | "archived";

type CreateProjectPayload = {
  ok: boolean;
  error?: string;
  project?: WorkspaceProject;
  workspace?: WorkspacePayload;
};

type RemoveProjectPayload = {
  ok: boolean;
  error?: string;
  removedProject?: Pick<WorkspaceProject, "id" | "name" | "path">;
  workspace?: WorkspacePayload;
};

type RenameProjectPayload = {
  ok: boolean;
  error?: string;
  project?: Pick<WorkspaceProject, "id" | "name" | "path">;
  workspace?: WorkspacePayload;
};

type UpdateProjectServerPayload = {
  ok: boolean;
  error?: string;
  project?: Pick<WorkspaceProject, "id" | "server">;
  workspace?: WorkspacePayload;
};

type SessionArchivePayload = {
  ok: boolean;
  error?: string;
  sessionId?: number;
  archived?: boolean;
  name?: string;
  workspace?: WorkspacePayload;
};

type RemoveSessionPayload = {
  ok: boolean;
  error?: string;
  removedSession?: {
    sessionId: number;
    projectId: number;
    isArchived: boolean;
  };
  workspace?: WorkspacePayload;
};

type WorkspaceRealtimePhase =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type WorkspaceMessagePayload = WorkspaceSession["messages"][number];

type SessionConfigPayload = {
  ok: boolean;
  error?: string;
  config?: {
    model: string;
    reasoningEffort: WorkspaceReasoningEffort;
  };
  workspace?: WorkspacePayload;
};

const WORKSPACE_DISPLAY_LOCALE = "zh-CN";
const WORKSPACE_DISPLAY_TIME_ZONE = "Asia/Shanghai";

type ProjectSessionsPagePayload = {
  ok: boolean;
  error?: string;
  projectId?: number;
  offset?: number;
  limit?: number;
  totalCount?: number;
  hasMore?: boolean;
  sessions?: WorkspaceSession[];
};

type ChatResponsePayload = {
  ok: boolean;
  error?: string;
  result?: {
    status?: "completed" | "queued" | "stopped";
    queuedPromptId?: number;
    sessionId?: number;
  };
  workspace?: WorkspacePayload;
};

type ProjectGitInfoResponse = {
  ok: boolean;
  error?: string;
  git?: ProjectGitInfo;
};

type StopChatResponsePayload = {
  ok: boolean;
  error?: string;
  state?: "stopping" | "stopped" | "idle";
  workspace?: WorkspacePayload;
};

type QueuedPromptMutationPayload = {
  ok: boolean;
  error?: string;
  queuedPromptId?: number;
  sessionId?: number;
  workspace?: WorkspacePayload;
};

type WorkspaceReadyEvent = {
  type: "workspace.ready";
  workspace: WorkspacePayload;
  connection: ConnectionStatus;
};

type WorkspaceConnectionEvent = {
  type: "workspace.connection";
  connection: ConnectionStatus;
};

type WorkspaceMessageCreatedEvent = {
  type: "workspace.message.created";
  source: "ui" | "websocket";
  sessionId: number;
  message: WorkspaceMessagePayload;
};

type CodexRunStartedEvent = {
  type: "codex.run.started";
  source: "ui" | "websocket";
  requestId: string;
  sessionId: number;
  model: string;
  reasoningEffort: WorkspaceReasoningEffort;
};

type CodexRunDeltaEvent = {
  type: "codex.run.delta";
  source: "ui" | "websocket";
  requestId: string;
  sessionId: number;
  delta: string;
};

type CodexRunItemUpdatedEvent = {
  type: "codex.run.item.updated";
  source: "ui" | "websocket";
  requestId: string;
  sessionId: number;
  item: WorkspaceRunItem;
};

type CodexRunCompletedEvent = {
  type: "codex.run.completed";
  source: "ui" | "websocket";
  requestId: string;
  sessionId: number;
  model: string;
  reasoningEffort: WorkspaceReasoningEffort;
  threadId: string | null;
  outputText: string;
  usage: WorkspaceRunUsage | null;
  message: WorkspaceMessagePayload;
};

type CodexRunFailedEvent = {
  type: "codex.run.failed";
  source: "ui" | "websocket";
  requestId: string;
  sessionId: number;
  model: string;
  reasoningEffort: WorkspaceReasoningEffort;
  error: string;
  message?: WorkspaceMessagePayload;
};

type CodexRunStoppedEvent = {
  type: "codex.run.stopped";
  source: "ui" | "websocket";
  requestId: string;
  sessionId: number;
  model: string;
  reasoningEffort: WorkspaceReasoningEffort;
  threadId: string | null;
  outputText: string;
  usage: WorkspaceRunUsage | null;
  message?: WorkspaceMessagePayload;
};

type WorkspaceSnapshotEvent = {
  type: "workspace.snapshot";
  workspace: WorkspacePayload;
};

type WorkspaceRealtimeEvent =
  | WorkspaceReadyEvent
  | WorkspaceConnectionEvent
  | WorkspaceMessageCreatedEvent
  | CodexRunStartedEvent
  | CodexRunDeltaEvent
  | CodexRunItemUpdatedEvent
  | CodexRunCompletedEvent
  | CodexRunFailedEvent
  | CodexRunStoppedEvent
  | WorkspaceSnapshotEvent;

type StreamingAssistantState = {
  requestId: string;
  sessionId: number;
  createdAt: string;
  lastActivityAt: number;
  model: string;
  reasoningEffort: WorkspaceReasoningEffort;
  revision: number;
  transcript: WorkspaceRunTranscriptEntry[];
};

type StreamingAssistantStateMap = Record<number, StreamingAssistantState>;

type ProjectActionState = {
  projectId: number;
  action: "remove";
} | null;

type ProjectRenameState = {
  projectId: number;
  value: string;
  isSaving: boolean;
  errorMessage: string | null;
} | null;

type ProjectServerUpdateState = {
  projectId: number;
  server: WorkspaceProjectServer;
} | null;

type SessionRenameState = {
  sessionId: number;
  value: string;
  isSaving: boolean;
} | null;

type SessionActionState = {
  sessionId: number;
  action: "archive" | "delete";
} | null;

type ComposerDraftMap = Record<string, string>;

type PendingOutgoingMessage = {
  localId: string;
  content: string;
  createdAt: string;
};

type PendingOutgoingMessageMap = Record<string, PendingOutgoingMessage[]>;

type DraftWorkspaceSession = WorkspaceSession & {
  clientId: string;
  isDraft: true;
};

type WorkspaceRenderableSession = WorkspaceSession | DraftWorkspaceSession;
type WorkspaceShellProps = {
  currentPage: WorkspaceNavigationPage;
};

const COMPOSER_DRAFT_STORAGE_KEY = "playcodex:composer-drafts";
const PROJECT_SESSION_PAGE_SIZE = 10;
const SIDEBAR_SESSION_PAGE_SIZE = 20;
const SIDEBAR_SESSION_LOAD_MORE_COUNT = 20;
const PROJECT_HOME_REQUIREMENT_PAGE_SIZE = 20;
const PROJECT_HOME_REQUIREMENT_LOAD_MORE_COUNT = 20;
const STREAMING_THINKING_IDLE_MS = 1400;
const WORKSPACE_PANEL_HEADER_CLASS_NAME =
  "flex h-16 shrink-0 items-center border-b border-black/6 px-5 md:px-6";
const WORKSPACE_PANEL_HEADER_ROW_CLASS_NAME =
  "flex w-full items-center justify-between gap-3";
const WORKSPACE_SIDEBAR_HEADER_TITLE_CLASS_NAME =
  "text-[16px] font-semibold leading-6 text-[#3f3f3b] md:-ml-[2px]";
const WORKSPACE_PANEL_HEADER_TITLE_CLASS_NAME =
  "text-[14px] font-medium leading-6 text-[#3f3f3b]";

function isDraftWorkspaceSession(
  session: WorkspaceRenderableSession,
): session is DraftWorkspaceSession {
  return "isDraft" in session && session.isDraft;
}

function getSessionRuntimeKey(session: WorkspaceRenderableSession) {
  return isDraftWorkspaceSession(session)
    ? `draft:${session.clientId}`
    : `session:${session.id}`;
}

function getPersistedSessionRuntimeKey(sessionId: number) {
  return `session:${sessionId}`;
}

function readComposerDrafts(): ComposerDraftMap {
  if (typeof window === "undefined") {
    return {} satisfies ComposerDraftMap;
  }

  try {
    const rawDrafts = window.localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY);

    if (!rawDrafts) {
      return {} satisfies ComposerDraftMap;
    }

    const parsedDrafts = JSON.parse(rawDrafts);

    if (
      !parsedDrafts ||
      typeof parsedDrafts !== "object" ||
      Array.isArray(parsedDrafts)
    ) {
      return {} satisfies ComposerDraftMap;
    }

    return Object.fromEntries(
      Object.entries(parsedDrafts).filter(
        ([key, value]) => typeof key === "string" && typeof value === "string",
      ),
    ) as ComposerDraftMap;
  } catch {
    return {} satisfies ComposerDraftMap;
  }
}

function writeComposerDrafts(drafts: ComposerDraftMap) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (Object.keys(drafts).length === 0) {
      window.localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      JSON.stringify(drafts),
    );
  } catch {
    // Ignore localStorage write failures so composing can continue normally.
  }
}

function updateComposerDraftMap(
  drafts: ComposerDraftMap,
  sessionKey: string,
  value: string,
) {
  const currentValue = drafts[sessionKey] ?? "";

  if (currentValue === value) {
    return drafts;
  }

  if (!value) {
    if (!(sessionKey in drafts)) {
      return drafts;
    }

    const nextDrafts = { ...drafts };
    delete nextDrafts[sessionKey];
    return nextDrafts;
  }

  return {
    ...drafts,
    [sessionKey]: value,
  };
}

function appendUniqueStateEntry<T>(entries: T[], entry: T) {
  return entries.includes(entry) ? entries : [...entries, entry];
}

function removeStateEntry<T>(entries: T[], entry: T) {
  return entries.filter((item) => item !== entry);
}

function normalizeComposerPasteText(value: string) {
  return value.replace(/\s*\r?\n+\s*/g, " ");
}

function updatePendingOutgoingMessagesForSession(
  pendingOutgoingMessages: PendingOutgoingMessageMap,
  sessionKey: string,
  updater: (messages: PendingOutgoingMessage[]) => PendingOutgoingMessage[],
) {
  const currentMessages = pendingOutgoingMessages[sessionKey] ?? [];
  const nextMessages = updater(currentMessages);

  if (nextMessages === currentMessages) {
    return pendingOutgoingMessages;
  }

  if (nextMessages.length === 0) {
    if (!(sessionKey in pendingOutgoingMessages)) {
      return pendingOutgoingMessages;
    }

    const nextPendingOutgoingMessages = {
      ...pendingOutgoingMessages,
    };

    delete nextPendingOutgoingMessages[sessionKey];

    return nextPendingOutgoingMessages;
  }

  return {
    ...pendingOutgoingMessages,
    [sessionKey]: nextMessages,
  };
}

function appendPendingOutgoingMessage(
  pendingOutgoingMessages: PendingOutgoingMessageMap,
  sessionKey: string,
  message: PendingOutgoingMessage,
) {
  return updatePendingOutgoingMessagesForSession(
    pendingOutgoingMessages,
    sessionKey,
    (messages) => [...messages, message],
  );
}

function removePendingOutgoingMessageById(
  pendingOutgoingMessages: PendingOutgoingMessageMap,
  sessionKey: string,
  localId: string,
) {
  return updatePendingOutgoingMessagesForSession(
    pendingOutgoingMessages,
    sessionKey,
    (messages) => {
      const nextMessages = messages.filter(
        (message) => message.localId !== localId,
      );

      return nextMessages.length === messages.length ? messages : nextMessages;
    },
  );
}

function removePendingOutgoingMessageByContent(
  pendingOutgoingMessages: PendingOutgoingMessageMap,
  sessionKey: string,
  content: string,
) {
  return updatePendingOutgoingMessagesForSession(
    pendingOutgoingMessages,
    sessionKey,
    (messages) => {
      const matchingIndex = messages.findIndex(
        (message) => message.content === content,
      );

      if (matchingIndex === -1) {
        return messages;
      }

      return [
        ...messages.slice(0, matchingIndex),
        ...messages.slice(matchingIndex + 1),
      ];
    },
  );
}

function movePendingOutgoingMessages(
  pendingOutgoingMessages: PendingOutgoingMessageMap,
  fromSessionKey: string,
  toSessionKey: string,
) {
  if (fromSessionKey === toSessionKey) {
    return pendingOutgoingMessages;
  }

  const fromMessages = pendingOutgoingMessages[fromSessionKey] ?? [];

  if (fromMessages.length === 0) {
    return pendingOutgoingMessages;
  }

  const toMessages = pendingOutgoingMessages[toSessionKey] ?? [];
  const nextPendingOutgoingMessages = {
    ...pendingOutgoingMessages,
    [toSessionKey]: [...toMessages, ...fromMessages],
  };

  delete nextPendingOutgoingMessages[fromSessionKey];

  return nextPendingOutgoingMessages;
}

function normalizeWorkspaceRouteId(routeParam?: string | null) {
  if (!routeParam) {
    return null;
  }

  const normalizedValue = Number(routeParam);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    return null;
  }

  return normalizedValue;
}

function resolveWorkspaceRoute(pathname: string | null) {
  if (!pathname) {
    return {
      projectId: null,
      sessionId: null,
    };
  }

  const sessionMatch = pathname.match(
    /^\/projects\/(\d+)\/sessions\/(\d+)(?:\/)?$/u,
  );

  if (sessionMatch) {
    return {
      projectId: normalizeWorkspaceRouteId(sessionMatch[1]),
      sessionId: normalizeWorkspaceRouteId(sessionMatch[2]),
    };
  }

  const projectMatch = pathname.match(/^\/projects\/(\d+)(?:\/)?$/u);

  if (projectMatch) {
    return {
      projectId: normalizeWorkspaceRouteId(projectMatch[1]),
      sessionId: null,
    };
  }

  return {
    projectId: null,
    sessionId: null,
  };
}

function buildProjectHomeHref(projectId: number) {
  return `/projects/${projectId}`;
}

function buildProjectSessionHref(projectId: number, sessionId: number) {
  return `${buildProjectHomeHref(projectId)}/sessions/${sessionId}`;
}

function findProjectById(
  workspace: WorkspacePayload | null,
  projectId: number | null,
) {
  if (!workspace || typeof projectId !== "number") {
    return null;
  }

  return workspace.projects.find((project) => project.id === projectId) ?? null;
}

function findSelection(
  workspace: WorkspacePayload | null,
  selectedSessionId: number | null,
  draftSession: DraftWorkspaceSession | null,
) {
  if (!workspace) {
    return { project: null, session: null };
  }

  if (selectedSessionId === null && draftSession) {
    const project = workspace.projects.find(
      (item) => item.id === draftSession.projectId,
    );

    if (project) {
      return { project, session: draftSession };
    }
  }

  const preferredSessionIds = [
    selectedSessionId,
    workspace.selectedSessionId,
  ].filter((sessionId): sessionId is number => typeof sessionId === "number");

  for (const preferredSessionId of preferredSessionIds) {
    for (const project of workspace.projects) {
      const session = project.sessions.find(
        (item) => item.id === preferredSessionId,
      );

      if (session) {
        return { project, session };
      }
    }
  }

  for (const project of workspace.projects) {
    const fallbackSession = project.sessions.find((item) => !item.isArchived);

    if (fallbackSession) {
      return { project, session: fallbackSession };
    }
  }

  for (const project of workspace.projects) {
    const fallbackSession = project.sessions[0];

    if (fallbackSession) {
      return { project, session: fallbackSession };
    }
  }

  return { project: workspace.projects[0] ?? null, session: null };
}

function resolveSelectedSessionId(
  workspace: WorkspacePayload,
  currentSelectedSessionId: number | null,
  preserveUnsetSelection = false,
) {
  for (const project of workspace.projects) {
    const matchingSession = project.sessions.find(
      (session) => session.id === currentSelectedSessionId,
    );

    if (matchingSession) {
      return matchingSession.id;
    }
  }

  if (preserveUnsetSelection) {
    return null;
  }

  return workspace.selectedSessionId;
}

function findProjectIdBySessionId(
  workspace: WorkspacePayload,
  sessionId: number | null,
) {
  if (typeof sessionId !== "number") {
    return null;
  }

  for (const project of workspace.projects) {
    if (project.sessions.some((session) => session.id === sessionId)) {
      return project.id;
    }
  }

  return null;
}

function findSessionById(
  workspace: WorkspacePayload,
  sessionId: number | null,
) {
  if (typeof sessionId !== "number") {
    return null;
  }

  for (const project of workspace.projects) {
    const session = project.sessions.find((item) => item.id === sessionId);

    if (session) {
      return session;
    }
  }

  return null;
}

function resolveStreamingAssistantSessionConfig(
  workspace: WorkspacePayload | null,
  sessionId: number,
) {
  const session = workspace ? findSessionById(workspace, sessionId) : null;

  return {
    model: session?.model ?? WORKSPACE_MODEL_OPTIONS[0].value,
    reasoningEffort:
      session?.reasoningEffort ?? DEFAULT_WORKSPACE_REASONING_EFFORT,
  };
}

function findFirstProjectSessionIdByArchiveState(
  workspace: WorkspacePayload,
  projectId: number,
  isArchived: boolean,
) {
  const project = workspace.projects.find((item) => item.id === projectId);

  if (!project) {
    return null;
  }

  return (
    sortSessionsByLatestActivity(
      project.sessions.filter((session) => session.isArchived === isArchived),
    )[0]?.id ?? null
  );
}

function findFirstSessionIdByArchiveState(
  workspace: WorkspacePayload,
  isArchived: boolean,
) {
  return (
    sortSessionsByLatestActivity(
      workspace.projects.flatMap((project) =>
        project.sessions.filter((session) => session.isArchived === isArchived),
      ),
    )[0]?.id ?? null
  );
}

function getSessionActionGroupClassName(
  sessionActionState: SessionActionState,
  sessionId: number,
) {
  const shouldKeepVisible =
    sessionActionState !== null && sessionActionState.sessionId === sessionId;

  return cn(
    "absolute right-1 top-1/2 z-10 flex w-[3.5rem] -translate-y-1/2 items-center justify-end gap-0 transition-opacity",
    shouldKeepVisible
      ? "opacity-100"
      : sessionActionState
        ? "pointer-events-none opacity-0"
        : "pointer-events-none opacity-0 group-hover/session-item:pointer-events-auto group-hover/session-item:opacity-100 group-focus-within/session-item:pointer-events-auto group-focus-within/session-item:opacity-100",
  );
}

function getSessionDurationClassName() {
  return "absolute right-1 top-1/2 w-[3.5rem] -translate-y-1/2 text-right text-[11px] text-[#8b8b85] transition-opacity group-hover/session-item:opacity-0 group-focus-within/session-item:opacity-0";
}

function getSessionDisplayTitle(
  session: Pick<WorkspaceSession, "name" | "messages">,
) {
  const trimmedSessionName = session.name.trim();

  if (trimmedSessionName) {
    return trimmedSessionName;
  }

  const firstUserMessage = session.messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );
  const firstMessage =
    firstUserMessage ??
    session.messages.find((message) => message.content.trim()) ??
    null;

  return buildSessionTitle(firstMessage?.content ?? session.name);
}

function updateSessionInWorkspace(
  workspace: WorkspacePayload,
  sessionId: number,
  updater: (session: WorkspaceSession) => WorkspaceSession,
) {
  const normalizedWorkspace = normalizeWorkspacePayload(workspace);
  let hasUpdated = false;

  const projects = normalizedWorkspace.projects.map((project) => {
    const nextProject = {
      ...project,
      sessions: project.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        hasUpdated = true;
        return updater(session);
      }),
    };

    const validSessionCount = nextProject.sessions.filter(
      (session) => !session.isArchived,
    ).length;
    const activeSessionCount = nextProject.sessions.filter(
      (session) => !session.isArchived && session.status === "进行中",
    ).length;
    const archivedSessionCount = nextProject.sessions.filter(
      (session) => session.isArchived,
    ).length;

    return {
      ...nextProject,
      validSessionCount,
      activeSessionCount,
      archivedSessionCount,
    };
  });

  if (!hasUpdated) {
    return normalizedWorkspace;
  }

  return normalizeWorkspacePayload({
    ...normalizedWorkspace,
    projects,
  });
}

function updateProjectInWorkspace(
  workspace: WorkspacePayload,
  projectId: number,
  updater: (project: WorkspaceProject) => WorkspaceProject,
) {
  const normalizedWorkspace = normalizeWorkspacePayload(workspace);
  let hasUpdated = false;

  const projects = normalizedWorkspace.projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    hasUpdated = true;
    return updater(project);
  });

  if (!hasUpdated) {
    return normalizedWorkspace;
  }

  return normalizeWorkspacePayload({
    ...normalizedWorkspace,
    projects,
  });
}

function calculateSessionDurationMs(messages: WorkspaceSession["messages"]) {
  return messages.reduce((totalDurationMs, message) => {
    const messageDurationMs =
      getMessageRunDurationMs({
        run: message.metadata?.run ?? null,
        runDurationMs: message.runDurationMs,
      }) ?? 0;

    return totalDurationMs + messageDurationMs;
  }, 0);
}

function formatSessionDuration(durationMs: number, locale: AppLocale) {
  const normalizedDurationMs = normalizeRunDurationMs(durationMs) ?? 0;
  const totalSeconds = Math.max(Math.round(normalizedDurationMs / 1000), 0);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return locale === "en-US"
    ? `${totalMinutes}m ${seconds}s`
    : `${totalMinutes} 分 ${seconds} 秒`;
}

function formatSessionDurationPrimaryUnit(
  durationMs: number,
  locale: AppLocale,
) {
  const normalizedDurationMs = normalizeRunDurationMs(durationMs) ?? 0;
  const totalSeconds = Math.max(Math.round(normalizedDurationMs / 1000), 0);

  if (totalSeconds < 60) {
    return locale === "en-US" ? `${totalSeconds}s` : `${totalSeconds} 秒`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    return locale === "en-US" ? `${totalMinutes}m` : `${totalMinutes} 分`;
  }

  const totalHours = Math.floor(totalMinutes / 60);

  if (totalHours < 24) {
    return locale === "en-US" ? `${totalHours}h` : `${totalHours} 小时`;
  }

  const totalDays = Math.floor(totalHours / 24);

  return locale === "en-US" ? `${totalDays}d` : `${totalDays} 天`;
}

function formatSessionCreatedAt(createdAt: string, locale: AppLocale) {
  const timestamp = Date.parse(createdAt);

  if (!Number.isFinite(timestamp)) {
    return locale === "en-US" ? "Created time unknown" : "创建时间未知";
  }

  const formattedDate = new Intl.DateTimeFormat(
    locale === "en-US" ? "en-US" : "zh-CN",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: WORKSPACE_DISPLAY_TIME_ZONE,
    },
  ).format(new Date(timestamp));

  return locale === "en-US" ? `Created ${formattedDate}` : `创建于 ${formattedDate}`;
}

function formatProjectCreatedAt(createdAt: string, locale: AppLocale) {
  const timestamp = Date.parse(createdAt);

  if (!Number.isFinite(timestamp)) {
    return locale === "en-US" ? "Added time unknown" : "收录时间未知";
  }

  const formattedDate = new Intl.DateTimeFormat(
    locale === "en-US" ? "en-US" : "zh-CN",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: WORKSPACE_DISPLAY_TIME_ZONE,
    },
  ).format(new Date(timestamp));

  return locale === "en-US" ? `Added ${formattedDate}` : `收录于 ${formattedDate}`;
}

function formatAssistantIdentityLabel({
  projectServer,
  model,
  providerLabel,
}: {
  projectServer?: WorkspaceProjectServer | null;
  model?: string | null;
  providerLabel?: string | null;
}) {
  const resolvedProviderLabel = providerLabel?.trim();
  const modelLabel = formatSessionModelLabel(projectServer, model);

  return resolvedProviderLabel
    ? `${modelLabel} (${resolvedProviderLabel})`
    : modelLabel;
}

function formatLastActivityLabel(createdAt: string, locale: AppLocale) {
  const timestamp = Date.parse(createdAt);

  if (!Number.isFinite(timestamp)) {
    return locale === "en-US" ? "No activity yet" : "暂无活动";
  }

  const formattedDate = new Intl.DateTimeFormat(
    locale === "en-US" ? "en-US" : "zh-CN",
    {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: WORKSPACE_DISPLAY_TIME_ZONE,
    },
  ).format(new Date(timestamp));

  return locale === "en-US" ? `Active ${formattedDate}` : `最近活跃 ${formattedDate}`;
}

function formatConversationHistoryTimestamp(
  createdAt: string,
  locale: AppLocale,
) {
  const timestamp = Date.parse(createdAt);

  if (!Number.isFinite(timestamp)) {
    return locale === "en-US" ? "Time unknown" : "时间未知";
  }

  return new Intl.DateTimeFormat(locale === "en-US" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: WORKSPACE_DISPLAY_TIME_ZONE,
  }).format(new Date(timestamp));
}

function compareCreatedAtDesc(left: string, right: string) {
  const leftTimestamp = Date.parse(left);
  const rightTimestamp = Date.parse(right);

  if (!Number.isFinite(leftTimestamp) && !Number.isFinite(rightTimestamp)) {
    return 0;
  }

  if (!Number.isFinite(leftTimestamp)) {
    return 1;
  }

  if (!Number.isFinite(rightTimestamp)) {
    return -1;
  }

  return rightTimestamp - leftTimestamp;
}

function getSessionLastActivityAt(
  session: Pick<WorkspaceSession, "createdAt" | "messages">,
) {
  const lastMessage = session.messages[session.messages.length - 1];
  return lastMessage?.createdAt ?? session.createdAt;
}

function sortSessionsByLatestActivity<
  T extends Pick<WorkspaceSession, "id" | "createdAt" | "messages">,
>(sessions: T[]) {
  return [...sessions].sort(
    (left, right) =>
      compareCreatedAtDesc(
        getSessionLastActivityAt(left),
        getSessionLastActivityAt(right),
      ) || right.id - left.id,
  );
}

function sortSessionsBySubmissionTime<
  T extends Pick<WorkspaceSession, "id" | "createdAt">,
>(sessions: T[]) {
  return [...sessions].sort(
    (left, right) =>
      compareCreatedAtDesc(left.createdAt, right.createdAt) || right.id - left.id,
  );
}

function buildSessionPreview(content: string) {
  const compactContent = content.replace(/\s+/g, " ").trim();

  if (compactContent.length <= 80) {
    return compactContent;
  }

  return `${compactContent.slice(0, 77)}...`;
}

function useAutoLoadSentinel({
  hasMore,
  visibleItemCount,
  scrollViewportElement,
  onLoadMore,
}: {
  hasMore: boolean;
  visibleItemCount: number;
  scrollViewportElement: HTMLDivElement | null;
  onLoadMore: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const lastRequestedCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasMore) {
      lastRequestedCountRef.current = null;
      return;
    }

    const sentinelElement = sentinelRef.current;

    if (!sentinelElement || !scrollViewportElement) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (!entry?.isIntersecting) {
          return;
        }

        if (lastRequestedCountRef.current === visibleItemCount) {
          return;
        }

        lastRequestedCountRef.current = visibleItemCount;
        onLoadMore();
      },
      {
        root: scrollViewportElement,
        rootMargin: "0px 0px 120px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinelElement);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, onLoadMore, scrollViewportElement, visibleItemCount]);

  return sentinelRef;
}

type ProjectRequirementEntry = {
  messageId: number;
  sessionId: number;
  sessionTitle: string;
  content: string;
  createdAt: string;
  sessionStatus: string;
  sessionHasUnread: boolean;
  sessionIsArchived: boolean;
  sessionLastActivityAt: string;
};

type SessionConversationHistoryEntry = {
  messageId: number;
  content: string;
  createdAt: string;
};

function buildProjectRequirementEntries(
  project: Pick<WorkspaceProject, "sessions">,
) {
  return project.sessions
    .flatMap((session) =>
      session.messages
        .filter(
          (message) => message.role === "user" && message.content.trim(),
        )
        .map((message) => ({
          messageId: message.id,
          sessionId: session.id,
          sessionTitle: getSessionDisplayTitle(session),
          content: message.content.trim(),
          createdAt: message.createdAt,
          sessionStatus: session.status,
          sessionHasUnread: session.hasUnread,
          sessionIsArchived: session.isArchived,
          sessionLastActivityAt: getSessionLastActivityAt(session),
        })),
    )
    .sort(
      (left, right) =>
        compareCreatedAtDesc(left.createdAt, right.createdAt) ||
        right.messageId - left.messageId,
    ) satisfies ProjectRequirementEntry[];
}

function buildSessionConversationHistoryEntries(
  session: Pick<WorkspaceSession, "messages">,
) {
  return session.messages
    .filter((message) => message.role === "user" && message.content.trim())
    .map((message) => ({
      messageId: message.id,
      content: message.content,
      createdAt: message.createdAt,
    }))
    .sort(
      (left, right) =>
        compareCreatedAtDesc(left.createdAt, right.createdAt) ||
        right.messageId - left.messageId,
    ) satisfies SessionConversationHistoryEntry[];
}

function getSessionStatusLabel(
  session: Pick<WorkspaceSession, "status" | "isArchived">,
  locale: AppLocale,
) {
  if (session.isArchived) {
    return translateSessionStatus("已归档", locale);
  }

  return translateSessionStatus(session.status.trim() || "状态未知", locale);
}

function getSessionStatusBadgeClassName(
  session: Pick<WorkspaceSession, "status" | "isArchived">,
) {
  if (session.isArchived) {
    return "border-[#ddd8ca] bg-[#f3efe4] text-[#6f695b]";
  }

  if (session.status === "进行中") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (session.status === "待执行") {
    return "border-[#ead7a4] bg-[#fff7e2] text-[#946200]";
  }

  if (session.status === "已完成") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (session.status === "失败") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-black/10 bg-[#f4f1e8] text-[#6d6d68]";
}

function appendMessageToWorkspace(
  workspace: WorkspacePayload,
  sessionId: number,
  message: WorkspaceMessagePayload,
  options?: {
    selectSession?: boolean;
    clearUnread?: boolean;
  },
) {
  const selectSession = options?.selectSession ?? false;
  const clearUnread = options?.clearUnread ?? false;
  const nextWorkspace = updateSessionInWorkspace(
    workspace,
    sessionId,
    (session) => {
      const nextMessages = upsertWorkspaceEntryById(session.messages, message);
      const nextDurationMs = Math.max(
        session.durationMs,
        calculateSessionDurationMs(nextMessages),
      );

      return {
        ...session,
        preview: buildSessionPreview(message.content),
        durationMs: nextDurationMs,
        durationMinutes: Math.max(
          session.durationMinutes,
          Math.round(nextDurationMs / 60000),
        ),
        status: "进行中",
        hasUnread: clearUnread ? false : session.hasUnread,
        messages: nextMessages,
      };
    },
  );

  return {
    ...nextWorkspace,
    selectedSessionId: selectSession ? sessionId : nextWorkspace.selectedSessionId,
  };
}

function updateSessionAgentConfigInWorkspace(
  workspace: WorkspacePayload,
  sessionId: number,
  config: {
    model?: string;
    reasoningEffort?: WorkspaceReasoningEffort;
  },
) {
  return updateSessionInWorkspace(workspace, sessionId, (session) => ({
    ...session,
    ...(config.model ? { model: config.model } : {}),
    ...(config.reasoningEffort
      ? { reasoningEffort: config.reasoningEffort }
      : {}),
  }));
}

function updateSessionNameInWorkspace(
  workspace: WorkspacePayload,
  sessionId: number,
  name: string,
) {
  return updateSessionInWorkspace(workspace, sessionId, (session) => ({
    ...session,
    name,
  }));
}

function updateSessionUnreadStateInWorkspace(
  workspace: WorkspacePayload,
  sessionId: number,
  hasUnread: boolean,
) {
  return updateSessionInWorkspace(workspace, sessionId, (session) => ({
    ...session,
    hasUnread,
  }));
}

function updateProjectServerInWorkspace(
  workspace: WorkspacePayload,
  projectId: number,
  server: WorkspaceProjectServer,
) {
  return updateProjectInWorkspace(workspace, projectId, (project) => ({
    ...project,
    server,
  }));
}

function shouldPreserveCurrentSessionMessages(
  currentSession: WorkspaceSession,
  nextSession: WorkspaceSession,
) {
  if (nextSession.messages.length >= currentSession.messages.length) {
    return false;
  }

  const currentLatestMessageId =
    currentSession.messages[currentSession.messages.length - 1]?.id;

  if (typeof currentLatestMessageId !== "number") {
    return false;
  }

  return !nextSession.messages.some(
    (message) => message.id === currentLatestMessageId,
  );
}

function mergeIncomingWorkspacePayload(
  currentWorkspace: WorkspacePayload | null,
  nextWorkspace: WorkspacePayload,
) {
  const normalizedNextWorkspace = normalizeWorkspacePayload(nextWorkspace);

  if (!currentWorkspace) {
    return normalizedNextWorkspace;
  }

  const normalizedCurrentWorkspace = normalizeWorkspacePayload(currentWorkspace);
  const currentSessionsById = new Map(
    normalizedCurrentWorkspace.projects.flatMap((project) =>
      project.sessions.map((session) => [session.id, session] as const),
    ),
  );

  return normalizeWorkspacePayload({
    ...normalizedNextWorkspace,
    projects: normalizedNextWorkspace.projects.map((project) => ({
      ...project,
      sessions: project.sessions.map((session) => {
        const currentSession = currentSessionsById.get(session.id);

        if (
          !currentSession ||
          !shouldPreserveCurrentSessionMessages(currentSession, session)
        ) {
          return session;
        }

        // Realtime snapshots and fetch responses can arrive out of order.
        // Never let an older payload roll a session's messages backwards.
        return {
          ...session,
          preview: currentSession.preview,
          durationMs: Math.max(session.durationMs, currentSession.durationMs),
          durationMinutes: Math.max(
            session.durationMinutes,
            currentSession.durationMinutes,
          ),
          status: currentSession.status,
          hasUnread: currentSession.hasUnread,
          usageTotals: currentSession.usageTotals ?? session.usageTotals,
          queuedPromptCount: currentSession.queuedPromptCount,
          queuedPrompts: currentSession.queuedPrompts,
          messages: currentSession.messages,
        };
      }),
    })),
  });
}

function parseWorkspaceRealtimeEvent(rawPayload: string) {
  try {
    return JSON.parse(rawPayload) as WorkspaceRealtimeEvent;
  } catch {
    return null;
  }
}

function parseServerSentEvent(rawChunk: string) {
  const lines = rawChunk.split("\n");
  const dataParts: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue =
      separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "data") {
      dataParts.push(value);
    }
  }

  if (dataParts.length === 0) {
    return null;
  }

  return dataParts.join("\n");
}

async function readWorkspaceRealtimeStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: WorkspaceRealtimeEvent) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();

      buffer += decoder.decode(value ?? new Uint8Array(), {
        stream: !done,
      });
      buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      let boundaryIndex = buffer.indexOf("\n\n");

      while (boundaryIndex !== -1) {
        const rawChunk = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);

        const data = parseServerSentEvent(rawChunk);
        const event = data ? parseWorkspaceRealtimeEvent(data) : null;

        if (event) {
          onEvent(event);
        }

        boundaryIndex = buffer.indexOf("\n\n");
      }

      if (done) {
        break;
      }
    }

    const finalChunk = buffer.trim();

    if (!finalChunk) {
      return;
    }

    const data = parseServerSentEvent(finalChunk);
    const event = data ? parseWorkspaceRealtimeEvent(data) : null;

    if (event) {
      onEvent(event);
    }
  } finally {
    reader.releaseLock();
  }
}

function formatTokenCount(value: number) {
  return value.toLocaleString("en-US");
}

function normalizeUsageTokenCount(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.round(value);
}

function calculateProjectUsageSummary(project: WorkspaceProject) {
  const countedRunKeys = new Set<string>();
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;

  for (const session of project.sessions) {
    for (const message of session.messages) {
      const run = message.metadata?.run ?? null;
      const usage = run?.usage ?? null;

      if (!usage) {
        continue;
      }

      const requestId = run?.requestId?.trim();
      const runKey = requestId
        ? `run:${requestId}`
        : `message:${message.id}`;

      if (countedRunKeys.has(runKey)) {
        continue;
      }

      countedRunKeys.add(runKey);
      inputTokens += normalizeUsageTokenCount(usage.inputTokens);
      cachedInputTokens += normalizeUsageTokenCount(usage.cachedInputTokens);
      outputTokens += normalizeUsageTokenCount(usage.outputTokens);
    }
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
  };
}

function getRunDurationMs(run: WorkspaceRunDetails) {
  if (
    typeof run.durationMs === "number" &&
    Number.isFinite(run.durationMs) &&
    run.durationMs >= 0
  ) {
    return run.durationMs;
  }

  const startedAtTimestamp = run.startedAt ? Date.parse(run.startedAt) : NaN;
  const completedAtTimestamp = run.completedAt
    ? Date.parse(run.completedAt)
    : NaN;

  if (
    Number.isFinite(startedAtTimestamp) &&
    Number.isFinite(completedAtTimestamp)
  ) {
    return Math.max(completedAtTimestamp - startedAtTimestamp, 0);
  }

  return null;
}

function formatRunDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "-";
  }

  if (durationMs < 1000) {
    return "< 1 秒";
  }

  const totalSeconds = Math.max(Math.round(durationMs / 1000), 1);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours} 小时 ${minutes} 分`;
    }

    return `${hours} 小时`;
  }

  if (minutes > 0) {
    if (seconds > 0) {
      return `${minutes} 分 ${seconds} 秒`;
    }

    return `${minutes} 分`;
  }

  return `${seconds} 秒`;
}

function normalizeRunDurationMs(durationMs?: number | null) {
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }

  return Math.round(durationMs);
}

function getMessageRunDurationMs({
  run,
  runDurationMs,
}: {
  run?: WorkspaceRunDetails | null;
  runDurationMs?: number | null;
}) {
  const resolvedRunDurationMs = run ? getRunDurationMs(run) : null;

  return normalizeRunDurationMs(resolvedRunDurationMs ?? runDurationMs);
}

function AssistantSummaryBlock({
  content,
  onFileClick,
}: {
  content: string;
  onFileClick?: (href: string) => void;
}) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="space-y-3">
      <MessageMarkdown
        content={content}
        className="px-0.5"
        onFileClick={onFileClick}
      />
    </div>
  );
}

function RunSummaryCard({
  run,
  showDuration = true,
  durationMs,
  providerLabel,
}: {
  run: WorkspaceRunDetails;
  showDuration?: boolean;
  durationMs?: number | null;
  providerLabel?: string | null;
}) {
  const { t, translateReasoning } = useLocale();
  const usage = run.usage;
  const resolvedDurationMs = normalizeRunDurationMs(
    durationMs ?? getRunDurationMs(run),
  );
  const summaryItems = [
    {
      label: t("提供方", "Provider"),
      value: providerLabel?.trim() || t("默认环境", "Default"),
    },
    showDuration
      ? {
          label: t("运行时间", "Run Time"),
          value: formatRunDuration(resolvedDurationMs),
        }
      : null,
    {
      label: t("模型", "Model"),
      value: formatSessionModelLabel(undefined, run.model),
    },
    {
      label: t("推理强度", "Reasoning"),
      value: translateReasoning(
        formatSessionReasoningEffortLabel(undefined, run.reasoningEffort),
      ),
    },
    {
      label: t("输入", "Input"),
      value: usage ? formatTokenCount(usage.inputTokens) : "-",
    },
    {
      label: t("输出", "Output"),
      value: usage ? formatTokenCount(usage.outputTokens) : "-",
    },
    {
      label: t("缓存", "Cache"),
      value: usage ? formatTokenCount(usage.cachedInputTokens) : "-",
    },
  ].filter(Boolean) as Array<{
    label: string;
    value: string;
  }>;

  return (
    <div className="mt-3 rounded-[8px] border border-black/8 bg-[#f7f6f0] p-2.5">
      <div className="flex flex-wrap gap-2">
        {summaryItems.map((item) => (
          <span
            key={item.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white/92 px-2.5 py-1 text-[12px] leading-4 text-foreground"
          >
            <span className="text-[12px] text-muted-foreground">
              {item.label}
            </span>
            <span className="font-medium text-foreground">
              {item.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function getRunItemStatusLabel(
  item: WorkspaceRunItem,
  t: (zhText: string, enText: string) => string,
) {
  switch (item.type) {
    case "command_execution":
      if (item.status === "failed") {
        return t("失败", "Failed");
      }

      if (item.status === "completed") {
        return t("完成", "Done");
      }

      return t("运行中", "Running");
    case "file_change":
      return item.status === "failed" ? t("失败", "Failed") : t("已应用", "Applied");
    case "mcp_tool_call":
      if (item.status === "failed") {
        return t("失败", "Failed");
      }

      if (item.status === "completed") {
        return t("完成", "Done");
      }

      return t("调用中", "Calling");
    default:
      return null;
  }
}

function getRunItemStatusClassName(item: WorkspaceRunItem) {
  switch (item.type) {
    case "command_execution":
    case "file_change":
    case "mcp_tool_call":
      if (item.status === "failed") {
        return "border-destructive/20 bg-destructive/10 text-destructive";
      }

      if (item.status === "completed") {
        return "border-black/10 bg-black/[0.04] text-foreground";
      }

      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-black/10 bg-white text-muted-foreground";
  }
}

function getWebSearchHref(item: Extract<WorkspaceRunItem, { type: "web_search" }>) {
  return item.url?.trim() || buildWorkspaceWebSearchFallbackUrl(item.query);
}

function getWebSearchDisplayTitle(
  item: Extract<WorkspaceRunItem, { type: "web_search" }>,
) {
  return item.url?.trim() || buildWorkspaceWebSearchFallbackUrl(item.query);
}

function getWebSearchStatusLabel(
  item: Extract<WorkspaceRunItem, { type: "web_search" }>,
  t: (zhText: string, enText: string) => string,
) {
  if (!item.url?.trim()) {
    return t("搜索网页", "Search the Web");
  }

  return t("搜索网页", "Search the Web");
}

type BrowseCommandDetail = {
  id: string;
  kind: "file" | "search" | "directory" | "step";
  label: string;
};

type RenderableRunEntry =
  | {
      type: "text";
      key: string;
      text: string;
    }
  | {
      type: "browse_group";
      key: string;
      details: BrowseCommandDetail[];
    }
  | {
      type: "item";
      key: string;
      item: WorkspaceRunItem;
    };

function stripShellWrapper(command: string) {
  const trimmedCommand = command.trim();
  const shellCommandMatch = trimmedCommand.match(
    /^\/bin\/(?:zsh|bash|sh)\s+-lc\s+(['"])([\s\S]*)\1$/,
  );

  if (shellCommandMatch?.[2]) {
    return shellCommandMatch[2].trim();
  }

  return trimmedCommand;
}

function compactCommandText(command: string, maxLength = 90) {
  const normalizedCommand = stripShellWrapper(command)
    .replace(/\s+/g, " ")
    .trim();

  if (normalizedCommand.length <= maxLength) {
    return normalizedCommand;
  }

  return `${normalizedCommand.slice(0, maxLength - 1)}…`;
}

function getCommandPrimaryToken(command: string) {
  return stripShellWrapper(command).trim().split(/\s+/)[0] ?? "";
}

function extractPathLikeToken(command: string) {
  const matches = stripShellWrapper(command).match(
    /(?:\/[^\s'"]+|\.\.?(?:\/[^\s'"]+)?|[A-Za-z]:[\\/][^\s'"]+)/g,
  );

  if (!matches || matches.length === 0) {
    return null;
  }

  return matches[matches.length - 1] ?? null;
}

function isBrowseCommandItem(
  item: WorkspaceRunItem,
): item is Extract<WorkspaceRunItem, { type: "command_execution" }> {
  if (item.type !== "command_execution") {
    return false;
  }

  const primaryToken = getCommandPrimaryToken(item.command);

  if (
    primaryToken === "cat" ||
    primaryToken === "sed" ||
    primaryToken === "head" ||
    primaryToken === "tail" ||
    primaryToken === "nl" ||
    primaryToken === "bat" ||
    primaryToken === "less" ||
    primaryToken === "ls" ||
    primaryToken === "tree" ||
    primaryToken === "pwd" ||
    primaryToken === "rg" ||
    primaryToken === "grep" ||
    primaryToken === "find"
  ) {
    return true;
  }

  if (primaryToken !== "git") {
    return false;
  }

  const gitSubcommand = stripShellWrapper(item.command).trim().split(/\s+/)[1] ?? "";

  return (
    gitSubcommand === "status" ||
    gitSubcommand === "show" ||
    gitSubcommand === "diff" ||
    gitSubcommand === "log" ||
    gitSubcommand === "grep"
  );
}

function buildBrowseCommandDetail(
  item: Extract<WorkspaceRunItem, { type: "command_execution" }>,
): BrowseCommandDetail {
  const normalizedCommand = stripShellWrapper(item.command);
  const primaryToken = getCommandPrimaryToken(item.command);
  const extractedPath = extractPathLikeToken(item.command);

  if (primaryToken === "rg" || primaryToken === "grep" || primaryToken === "find") {
    return {
      id: item.id,
      kind: "search",
      label: compactCommandText(normalizedCommand, 120),
    };
  }

  if (primaryToken === "ls" || primaryToken === "tree" || primaryToken === "pwd") {
    return {
      id: item.id,
      kind: "directory",
      label: extractedPath || compactCommandText(normalizedCommand, 120),
    };
  }

  if (
    primaryToken === "cat" ||
    primaryToken === "sed" ||
    primaryToken === "head" ||
    primaryToken === "tail" ||
    primaryToken === "nl" ||
    primaryToken === "bat" ||
    primaryToken === "less"
  ) {
    return {
      id: item.id,
      kind: "file",
      label: extractedPath || compactCommandText(normalizedCommand, 120),
    };
  }

  return {
    id: item.id,
    kind: "step",
    label: compactCommandText(normalizedCommand, 120),
  };
}

function formatBrowseSummary(details: BrowseCommandDetail[]) {
  const fileCount = details.filter((detail) => detail.kind === "file").length;
  const searchCount = details.filter((detail) => detail.kind === "search").length;
  const directoryCount = details.filter(
    (detail) => detail.kind === "directory",
  ).length;
  const stepCount = details.filter((detail) => detail.kind === "step").length;
  const summaryParts: string[] = [];

  if (fileCount > 0) {
    summaryParts.push(`${fileCount} 个文件`);
  }

  if (searchCount > 0) {
    summaryParts.push(`${searchCount} 个搜索`);
  }

  if (directoryCount > 0) {
    summaryParts.push(`${directoryCount} 个目录`);
  }

  if (stepCount > 0 || summaryParts.length === 0) {
    summaryParts.push(`${stepCount || details.length} 个步骤`);
  }

  return summaryParts.join("，");
}

function getBrowseKindLabel(detail: BrowseCommandDetail) {
  switch (detail.kind) {
    case "file":
      return "Read";
    case "search":
      return "Searched for";
    case "directory":
      return "目录";
    default:
      return "步骤";
  }
}

function formatBrowseDetailLabel(detail: BrowseCommandDetail) {
  if (detail.kind !== "file") {
    return detail.label;
  }

  return detail.label.replace(/^\/+/, "");
}

function buildRenderableRunEntries(entries: WorkspaceRunTranscriptEntry[]) {
  const renderableEntries: RenderableRunEntry[] = [];
  let pendingBrowseDetails: BrowseCommandDetail[] = [];

  function flushBrowseDetails() {
    if (pendingBrowseDetails.length === 0) {
      return;
    }

    renderableEntries.push({
      type: "browse_group",
      key: `browse-${renderableEntries.length}`,
      details: pendingBrowseDetails,
    });
    pendingBrowseDetails = [];
  }

  entries.forEach((entry, index) => {
    if (entry.type === "text") {
      flushBrowseDetails();
      renderableEntries.push({
        type: "text",
        key: `text-${index}`,
        text: entry.text,
      });
      return;
    }

    if (isBrowseCommandItem(entry.item)) {
      pendingBrowseDetails.push(buildBrowseCommandDetail(entry.item));
      return;
    }

    flushBrowseDetails();
    renderableEntries.push({
      type: "item",
      key: entry.item.id,
      item: entry.item,
    });
  });

  flushBrowseDetails();

  return renderableEntries;
}

function splitAssistantSummaryEntries(entries: RenderableRunEntry[]) {
  let lastNonTextEntryIndex = -1;

  entries.forEach((entry, index) => {
    if (entry.type !== "text") {
      lastNonTextEntryIndex = index;
    }
  });

  const summaryStartIndex = entries.findIndex(
    (entry, index) =>
      index > lastNonTextEntryIndex &&
      entry.type === "text" &&
      entry.text.trim().length > 0,
  );

  if (summaryStartIndex === -1) {
    return {
      activityEntries: entries,
      summaryText: "",
    };
  }

  const summaryText = entries
    .slice(summaryStartIndex)
    .flatMap((entry) => (entry.type === "text" ? [entry.text] : []))
    .join("\n\n")
    .trim();

  if (!summaryText) {
    return {
      activityEntries: entries,
      summaryText: "",
    };
  }

  return {
    activityEntries: entries.slice(0, summaryStartIndex),
    summaryText,
  };
}

function splitFileChangeEntries(entries: RenderableRunEntry[]) {
  const fileChangeItems: Extract<WorkspaceRunItem, { type: "file_change" }>[] = [];
  const activityEntries = entries.filter((entry) => {
    if (entry.type !== "item" || entry.item.type !== "file_change") {
      return true;
    }

    fileChangeItems.push(entry.item);
    return false;
  });

  return {
    activityEntries,
    fileChangeItems,
  };
}

function splitFileChangeItems(items: WorkspaceRunItem[]) {
  const fileChangeItems: Extract<WorkspaceRunItem, { type: "file_change" }>[] = [];
  const activityItems = items.filter((item) => {
    if (item.type !== "file_change") {
      return true;
    }

    fileChangeItems.push(item);
    return false;
  });

  return {
    activityItems,
    fileChangeItems,
  };
}

function CodexDisclosure({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none py-0.5 text-[13px] leading-5 text-[#95958e] transition-colors hover:text-[#1f1f1c] [&::-webkit-details-marker]:hidden">
        <div className="inline-flex max-w-full items-center gap-1.5">
          <span className="font-medium text-[#666661] transition-colors group-hover:text-[#1f1f1c]">
            {label}
          </span>
          {summary ? <span className="ml-2">{summary}</span> : null}
          <ChevronRight className="size-4 shrink-0 text-[#a1a19b] opacity-0 transition-all group-hover:opacity-100 group-open:rotate-90 group-open:opacity-100" />
        </div>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

function RunSection({
  label,
  content,
  defaultOpen = false,
}: {
  label: string;
  content: string | null;
  defaultOpen?: boolean;
}) {
  if (!content?.trim()) {
    return null;
  }

  return (
    <details
      className="rounded-[8px] border border-black/10 bg-white/92"
      open={defaultOpen}
    >
      <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-muted-foreground">
        {label}
      </summary>
      <div className="border-t border-black/5 px-3 py-3">
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-foreground">
          {content}
        </pre>
      </div>
    </details>
  );
}

function InlineRunItemCard({
  item,
  projectId = null,
  showUndoAction = false,
}: {
  item: WorkspaceRunItem;
  projectId?: number | null;
  showUndoAction?: boolean;
}) {
  const { t } = useLocale();
  const statusLabel = getRunItemStatusLabel(item, t);

  if (item.type === "reasoning") {
    return (
      <div className="rounded-[8px] border border-black/10 bg-[#f8f7f2] px-3 py-3">
        <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t("思路", "Reasoning")}
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
          {item.text}
        </p>
      </div>
    );
  }

  if (item.type === "todo_list") {
    return (
      <div className="rounded-[8px] border border-black/10 bg-[#f8f7f2] px-3 py-3">
        <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t("执行计划", "Plan")}
        </div>
        <div className="mt-2 space-y-2">
          {item.items.map((todoItem) => (
            <div
              key={`${item.id}-${todoItem.text}`}
              className="flex items-start gap-2 text-[13px] text-foreground"
            >
              <span
                className={cn(
                  "mt-1 size-2 rounded-full",
                  todoItem.completed ? "bg-zinc-700" : "bg-zinc-300",
                )}
              />
              <span
                className={cn(
                  "leading-5",
                  todoItem.completed && "text-muted-foreground line-through",
                )}
              >
                {todoItem.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (item.type === "command_execution") {
    const normalizedCommand = stripShellWrapper(item.command);
    const commandOutput = item.aggregatedOutput.trim();
    const statusText =
      item.status === "completed"
        ? t("✓ 成功", "✓ Success")
        : item.status === "failed"
          ? t("失败", "Failed")
          : t("运行中", "Running");

    return (
      <CodexDisclosure
        label={t("已运行", "Executed")}
        summary={compactCommandText(item.command, 96)}
      >
        <div className="rounded-[8px] bg-[#ecebe7] px-4 py-4">
          <div className="text-[13px] font-medium leading-5 text-[#5b5b55]">
            Shell
          </div>
          <pre className="mt-3 max-h-[24rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-[#1f1f1c]">
            {`$ ${normalizedCommand}${commandOutput ? `\n${commandOutput}` : ""}`}
          </pre>
          <div
            className={cn(
              "mt-3 flex items-center justify-end text-[13px] leading-5",
              item.status === "failed"
                ? "text-destructive"
                : "text-[#8d8d86]",
            )}
          >
              {statusText}
              {item.exitCode !== null ? ` · exit ${item.exitCode}` : ""}
          </div>
        </div>
      </CodexDisclosure>
    );
  }

  if (item.type === "file_change") {
    return (
      <WorkspaceFileChangeCard
        items={[item]}
        projectId={projectId}
        showUndoAction={showUndoAction}
      />
    );
  }

  if (item.type === "mcp_tool_call") {
    return (
      <div className="rounded-[8px] border border-black/10 bg-[#f8f7f2] px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {t("工具调用", "Tool Call")}
            </div>
            <div className="mt-1 text-[13px] text-foreground">
              {item.server} / {item.tool}
            </div>
          </div>
          {statusLabel && (
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[13px] font-medium",
                getRunItemStatusClassName(item),
              )}
            >
              {statusLabel}
            </span>
          )}
        </div>
        <div className="mt-3 space-y-2">
          <RunSection label={t("查看参数", "View Arguments")} content={item.argumentsSummary} />
          <RunSection
            label={t("查看结果", "View Result")}
            content={item.resultSummary}
            defaultOpen={item.status === "completed"}
          />
          <RunSection
            label={t("查看错误", "View Error")}
            content={item.errorMessage}
            defaultOpen={item.status === "failed"}
          />
        </div>
      </div>
    );
  }

  if (item.type === "web_search") {
    const webSearchHref = getWebSearchHref(item);

    return (
      <div className="py-0.5 text-[13px] leading-5 text-[#95958e] transition-colors hover:text-[#1f1f1c]">
        <span className="font-medium text-[#666661] transition-colors hover:text-[#1f1f1c]">
          {getWebSearchStatusLabel(item, t)}
        </span>
        <a
          href={webSearchHref}
          target="_blank"
          rel="noreferrer"
          className="ml-2 break-all text-[#9a9a92] transition-colors hover:text-[#1f1f1c]"
        >
          ({getWebSearchDisplayTitle(item)})
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-destructive/20 bg-destructive/10 px-3 py-3">
      <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-destructive">
        运行错误
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-destructive">
        {item.message}
      </p>
    </div>
  );
}

function RunRenderableEntries({
  entries,
  projectId = null,
  showUndoAction = false,
}: {
  entries: RenderableRunEntry[];
  projectId?: number | null;
  showUndoAction?: boolean;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 text-[13px] leading-5 text-foreground">
      {entries.map((entry) => {
        if (entry.type === "text") {
          return (
            <div
              key={entry.key}
              className="whitespace-pre-wrap break-words"
            >
              {entry.text}
            </div>
          );
        }

        if (entry.type === "browse_group") {
          return (
            <CodexDisclosure
              key={entry.key}
              label="已浏览"
              summary={formatBrowseSummary(entry.details)}
            >
              <div className="rounded-[8px] bg-[#ecebe7] px-4 py-4">
                <div className="space-y-2">
                  {entry.details.map((detail) => (
                    <div
                      key={detail.id}
                      className="flex flex-wrap items-center gap-2 text-[13px] leading-5 text-[#5b5b55]"
                    >
                      <span
                        className={cn(
                          "text-[13px] font-medium text-[#8d8d86]",
                          detail.kind !== "file" &&
                            detail.kind !== "search" &&
                            "rounded-full bg-white px-2 py-0.5",
                        )}
                      >
                        {getBrowseKindLabel(detail)}
                      </span>
                      <span className="min-w-0 break-all">
                        {formatBrowseDetailLabel(detail)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CodexDisclosure>
          );
        }

        return (
          <div
            key={entry.key}
          >
            <InlineRunItemCard
              item={entry.item}
              projectId={projectId}
              showUndoAction={showUndoAction}
            />
          </div>
        );
      })}
    </div>
  );
}

function RunTranscriptEntries({
  entries,
  projectId = null,
  showUndoAction = false,
}: {
  entries: WorkspaceRunTranscriptEntry[];
  projectId?: number | null;
  showUndoAction?: boolean;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <RunRenderableEntries
      entries={buildRenderableRunEntries(entries)}
      projectId={projectId}
      showUndoAction={showUndoAction}
    />
  );
}

function StreamingThinkingIndicator({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      <div className="inline-flex items-center text-[13px] font-medium tracking-[0.02em] text-[#7b7b74]">
        <LoaderCircle className="mr-1 size-3 animate-spin" />
        <span className="workspace-thinking-text">thinking</span>
        <span aria-hidden="true" className="ml-1 inline-flex items-center">
          <span className="workspace-thinking-dot">.</span>
          <span className="workspace-thinking-dot">.</span>
          <span className="workspace-thinking-dot">.</span>
        </span>
      </div>
    </div>
  );
}

function WorkspaceMessageBubble({
  id,
  role,
  content,
  createdAt,
  runDurationMs,
  metadata,
  projectId = null,
  projectServer,
  sessionModel,
  providerLabel,
  onFileClick,
}: WorkspaceSession["messages"][number] & {
  projectId?: number | null;
  projectServer?: WorkspaceProjectServer | null;
  sessionModel?: string | null;
  providerLabel?: string | null;
  onFileClick?: (href: string) => void;
}) {
  const { t } = useLocale();
  const isUser = role === "user";
  const isSystem = role === "system";
  const run = metadata?.run ?? null;
  const transcriptEntries = run?.transcript ?? [];
  const hasTranscript = transcriptEntries.length > 0;
  const transcriptHasText = transcriptEntries.some(
    (entry) => entry.type === "text" && entry.text.trim(),
  );
  const renderableTranscriptEntries = hasTranscript
    ? buildRenderableRunEntries(transcriptEntries)
    : [];
  const {
    activityEntries: assistantActivityEntries,
    summaryText: assistantSummaryText,
  } = !isUser && hasTranscript
    ? splitAssistantSummaryEntries(renderableTranscriptEntries)
    : {
        activityEntries: renderableTranscriptEntries,
        summaryText: "",
      };
  const {
    activityEntries: assistantRenderableEntries,
    fileChangeItems: assistantFileChangeItems,
  } = !isUser && hasTranscript
    ? splitFileChangeEntries(assistantActivityEntries)
    : {
        activityEntries: assistantActivityEntries,
        fileChangeItems: [],
      };
  const {
    activityItems: runActivityItems,
    fileChangeItems: runFileChangeItems,
  } = !isUser && !hasTranscript && run
    ? splitFileChangeItems(run.items)
    : {
        activityItems: run?.items ?? [],
        fileChangeItems: [],
      };
  const shouldShowStandaloneContent =
    content.trim().length > 0 && (!run || !hasTranscript || !transcriptHasText);
  const messageRunDurationMs = !isUser
    ? getMessageRunDurationMs({
        run,
        runDurationMs,
      })
    : null;
  const runProviderLabel = run?.providerLabel?.trim() || providerLabel?.trim() || null;
  const assistantIdentityLabel = !isUser
    ? formatAssistantIdentityLabel({
        projectServer,
        model: run?.model ?? metadata?.run?.model ?? sessionModel,
        providerLabel: runProviderLabel,
      })
    : null;
  const showUndoAction = !isUser && Boolean(run?.completedAt);
  const timeLabel = new Date(createdAt).toLocaleTimeString(WORKSPACE_DISPLAY_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: WORKSPACE_DISPLAY_TIME_ZONE,
  });

  if (isSystem) {
    return (
      <div
        data-workspace-message-id={id}
        className="mx-auto w-full max-w-[1160px] space-y-2.5 py-2"
      >
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-[13px] text-muted-foreground">{content}</span>
          <Separator className="flex-1" />
        </div>
        {hasTranscript ? (
          <RunRenderableEntries
            entries={buildRenderableRunEntries(transcriptEntries).filter(
              (entry) =>
                entry.type !== "item" || entry.item.type !== "file_change",
            )}
            projectId={projectId}
            showUndoAction={showUndoAction}
          />
        ) : run && runActivityItems.length > 0 ? (
          <div className="space-y-2.5">
            {runActivityItems.map((item) => (
              <InlineRunItemCard
                key={item.id}
                item={item}
                projectId={projectId}
                showUndoAction={showUndoAction}
              />
            ))}
          </div>
        ) : null}
        {((hasTranscript && assistantFileChangeItems.length > 0) ||
          (!hasTranscript && runFileChangeItems.length > 0)) && (
          <div className="space-y-2.5 pt-1">
            <WorkspaceFileChangeCard
              items={hasTranscript ? assistantFileChangeItems : runFileChangeItems}
              projectId={projectId}
              showUndoAction={showUndoAction}
            />
          </div>
        )}
        {run && (
          <RunSummaryCard
            run={run}
            durationMs={messageRunDurationMs}
            providerLabel={runProviderLabel}
          />
        )}
      </div>
    );
  }

  return (
    <div
      data-workspace-message-id={id}
      className={cn(
        "mx-auto flex w-full max-w-[1160px] py-1",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "w-full max-w-full",
          isUser ? "space-y-1.5" : "space-y-3",
          isUser && "text-right",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 text-[13px] leading-none text-[#9a9a92]",
            isUser ? "justify-end text-[#8a8a82]" : "text-[#7b7b74]",
          )}
        >
          <span className="font-medium">
            {isUser ? t("你", "You") : assistantIdentityLabel}
          </span>
          <span>{timeLabel}</span>
        </div>
        <div className="space-y-2 text-[13px] leading-5 text-foreground">
          {shouldShowStandaloneContent ? (
            isUser ? (
              <div
                className="ml-auto w-fit max-w-[92%] whitespace-pre-wrap break-words rounded-[8px] bg-[#f1f1ee] px-4 py-2.5 text-left"
              >
                {content}
              </div>
            ) : (
              <AssistantSummaryBlock content={content} onFileClick={onFileClick} />
            )
          ) : null}
          {!isUser && hasTranscript ? (
            <>
              {assistantRenderableEntries.length > 0 ? (
                <RunRenderableEntries
                  entries={assistantRenderableEntries}
                  projectId={projectId}
                  showUndoAction={showUndoAction}
                />
              ) : null}
              {assistantSummaryText ? (
                <AssistantSummaryBlock
                  content={assistantSummaryText}
                  onFileClick={onFileClick}
                />
              ) : null}
            </>
          ) : null}
          {!isUser && !hasTranscript && run && runActivityItems.length > 0 ? (
            <div className="space-y-2.5">
              {runActivityItems.map((item) => (
                <InlineRunItemCard
                  key={item.id}
                  item={item}
                  projectId={projectId}
                  showUndoAction={showUndoAction}
                />
              ))}
            </div>
          ) : null}
          {!isUser &&
          ((hasTranscript && assistantFileChangeItems.length > 0) ||
            (!hasTranscript && runFileChangeItems.length > 0)) ? (
            <div className="space-y-2.5 pt-1">
              <WorkspaceFileChangeCard
                items={hasTranscript ? assistantFileChangeItems : runFileChangeItems}
                projectId={projectId}
                showUndoAction={showUndoAction}
              />
            </div>
          ) : null}
          {!isUser && run && (
            <RunSummaryCard
              run={run}
              durationMs={messageRunDurationMs}
              providerLabel={runProviderLabel}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PendingWorkspaceMessageBubble({
  content,
  createdAt,
}: {
  content: string;
  createdAt: string;
}) {
  const { t } = useLocale();
  const timeLabel = new Date(createdAt).toLocaleTimeString(
    WORKSPACE_DISPLAY_LOCALE,
    {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: WORKSPACE_DISPLAY_TIME_ZONE,
    },
  );

  return (
    <div className="mx-auto flex w-full max-w-[1160px] justify-end py-1">
      <div className="w-full max-w-full space-y-1.5 text-right">
        <div className="flex items-center justify-end gap-2 text-[13px] leading-none text-[#8a8a82]">
          <span className="font-medium">{t("你", "You")}</span>
          <span>{timeLabel}</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-black/8 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-[#6f6f69]">
            <LoaderCircle className="size-3 animate-spin" />
            <span>{t("发送中", "Sending")}</span>
          </span>
        </div>
        <div className="space-y-2 text-[13px] leading-5 text-foreground">
          <div
            data-no-translate
            className="ml-auto w-fit max-w-[92%] whitespace-pre-wrap break-words rounded-[8px] bg-[#f1f1ee] px-4 py-2.5 text-left"
          >
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingWorkspace() {
  return (
    <main className="bg-background lg:h-screen lg:overflow-hidden">
      <div className="grid min-h-screen w-full grid-cols-[4.5rem_minmax(0,1fr)] lg:h-full lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-full rounded-none border-x-0 border-y-0 border-r border-white/80 bg-[#F6F5F4] p-3 lg:border-b-0 lg:p-6">
          <div className="animate-pulse flex h-full flex-col items-center justify-between py-1 lg:items-stretch lg:justify-start lg:gap-4">
            <div className="size-10 rounded-[14px] bg-[#e5e7eb] lg:h-10 lg:w-full lg:rounded-2xl" />
            <div className="flex flex-col items-center gap-2 lg:items-stretch">
              <div className="size-10 rounded-[14px] bg-[#eceef1] lg:h-10 lg:w-full lg:rounded-2xl" />
              <div className="size-10 rounded-[14px] bg-[#eceef1] lg:h-10 lg:w-full lg:rounded-2xl" />
            </div>
            <div className="size-10 rounded-[14px] bg-[#e5e7eb] lg:h-10 lg:w-full lg:rounded-2xl" />
          </div>
        </Card>
        <Card className="h-full rounded-none border-0 bg-[#fafafa] p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-12 rounded-2xl bg-[#e5e7eb]" />
            <div className="h-[32rem] rounded-[28px] bg-[#eceef1]" />
            <div className="h-44 rounded-[28px] bg-[#eceef1]" />
          </div>
        </Card>
      </div>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  const { t } = useLocale();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="surface-shadow max-w-xl rounded-[28px] border-white/80 bg-white/90">
        <CardHeader>
          <CardTitle>{t("工作区加载失败", "Workspace Failed to Load")}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => window.location.reload()}>
            {t("重新加载", "Reload")}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function SelectChip({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<{
    value: string;
    label: string;
  }>;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        aria-label={ariaLabel}
        className="h-8 appearance-none rounded-[10px] border border-black/10 bg-[#f5f5f2] pl-3 pr-8 text-[13px] text-foreground outline-none transition-colors focus:border-black/30"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function ProjectBranchChip({ projectId }: { projectId: number }) {
  const [gitInfo, setGitInfo] = useState<ProjectGitInfo | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  useEffect(() => {
    const abortController = new AbortController();

    async function loadProjectGitInfo() {
      setStatus("loading");
      setGitInfo(null);

      try {
        const response = await fetch(`/api/project-git?projectId=${projectId}`, {
          signal: abortController.signal,
        });
        const payload =
          (await response.json().catch(() => ({}))) as ProjectGitInfoResponse;

        if (!response.ok || !payload.ok || !payload.git) {
          throw new Error("Failed to load project git info.");
        }

        if (abortController.signal.aborted) {
          return;
        }

        setGitInfo(payload.git);
        setStatus("ready");
      } catch {
        if (abortController.signal.aborted) {
          return;
        }

        setGitInfo(null);
        setStatus("unavailable");
      }
    }

    void loadProjectGitInfo();

    return () => {
      abortController.abort();
    };
  }, [projectId]);

  const branchLabel =
    status === "loading"
      ? "读取分支..."
      : status === "unavailable"
        ? "分支不可用"
        : !gitInfo?.isRepository
          ? "非 Git 项目"
          : gitInfo.isDetachedHead
            ? "Detached HEAD"
            : gitInfo.currentBranch ?? "未知分支";
  const isMuted =
    status !== "ready" || !gitInfo?.isRepository || gitInfo.isDetachedHead;

  return (
    <div
      className={cn(
        "inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-[10px] border border-black/10 bg-[#f5f5f2] px-3 text-[13px] text-foreground",
        isMuted && "text-[#7d7d77]",
      )}
      title={branchLabel}
      aria-label={`当前分支: ${branchLabel}`}
    >
      <GitBranch className="size-3.5 shrink-0" />
      <span className="truncate">{branchLabel}</span>
    </div>
  );
}

export function WorkspaceShell({ currentPage }: WorkspaceShellProps) {
  const { locale, t, translateError, translateReasoning } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  );
  const [draftSession, setDraftSession] = useState<DraftWorkspaceSession | null>(
    null,
  );
  const [expandedProjectIds, setExpandedProjectIds] = useState<number[]>([]);
  const [projectSessionDisplayCounts, setProjectSessionDisplayCounts] = useState<
    Record<number, number>
  >({});
  const [loadingMoreProjectSessionIds, setLoadingMoreProjectSessionIds] =
    useState<number[]>([]);
  const [sidebarSessionDisplayCount, setSidebarSessionDisplayCount] = useState(
    SIDEBAR_SESSION_PAGE_SIZE,
  );
  const [composerValue, setComposerValue] = useState("");
  const [composerDrafts, setComposerDrafts] = useState<ComposerDraftMap>({});
  const [hasHydratedComposerDrafts, setHasHydratedComposerDrafts] =
    useState(false);
  const [projectActionState, setProjectActionState] =
    useState<ProjectActionState>(null);
  const [projectRenameState, setProjectRenameState] =
    useState<ProjectRenameState>(null);
  const [projectServerUpdateState, setProjectServerUpdateState] =
    useState<ProjectServerUpdateState>(null);
  const [sessionRenameState, setSessionRenameState] =
    useState<SessionRenameState>(null);
  const [sessionActionState, setSessionActionState] =
    useState<SessionActionState>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingSendSessionKeys, setPendingSendSessionKeys] = useState<string[]>(
    [],
  );
  const [pendingOutgoingMessages, setPendingOutgoingMessages] =
    useState<PendingOutgoingMessageMap>({});
  const [stoppingSessionIds, setStoppingSessionIds] = useState<number[]>([]);
  const [removingQueuedPromptIds, setRemovingQueuedPromptIds] = useState<number[]>(
    [],
  );
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [chatStatusMessage, setChatStatusMessage] = useState<string | null>(null);
  const [workspaceRealtimePhase, setWorkspaceRealtimePhase] =
    useState<WorkspaceRealtimePhase>("connecting");
  const [workspaceRealtimeError, setWorkspaceRealtimeError] = useState<
    string | null
  >(null);
  const [streamingAssistantsBySessionId, setStreamingAssistantsBySessionId] =
    useState<StreamingAssistantStateMap>({});
  const [showStreamingAssistantThinking, setShowStreamingAssistantThinking] =
    useState(false);
  const [isConversationHistoryOpen, setIsConversationHistoryOpen] =
    useState(false);
  const [activeConversationHistoryMessageId, setActiveConversationHistoryMessageId] =
    useState<number | null>(null);
  const [filePreviewHref, setFilePreviewHref] = useState<string | null>(null);
  const [sidebarScrollViewportElement, setSidebarScrollViewportElement] =
    useState<HTMLDivElement | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const isMobileSidebarOpenRef = useRef(false);
  const [hasMounted, setHasMounted] = useState(false);
  const workspaceRealtimeAbortControllerRef =
    useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const workspaceRef = useRef<WorkspacePayload | null>(null);
  const draftSessionRef = useRef<DraftWorkspaceSession | null>(null);
  const pendingDraftSessionRef = useRef<string | null>(null);
  const selectedSessionIdRef = useRef<number | null>(null);
  const knownProjectIdsRef = useRef<Set<number> | null>(null);
  const sidebarScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionRenameInputRef = useRef<HTMLInputElement | null>(null);
  const composerFocusFrameRef = useRef<number | null>(null);
  const shouldFocusComposerOnSessionChangeRef = useRef(false);
  const lastOpenedSessionIdRef = useRef<number | null>(null);
  const currentSessionKeyRef = useRef<string | null>(null);
  const sessionRenameBlurModeRef = useRef<"save" | "ignore">("save");
  const sessionRenameSubmitInFlightRef = useRef(false);
  const pendingOutgoingMessageSequenceRef = useRef(0);
  const {
    claudeSettingsError,
    connectionStatus,
    codexSettingsError,
    editingClaudeProviderIds,
    editingCodexProviderIds,
    handleAddClaudeProvider,
    handleAddCodexProvider,
    handleCancelClaudeProviderEdit,
    handleCancelCodexProviderEdit,
    handleClaudeProviderChange,
    handleCodexProviderChange,
    handleFinishClaudeProviderEdit,
    handleFinishCodexProviderEdit,
    handleMoveClaudeProvider,
    handleMoveCodexProvider,
    handleRemoveClaudeProvider,
    hasPendingCodexProviderEdit,
    hasPendingClaudeProviderEdit,
    isSettingsOpen,
    savedSettings,
    settingsDraft,
    handleCloseSettings,
    handleStartClaudeProviderEdit,
    handleRemoveCodexProvider,
    handleStartCodexProviderEdit,
    handleSettingsChange,
    handleToggleSettings,
    setConnectionStatus,
    websocketError,
  } = useWorkspaceSettings();
  const { projectId: routeProjectId, sessionId: routeSessionId } =
    resolveWorkspaceRoute(pathname);
  const isProjectHomeRoute =
    currentPage === "projects" &&
    routeProjectId !== null &&
    routeSessionId === null;
  const effectiveSelectedSessionId = isProjectHomeRoute
    ? null
    : routeSessionId ?? selectedSessionId;
  const effectiveDraftSession =
    isProjectHomeRoute || routeSessionId !== null ? null : draftSession;
  const currentStreamingAssistant =
    effectiveSelectedSessionId !== null
      ? streamingAssistantsBySessionId[effectiveSelectedSessionId] ?? null
      : null;

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      try {
        const workspaceResponse = await fetch("/api/workspace", {
          cache: "no-store",
        });

        if (!workspaceResponse.ok) {
          throw new Error("无法读取工作区数据。");
        }

        const workspacePayload =
          (await workspaceResponse.json()) as WorkspacePayload;

        if (cancelled) {
          return;
        }

        setWorkspace((currentWorkspace) =>
          mergeIncomingWorkspacePayload(currentWorkspace, workspacePayload),
        );
        setSelectedSessionId(workspacePayload.selectedSessionId);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(
          loadError instanceof Error ? loadError.message : "未知错误",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    draftSessionRef.current = draftSession;
  }, [draftSession]);

  useEffect(() => {
    selectedSessionIdRef.current = effectiveSelectedSessionId;
  }, [effectiveSelectedSessionId]);

  useLayoutEffect(() => {
    if (sidebarScrollViewportRef.current !== sidebarScrollViewportElement) {
      setSidebarScrollViewportElement(sidebarScrollViewportRef.current);
    }
  }, [currentPage, sidebarScrollViewportElement]);

  useEffect(() => {
    isMobileSidebarOpenRef.current = isMobileSidebarOpen;
  }, [isMobileSidebarOpen]);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!isMobileSidebarOpenRef.current) {
      return;
    }

    setIsMobileSidebarOpen(false);
  }, [effectiveDraftSession, effectiveSelectedSessionId, pathname]);

  useEffect(() => {
    return () => {
      if (composerFocusFrameRef.current !== null) {
        window.cancelAnimationFrame(composerFocusFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      !currentStreamingAssistant ||
      currentStreamingAssistant.transcript.length === 0
    ) {
      setShowStreamingAssistantThinking(false);
      return;
    }

    const remainingDelay =
      STREAMING_THINKING_IDLE_MS -
      (Date.now() - currentStreamingAssistant.lastActivityAt);

    if (remainingDelay <= 0) {
      setShowStreamingAssistantThinking(true);
      return;
    }

    setShowStreamingAssistantThinking(false);

    const timeoutId = window.setTimeout(() => {
      setShowStreamingAssistantThinking(true);
    }, remainingDelay);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentStreamingAssistant]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const workspaceProjectIds = workspace.projects.map((project) => project.id);
    const workspaceProjectIdSet = new Set(workspaceProjectIds);
    const knownProjectIds = knownProjectIdsRef.current;

    setExpandedProjectIds((currentExpandedProjectIds) => {
      if (knownProjectIds === null) {
        return workspaceProjectIds;
      }

      const filteredExpandedProjectIds = currentExpandedProjectIds.filter((id) =>
        workspaceProjectIdSet.has(id),
      );
      const currentExpandedProjectIdSet = new Set(filteredExpandedProjectIds);
      const newProjectIds = workspaceProjectIds.filter(
        (id) =>
          !knownProjectIds.has(id) && !currentExpandedProjectIdSet.has(id),
      );

      return [...newProjectIds, ...filteredExpandedProjectIds];
    });
    knownProjectIdsRef.current = workspaceProjectIdSet;

    setProjectRenameState((currentProjectRenameState) =>
      currentProjectRenameState &&
      workspace.projects.some(
        (project) => project.id === currentProjectRenameState.projectId,
      )
        ? currentProjectRenameState
        : null,
    );
    setProjectSessionDisplayCounts((currentProjectSessionDisplayCounts) => {
      const nextProjectSessionDisplayCounts: Record<number, number> = {};
      let hasChanged = false;

      for (const project of workspace.projects) {
        const currentDisplayCount =
          currentProjectSessionDisplayCounts[project.id] ??
          PROJECT_SESSION_PAGE_SIZE;
        nextProjectSessionDisplayCounts[project.id] = Math.max(
          currentDisplayCount,
          PROJECT_SESSION_PAGE_SIZE,
        );

        if (
          currentProjectSessionDisplayCounts[project.id] !==
          nextProjectSessionDisplayCounts[project.id]
        ) {
          hasChanged = true;
        }
      }

      if (
        !hasChanged &&
        Object.keys(currentProjectSessionDisplayCounts).length ===
          workspace.projects.length
      ) {
        return currentProjectSessionDisplayCounts;
      }

      return nextProjectSessionDisplayCounts;
    });
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function scheduleReconnect() {
      clearReconnectTimer();

      reconnectTimerRef.current = window.setTimeout(() => {
        void connectWorkspaceRealtime();
      }, 1500);
    }

    function closeWorkspaceRealtimeStream() {
      if (!workspaceRealtimeAbortControllerRef.current) {
        return;
      }

      workspaceRealtimeAbortControllerRef.current.abort();
      workspaceRealtimeAbortControllerRef.current = null;
    }

    function handleWorkspaceRealtimeEvent(event: WorkspaceRealtimeEvent) {
      switch (event.type) {
        case "workspace.ready": {
          const nextWorkspace = event.workspace;
          const currentDraftSession = draftSessionRef.current;
          const shouldAdoptPendingDraftSession =
            Boolean(pendingDraftSessionRef.current) &&
            Boolean(currentDraftSession) &&
            findProjectIdBySessionId(
              nextWorkspace,
              nextWorkspace.selectedSessionId,
            ) === currentDraftSession?.projectId;

          setWorkspace((currentWorkspace) =>
            mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
          );

          if (shouldAdoptPendingDraftSession) {
            pendingDraftSessionRef.current = null;
            setDraftSession(null);
            setSelectedSessionId(nextWorkspace.selectedSessionId);
          } else {
            setSelectedSessionId((currentSelectedSessionId) =>
              resolveSelectedSessionId(
                nextWorkspace,
                currentSelectedSessionId,
                Boolean(currentDraftSession),
              ),
            );
          }

          setConnectionStatus(event.connection);
          setWorkspaceRealtimePhase("connected");
          setWorkspaceRealtimeError(null);
          return;
        }
        case "workspace.snapshot": {
          const nextWorkspace = event.workspace;
          const currentDraftSession = draftSessionRef.current;
          const shouldAdoptPendingDraftSession =
            Boolean(pendingDraftSessionRef.current) &&
            Boolean(currentDraftSession) &&
            findProjectIdBySessionId(
              nextWorkspace,
              nextWorkspace.selectedSessionId,
            ) === currentDraftSession?.projectId;

          setWorkspace((currentWorkspace) =>
            mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
          );

          if (shouldAdoptPendingDraftSession) {
            pendingDraftSessionRef.current = null;
            setDraftSession(null);
            setSelectedSessionId(nextWorkspace.selectedSessionId);
          } else {
            setSelectedSessionId((currentSelectedSessionId) =>
              resolveSelectedSessionId(
                nextWorkspace,
                currentSelectedSessionId,
                Boolean(currentDraftSession),
              ),
            );
          }

          return;
        }
        case "workspace.connection":
          setConnectionStatus(event.connection);
          return;
        case "workspace.message.created":
          setWorkspace((currentWorkspace) =>
            currentWorkspace
              ? appendMessageToWorkspace(
                  currentWorkspace,
                  event.sessionId,
                  event.message,
                  {
                    selectSession: event.message.role === "user",
                    clearUnread: event.message.role === "user",
                  },
                )
              : currentWorkspace,
          );

          if (
            event.message.role === "user" &&
            event.source === "ui" &&
            workspaceRef.current &&
            findSessionById(workspaceRef.current, event.sessionId)
          ) {
            setPendingOutgoingMessages((currentPendingMessages) =>
              removePendingOutgoingMessageByContent(
                currentPendingMessages,
                getPersistedSessionRuntimeKey(event.sessionId),
                event.message.content,
              ),
            );
          }

          if (event.message.role !== "user") {
            setStreamingAssistantsBySessionId((currentStreamingAssistants) => {
              if (!currentStreamingAssistants[event.sessionId]) {
                return currentStreamingAssistants;
              }

              const nextStreamingAssistants = {
                ...currentStreamingAssistants,
              };

              delete nextStreamingAssistants[event.sessionId];

              return nextStreamingAssistants;
            });
          }

          return;
        case "codex.run.started":
          setChatStatusMessage(null);
          setStreamingAssistantsBySessionId((currentStreamingAssistants) => ({
            ...currentStreamingAssistants,
            [event.sessionId]: {
              requestId: event.requestId,
              sessionId: event.sessionId,
              createdAt: new Date().toISOString(),
              lastActivityAt: Date.now(),
              model: event.model,
              reasoningEffort: event.reasoningEffort,
              revision: 0,
              transcript: [],
            },
          }));
          return;
        case "codex.run.delta":
          setStreamingAssistantsBySessionId((currentStreamingAssistants) => {
            const currentStreamingAssistant =
              currentStreamingAssistants[event.sessionId];
            const sessionConfig = resolveStreamingAssistantSessionConfig(
              workspaceRef.current,
              event.sessionId,
            );

            return {
              ...currentStreamingAssistants,
              [event.sessionId]:
                currentStreamingAssistant?.requestId === event.requestId
                  ? {
                      ...currentStreamingAssistant,
                      lastActivityAt: Date.now(),
                      revision: currentStreamingAssistant.revision + 1,
                      transcript: appendRunTranscriptText(
                        currentStreamingAssistant.transcript,
                        event.delta,
                      ),
                    }
                  : {
                      requestId: event.requestId,
                      sessionId: event.sessionId,
                      createdAt: new Date().toISOString(),
                      lastActivityAt: Date.now(),
                      model: currentStreamingAssistant?.model ?? sessionConfig.model,
                      reasoningEffort:
                        currentStreamingAssistant?.reasoningEffort ??
                        sessionConfig.reasoningEffort,
                      revision: 1,
                      transcript: appendRunTranscriptText([], event.delta),
                    },
            };
          });
          return;
        case "codex.run.item.updated":
          setStreamingAssistantsBySessionId((currentStreamingAssistants) => {
            const currentStreamingAssistant =
              currentStreamingAssistants[event.sessionId];
            const sessionConfig = resolveStreamingAssistantSessionConfig(
              workspaceRef.current,
              event.sessionId,
            );

            return {
              ...currentStreamingAssistants,
              [event.sessionId]:
                currentStreamingAssistant?.requestId === event.requestId
                  ? {
                      ...currentStreamingAssistant,
                      lastActivityAt: Date.now(),
                      revision: currentStreamingAssistant.revision + 1,
                      transcript: upsertRunTranscriptItem(
                        currentStreamingAssistant.transcript,
                        event.item,
                      ),
                    }
                  : {
                      requestId: event.requestId,
                      sessionId: event.sessionId,
                      createdAt: new Date().toISOString(),
                      lastActivityAt: Date.now(),
                      model: currentStreamingAssistant?.model ?? sessionConfig.model,
                      reasoningEffort:
                        currentStreamingAssistant?.reasoningEffort ??
                        sessionConfig.reasoningEffort,
                      revision: 1,
                      transcript: upsertRunTranscriptItem([], event.item),
                    },
            };
          });
          return;
        case "codex.run.completed":
          setPendingSendSessionKeys((currentSessionKeys) =>
            removeStateEntry(
              currentSessionKeys,
              getPersistedSessionRuntimeKey(event.sessionId),
            ),
          );
          setStoppingSessionIds((currentSessionIds) =>
            removeStateEntry(currentSessionIds, event.sessionId),
          );
          setWorkspace((currentWorkspace) =>
            currentWorkspace
              ? updateSessionInWorkspace(
                  currentWorkspace,
                  event.sessionId,
                  (session) => ({
                    ...session,
                    status: "已完成",
                    hasUnread: selectedSessionIdRef.current !== event.sessionId,
                  }),
                )
              : currentWorkspace,
          );
          setStreamingAssistantsBySessionId((currentStreamingAssistants) => {
            if (
              currentStreamingAssistants[event.sessionId]?.requestId !==
              event.requestId
            ) {
              return currentStreamingAssistants;
            }

            const nextStreamingAssistants = {
              ...currentStreamingAssistants,
            };

            delete nextStreamingAssistants[event.sessionId];

            return nextStreamingAssistants;
          });
          setChatStatusMessage(null);
          return;
        case "codex.run.failed":
          setPendingSendSessionKeys((currentSessionKeys) =>
            removeStateEntry(
              currentSessionKeys,
              getPersistedSessionRuntimeKey(event.sessionId),
            ),
          );
          setStoppingSessionIds((currentSessionIds) =>
            removeStateEntry(currentSessionIds, event.sessionId),
          );
          setWorkspace((currentWorkspace) =>
            currentWorkspace
              ? updateSessionInWorkspace(
                  currentWorkspace,
                  event.sessionId,
                  (session) => ({
                    ...session,
                    status: "失败",
                    hasUnread: selectedSessionIdRef.current !== event.sessionId,
                  }),
                )
              : currentWorkspace,
          );
          setStreamingAssistantsBySessionId((currentStreamingAssistants) => {
            if (
              currentStreamingAssistants[event.sessionId]?.requestId !==
              event.requestId
            ) {
              return currentStreamingAssistants;
            }

            const nextStreamingAssistants = {
              ...currentStreamingAssistants,
            };

            delete nextStreamingAssistants[event.sessionId];

            return nextStreamingAssistants;
          });
          setChatStatusMessage(event.error);
          return;
        case "codex.run.stopped":
          setPendingSendSessionKeys((currentSessionKeys) =>
            removeStateEntry(
              currentSessionKeys,
              getPersistedSessionRuntimeKey(event.sessionId),
            ),
          );
          setStoppingSessionIds((currentSessionIds) =>
            removeStateEntry(currentSessionIds, event.sessionId),
          );
          setWorkspace((currentWorkspace) =>
            currentWorkspace
              ? updateSessionInWorkspace(
                  currentWorkspace,
                  event.sessionId,
                  (session) => ({
                    ...session,
                    status: "已暂停",
                    hasUnread: selectedSessionIdRef.current !== event.sessionId,
                  }),
                )
              : currentWorkspace,
          );
          setStreamingAssistantsBySessionId((currentStreamingAssistants) => {
            if (
              currentStreamingAssistants[event.sessionId]?.requestId !==
              event.requestId
            ) {
              return currentStreamingAssistants;
            }

            const nextStreamingAssistants = {
              ...currentStreamingAssistants,
            };

            delete nextStreamingAssistants[event.sessionId];

            return nextStreamingAssistants;
          });
          if (selectedSessionIdRef.current === event.sessionId) {
            setChatStatusMessage("已停止当前运行。");
          }
          return;
        default:
          return;
      }
    }

    async function connectWorkspaceRealtime() {
      clearReconnectTimer();
      closeWorkspaceRealtimeStream();
      setWorkspaceRealtimePhase("connecting");
      setWorkspaceRealtimeError(null);

      const abortController = new AbortController();
      workspaceRealtimeAbortControllerRef.current = abortController;

      try {
        const response = await fetch("/api/realtime", {
          cache: "no-store",
          headers: {
            Accept: "text/event-stream",
          },
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error("无法建立本地实时通道。");
        }

        if (!response.body) {
          throw new Error("当前环境不支持读取本地实时流。");
        }

        if (
          cancelled ||
          abortController.signal.aborted ||
          workspaceRealtimeAbortControllerRef.current !== abortController
        ) {
          return;
        }

        setWorkspaceRealtimePhase("connected");
        setWorkspaceRealtimeError(null);

        await readWorkspaceRealtimeStream(response.body, (event) => {
          if (
            cancelled ||
            abortController.signal.aborted ||
            workspaceRealtimeAbortControllerRef.current !== abortController
          ) {
            return;
          }

          handleWorkspaceRealtimeEvent(event);
        });

        if (
          cancelled ||
          abortController.signal.aborted ||
          workspaceRealtimeAbortControllerRef.current !== abortController
        ) {
          return;
        }

        workspaceRealtimeAbortControllerRef.current = null;
        setWorkspaceRealtimePhase("disconnected");
        scheduleReconnect();
      } catch (connectError) {
        if (workspaceRealtimeAbortControllerRef.current === abortController) {
          workspaceRealtimeAbortControllerRef.current = null;
        }

        if (cancelled || abortController.signal.aborted) {
          return;
        }

        setWorkspaceRealtimePhase("error");
        setWorkspaceRealtimeError(
          connectError instanceof Error
            ? connectError.message
            : "本地实时通道连接失败。",
        );
        scheduleReconnect();
      }
    }

    void connectWorkspaceRealtime();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      closeWorkspaceRealtimeStream();
    };
  }, [setConnectionStatus]);

  const projectHomeProject = useMemo(
    () => findProjectById(workspace, routeProjectId),
    [routeProjectId, workspace],
  );
  const { project, session } = useMemo(
    () => {
      if (isProjectHomeRoute) {
        return { project: null, session: null };
      }

      return findSelection(
        workspace,
        effectiveSelectedSessionId,
        effectiveDraftSession,
      );
    },
    [
      effectiveDraftSession,
      effectiveSelectedSessionId,
      isProjectHomeRoute,
      workspace,
    ],
  );
  const sessionConversationHistoryEntries = useMemo(
    () => (session ? buildSessionConversationHistoryEntries(session) : []),
    [session],
  );
  const currentSessionPendingMessages = session
    ? pendingOutgoingMessages[getSessionRuntimeKey(session)] ?? []
    : [];
  const currentSessionPendingMessageCount = currentSessionPendingMessages.length;

  useEffect(() => {
    setComposerDrafts(readComposerDrafts());
    setHasHydratedComposerDrafts(true);
  }, []);

  useEffect(() => {
    setFilePreviewHref(null);
  }, [project?.path]);

  useLayoutEffect(() => {
    const currentSessionId = session?.id ?? null;

    if (currentSessionId === null) {
      lastOpenedSessionIdRef.current = null;
      return;
    }

    if (lastOpenedSessionIdRef.current === currentSessionId) {
      return;
    }

    const viewport = chatViewportRef.current;

    if (!viewport) {
      return;
    }

    lastOpenedSessionIdRef.current = currentSessionId;
    viewport.scrollTop = viewport.scrollHeight;
  }, [session?.id]);

  useEffect(() => {
    const viewport = chatViewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: "auto",
    });
  }, [
    session?.messages.length,
    currentSessionPendingMessageCount,
    currentStreamingAssistant,
    showStreamingAssistantThinking,
  ]);

  useEffect(() => {
    const hasActiveConversationMessage = sessionConversationHistoryEntries.some(
      (entry) => entry.messageId === activeConversationHistoryMessageId,
    );

    if (hasActiveConversationMessage) {
      return;
    }

    setActiveConversationHistoryMessageId(
      sessionConversationHistoryEntries[0]?.messageId ?? null,
    );
  }, [activeConversationHistoryMessageId, sessionConversationHistoryEntries]);

  const sidebarSessions = useMemo<SidebarSessionItem[]>(
    () =>
      workspace
        ? sortSessionsByLatestActivity(
            workspace.projects.flatMap((item) =>
              item.sessions
                .filter((sessionItem) => !sessionItem.isArchived)
                .map((sessionItem) => ({
                  ...sessionItem,
                  projectName: item.name,
                })),
            ),
          )
        : [],
    [workspace],
  );
  const resolvedSidebarSessionDisplayCount = Math.max(
    sidebarSessionDisplayCount,
    SIDEBAR_SESSION_PAGE_SIZE,
  );
  const visibleSidebarSessions = sidebarSessions.slice(
    0,
    resolvedSidebarSessionDisplayCount,
  );
  const hasMoreSidebarSessions =
    sidebarSessions.length > resolvedSidebarSessionDisplayCount;
  const sidebarSessionsAutoLoadSentinelRef = useAutoLoadSentinel({
    hasMore: currentPage === "sessions" && hasMoreSidebarSessions,
    visibleItemCount: visibleSidebarSessions.length,
    scrollViewportElement:
      currentPage === "sessions" ? sidebarScrollViewportElement : null,
    onLoadMore: handleLoadMoreSidebarSessions,
  });
  const archivedProjectGroups = useMemo(
    () =>
      workspace
        ? workspace.projects
            .map((projectItem) => ({
              ...projectItem,
              sessions: sortSessionsByLatestActivity(
                projectItem.sessions.filter((sessionItem) => sessionItem.isArchived),
              ),
            }))
            .filter((projectItem) => projectItem.sessions.length > 0)
        : [],
    [workspace],
  );

  const activeProjectId = project?.id ?? effectiveDraftSession?.projectId ?? null;
  const sessionProviderLabel = session
    ? getProviderLabelForProjectServer({
        projectServer: session.server,
        providerId: session.providerId,
        settings: savedSettings,
      })
    : null;
  const selectedProjectId = isProjectHomeRoute
    ? projectHomeProject?.id ?? null
    : null;
  const isViewingProjectHome = isProjectHomeRoute && Boolean(projectHomeProject);
  const isProjectHomeMissing =
    isProjectHomeRoute && !projectHomeProject && !loading && !error;
  const hasActiveSession = Boolean(project && session);
  const activeSessionServer = session?.server ?? project?.server ?? "codex";
  const activeProjectPath = project?.path ?? null;
  const sessionModelOptions = getModelOptionsForProjectServer(activeSessionServer);
  const sessionReasoningOptions = getReasoningOptionsForProjectServer(
    activeSessionServer,
  );
  const currentSessionKey = session ? getSessionRuntimeKey(session) : null;
  const currentPersistedSessionId =
    session && !isDraftWorkspaceSession(session) ? session.id : null;
  const isEditingCurrentSessionTitle =
    currentPersistedSessionId !== null &&
    sessionRenameState?.sessionId === currentPersistedSessionId;
  const isCurrentSessionRunning = session?.status === "进行中";
  const isCurrentSessionSending =
    currentSessionKey !== null && pendingSendSessionKeys.includes(currentSessionKey);
  const shouldBlockCurrentSessionPromptSubmission =
    isCurrentSessionSending && !isCurrentSessionRunning;
  const isCurrentSessionStopping =
    currentPersistedSessionId !== null &&
    stoppingSessionIds.includes(currentPersistedSessionId);
  const currentSessionQueuedPrompts = session?.queuedPrompts ?? [];
  const hasComposerInput = composerValue.trim().length > 0;
  const activeSessionTitle = session ? getSessionDisplayTitle(session) : "";
  const canQueuePrompt =
    hasActiveSession &&
    hasComposerInput &&
    !shouldBlockCurrentSessionPromptSubmission;
  const canSend =
    hasActiveSession &&
    hasComposerInput &&
    !shouldBlockCurrentSessionPromptSubmission &&
    workspaceRealtimePhase === "connected";
  const canStop =
    hasActiveSession && isCurrentSessionRunning && !isCurrentSessionStopping;
  const shouldShowQueueSubmitAction =
    isCurrentSessionRunning && hasComposerInput;
  const shouldUseDestructiveChatStatusColor = Boolean(
    workspaceRealtimeError ||
      (chatStatusMessage &&
        !/^(已|正在)/u.test(chatStatusMessage.trim())),
  );
  const shouldShowStreamingThinking = Boolean(
    currentStreamingAssistant &&
      (currentStreamingAssistant.transcript.length === 0 ||
        showStreamingAssistantThinking),
  );
  const hasProjects = (workspace?.projects.length ?? 0) > 0;
  const hasCurrentSessionActivity = Boolean(session && currentStreamingAssistant);
  const conversationHistoryEntryCount = sessionConversationHistoryEntries.length;
  const shouldShowSessionWelcomeState = Boolean(
    project &&
      session &&
      session.messages.length === 0 &&
      session.queuedPromptCount === 0 &&
      currentSessionPendingMessageCount === 0 &&
      !hasCurrentSessionActivity,
  );
  const shouldShowConversationHistoryPanel =
    hasActiveSession && isConversationHistoryOpen;
  const isFilePreviewOpen = Boolean(activeProjectPath && filePreviewHref);

  useEffect(() => {
    if (!hasHydratedComposerDrafts) {
      return;
    }

    writeComposerDrafts(composerDrafts);
  }, [composerDrafts, hasHydratedComposerDrafts]);

  useEffect(() => {
    currentSessionKeyRef.current = currentSessionKey;
  }, [currentSessionKey]);

  useEffect(() => {
    if (!sessionRenameState) {
      return;
    }

    if (sessionRenameState.sessionId === currentPersistedSessionId) {
      return;
    }

    setSessionRenameState(null);
    sessionRenameBlurModeRef.current = "save";
  }, [currentPersistedSessionId, sessionRenameState]);

  useEffect(() => {
    if (!isEditingCurrentSessionTitle) {
      return;
    }

    const input = sessionRenameInputRef.current;

    if (!input) {
      return;
    }

    input.focus({
      preventScroll: true,
    });
    input.select();
  }, [isEditingCurrentSessionTitle]);

  function scheduleComposerFocus() {
    if (composerFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(composerFocusFrameRef.current);
    }

    composerFocusFrameRef.current = window.requestAnimationFrame(() => {
      composerFocusFrameRef.current = null;

      const textarea = composerTextareaRef.current;

      if (!textarea || textarea.disabled) {
        return;
      }

      textarea.focus({
        preventScroll: true,
      });

      const caretPosition = textarea.value.length;
      textarea.setSelectionRange(caretPosition, caretPosition);
    });
  }

  useEffect(() => {
    if (!hasHydratedComposerDrafts) {
      return;
    }

    const nextComposerValue =
      currentSessionKey === null ? "" : composerDrafts[currentSessionKey] ?? "";

    setComposerValue((currentValue) =>
      currentValue === nextComposerValue ? currentValue : nextComposerValue,
    );
  }, [composerDrafts, currentSessionKey, hasHydratedComposerDrafts]);

  useEffect(() => {
    if (!currentSessionKey || !shouldFocusComposerOnSessionChangeRef.current) {
      return;
    }

    shouldFocusComposerOnSessionChangeRef.current = false;
    scheduleComposerFocus();
  }, [currentSessionKey]);

  function handleComposerValueChange(nextValue: string) {
    setComposerValue(nextValue);
    setChatStatusMessage(null);

    if (!currentSessionKey) {
      return;
    }

    setComposerDrafts((currentDrafts) =>
      updateComposerDraftMap(currentDrafts, currentSessionKey, nextValue),
    );
  }

  function handleOpenSessionRename() {
    if (!session || isDraftWorkspaceSession(session) || sessionRenameState?.isSaving) {
      return;
    }

    setSessionRenameState({
      sessionId: session.id,
      value: session.name.trim() || getSessionDisplayTitle(session),
      isSaving: false,
    });
    setChatStatusMessage(null);
    sessionRenameBlurModeRef.current = "save";
  }

  function handleCloseSessionRename() {
    if (sessionRenameState?.isSaving) {
      return;
    }

    setSessionRenameState(null);
    sessionRenameBlurModeRef.current = "save";
  }

  function handleSessionRenameValueChange(nextValue: string) {
    setSessionRenameState((currentSessionRenameState) =>
      currentSessionRenameState
        ? {
            ...currentSessionRenameState,
            value: nextValue,
          }
        : currentSessionRenameState,
    );
  }

  async function handleSubmitSessionRename() {
    if (
      !sessionRenameState ||
      sessionRenameState.isSaving ||
      !session ||
      isDraftWorkspaceSession(session) ||
      session.id !== sessionRenameState.sessionId ||
      sessionRenameSubmitInFlightRef.current
    ) {
      return;
    }

    const nextName = sessionRenameState.value.trim();
    const currentName = session.name;

    if (!nextName) {
      setSessionRenameState(null);
      setChatStatusMessage("会话名称不能为空。");
      return;
    }

    if (currentName === nextName) {
      setSessionRenameState(null);
      return;
    }

    sessionRenameSubmitInFlightRef.current = true;
    setSessionRenameState((currentSessionRenameState) =>
      currentSessionRenameState
        ? {
            ...currentSessionRenameState,
            isSaving: true,
          }
        : currentSessionRenameState,
    );
    setChatStatusMessage(null);
    setWorkspace((currentWorkspace) =>
      currentWorkspace
        ? updateSessionNameInWorkspace(currentWorkspace, session.id, nextName)
        : currentWorkspace,
    );

    try {
      const response = await fetch("/api/sessions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: session.id,
          name: nextName,
        }),
      });
      const payload = (await response.json()) as SessionArchivePayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "更新会话名称失败。");
      }

      if (payload.workspace) {
        const nextWorkspace = payload.workspace;
        setWorkspace((currentWorkspace) =>
          mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
        );
        setSelectedSessionId((currentSelectedSessionId) =>
          resolveSelectedSessionId(
            nextWorkspace,
            currentSelectedSessionId,
            Boolean(draftSessionRef.current),
          ),
        );
      }

      setSessionRenameState(null);
    } catch (renameError) {
      setWorkspace((currentWorkspace) =>
        currentWorkspace
          ? updateSessionNameInWorkspace(currentWorkspace, session.id, currentName)
          : currentWorkspace,
      );
      setSessionRenameState((currentSessionRenameState) =>
        currentSessionRenameState
          ? {
              ...currentSessionRenameState,
              isSaving: false,
            }
          : currentSessionRenameState,
      );
      setChatStatusMessage(
        renameError instanceof Error
          ? renameError.message
          : "更新会话名称失败，请重试。",
      );
    } finally {
      sessionRenameSubmitInFlightRef.current = false;
      sessionRenameBlurModeRef.current = "save";
    }
  }

  function handleOpenProjectPicker() {
    if (isCreatingProject) {
      return;
    }

    setIsProjectPickerOpen(true);
  }

  function handleCloseProjectPicker() {
    if (isCreatingProject) {
      return;
    }

    setIsProjectPickerOpen(false);
  }

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("退出登录失败，请稍后重试。");
      }

      handleCloseSettings();
      router.replace("/login");
      router.refresh();
    } catch (logoutError) {
      toast.error(
        logoutError instanceof Error
          ? logoutError.message
          : "退出登录失败，请稍后重试。",
      );
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleCreateProject(projectPath: string) {
    if (isCreatingProject) {
      return;
    }

    const normalizedProjectPath = projectPath.trim();

    if (!normalizedProjectPath) {
      throw new Error("请选择要添加的本地目录。");
    }

    setIsCreatingProject(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectPath: normalizedProjectPath,
        }),
      });
      const payload = (await response.json()) as CreateProjectPayload;

      if (!response.ok || !payload.ok || !payload.workspace || !payload.project) {
        throw new Error(payload.error ?? "新增项目失败。");
      }

      const nextWorkspace = payload.workspace;
      const createdProject = payload.project;
      setWorkspace((currentWorkspace) =>
        mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
      );
      setSelectedSessionId((currentSelectedSessionId) =>
        resolveSelectedSessionId(
          nextWorkspace,
          currentSelectedSessionId,
          Boolean(draftSessionRef.current),
        ),
      );
      setExpandedProjectIds((currentExpandedProjectIds) => [
        createdProject.id,
        ...currentExpandedProjectIds.filter((id) => id !== createdProject.id),
      ]);
      setIsProjectPickerOpen(false);
    } catch (createError) {
      throw (
        createError instanceof Error
          ? createError
          : new Error("新增项目失败，请重试。")
      );
    } finally {
      setIsCreatingProject(false);
    }
  }

  function handleOpenProjectHome(projectItem: WorkspaceProject) {
    router.push(buildProjectHomeHref(projectItem.id));
  }

  function handleOpenProjectRename(projectItem: WorkspaceProject) {
    if (projectRenameState?.isSaving) {
      return;
    }

    setProjectRenameState({
      projectId: projectItem.id,
      value: projectItem.name,
      isSaving: false,
      errorMessage: null,
    });
  }

  function handleCloseProjectRename() {
    if (projectRenameState?.isSaving) {
      return;
    }

    setProjectRenameState(null);
  }

  function handleProjectRenameValueChange(nextValue: string) {
    setProjectRenameState((currentProjectRenameState) =>
      currentProjectRenameState
        ? {
            ...currentProjectRenameState,
            value: nextValue,
            errorMessage: null,
          }
        : currentProjectRenameState,
    );
  }

  async function handleSubmitProjectRename() {
    if (!projectRenameState || projectRenameState.isSaving) {
      return;
    }

    const nextName = projectRenameState.value.trim();

    if (!nextName) {
      setProjectRenameState((currentProjectRenameState) =>
        currentProjectRenameState
          ? {
              ...currentProjectRenameState,
              errorMessage: "项目名称不能为空。",
            }
          : currentProjectRenameState,
      );
      return;
    }

    const currentProject = workspace?.projects.find(
      (projectItem) => projectItem.id === projectRenameState.projectId,
    );

    if (!currentProject) {
      setProjectRenameState(null);
      return;
    }

    if (currentProject.name === nextName) {
      setProjectRenameState(null);
      return;
    }

    setProjectRenameState((currentProjectRenameState) =>
      currentProjectRenameState
        ? {
            ...currentProjectRenameState,
            isSaving: true,
            errorMessage: null,
          }
        : currentProjectRenameState,
    );

    try {
      const response = await fetch("/api/projects", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: projectRenameState.projectId,
          name: nextName,
        }),
      });
      const payload = (await response.json()) as RenameProjectPayload;

      if (!response.ok || !payload.ok || !payload.workspace) {
        throw new Error(payload.error ?? "更新项目名称失败。");
      }

      const nextWorkspace = payload.workspace;
      setWorkspace((currentWorkspace) =>
        mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
      );
      setSelectedSessionId((currentSelectedSessionId) =>
        resolveSelectedSessionId(
          nextWorkspace,
          currentSelectedSessionId,
          Boolean(draftSessionRef.current),
        ),
      );
      setProjectRenameState(null);
    } catch (renameError) {
      setProjectRenameState((currentProjectRenameState) =>
        currentProjectRenameState
          ? {
              ...currentProjectRenameState,
              isSaving: false,
              errorMessage:
                renameError instanceof Error
                  ? renameError.message
                  : "更新项目名称失败，请重试。",
            }
          : currentProjectRenameState,
      );
    }
  }

  async function handleProjectServerChange(
    projectId: number,
    server: WorkspaceProjectServer,
  ) {
    if (!workspace) {
      return;
    }

    const currentProject = findProjectById(workspace, projectId);

    if (!currentProject || projectServerUpdateState?.projectId === projectId) {
      return;
    }

    const nextServer = normalizeWorkspaceProjectServer(server);

    if (currentProject.server === nextServer) {
      return;
    }

    const previousServer = currentProject.server;

    setProjectServerUpdateState({
      projectId,
      server: nextServer,
    });
    setWorkspace((currentWorkspace) =>
      currentWorkspace
        ? updateProjectServerInWorkspace(currentWorkspace, projectId, nextServer)
        : currentWorkspace,
    );

    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          server: nextServer,
        }),
      });
      const payload = (await response.json()) as UpdateProjectServerPayload;

      if (!response.ok || !payload.ok || !payload.workspace) {
        throw new Error(payload.error ?? "更新项目 server 失败。");
      }

      const nextWorkspace = payload.workspace;
      setWorkspace((currentWorkspace) =>
        mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
      );
      setSelectedSessionId((currentSelectedSessionId) =>
        resolveSelectedSessionId(
          nextWorkspace,
          currentSelectedSessionId,
          Boolean(draftSessionRef.current),
        ),
      );
    } catch (updateError) {
      setWorkspace((currentWorkspace) =>
        currentWorkspace
          ? updateProjectServerInWorkspace(
              currentWorkspace,
              projectId,
              previousServer,
            )
          : currentWorkspace,
      );
      toast.error(
        updateError instanceof Error
          ? updateError.message
          : "更新项目 server 失败，请重试。",
      );
    } finally {
      setProjectServerUpdateState((currentState) =>
        currentState?.projectId === projectId ? null : currentState,
      );
    }
  }

  async function handleRemoveProject(projectItem: WorkspaceProject) {
    if (projectActionState) {
      return;
    }

    const shouldResetCurrentView =
      activeProjectId === projectItem.id ||
      draftSessionRef.current?.projectId === projectItem.id;
    const hasRemainingDraftSession =
      Boolean(draftSessionRef.current) &&
      draftSessionRef.current?.projectId !== projectItem.id;
    const shouldLeaveProjectHome =
      isProjectHomeRoute && routeProjectId === projectItem.id;

    setProjectActionState({
      projectId: projectItem.id,
      action: "remove",
    });

    try {
      const response = await fetch("/api/projects", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: projectItem.id,
        }),
      });
      const payload = (await response.json()) as RemoveProjectPayload;

      if (!response.ok || !payload.ok || !payload.workspace || !payload.removedProject) {
        throw new Error(payload.error ?? "移除项目失败。");
      }

      const nextWorkspace = payload.workspace;

      if (draftSessionRef.current?.projectId === projectItem.id) {
        pendingDraftSessionRef.current = null;
        setDraftSession(null);
      }

      if (shouldResetCurrentView) {
        setComposerValue("");
        setChatStatusMessage(null);
        setStreamingAssistantsBySessionId({});
      }

      setWorkspace((currentWorkspace) =>
        mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
      );
      setSelectedSessionId((currentSelectedSessionId) =>
        resolveSelectedSessionId(
          nextWorkspace,
          currentSelectedSessionId,
          hasRemainingDraftSession,
        ),
      );

      if (shouldLeaveProjectHome) {
        router.push("/projects");
      }
    } catch (removeError) {
      console.error(removeError);
    } finally {
      setProjectActionState(null);
    }
  }

  async function handleArchiveSession(sessionItem: WorkspaceSession) {
    if (sessionActionState) {
      return;
    }

    setSessionActionState({
      sessionId: sessionItem.id,
      action: "archive",
    });

    try {
      const response = await fetch("/api/sessions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: sessionItem.id,
          archived: true,
        }),
      });
      const payload = (await response.json()) as SessionArchivePayload;

      if (!response.ok || !payload.ok || !payload.workspace) {
        throw new Error(payload.error ?? "归档会话失败。");
      }

      const nextWorkspace = payload.workspace;
      const isDeletingSelectedSession = selectedSessionIdRef.current === sessionItem.id;
      const shouldFallbackToProjectSession =
        isDeletingSelectedSession && currentPage !== "archive";
      const fallbackProjectSessionId = shouldFallbackToProjectSession
        ? findFirstProjectSessionIdByArchiveState(
            nextWorkspace,
            sessionItem.projectId,
            false,
          )
        : null;
      const fallbackArchivedSessionId =
        isDeletingSelectedSession && currentPage === "archive"
          ? findFirstProjectSessionIdByArchiveState(
              nextWorkspace,
              sessionItem.projectId,
              true,
            ) ?? findFirstSessionIdByArchiveState(nextWorkspace, true)
          : null;

      setWorkspace((currentWorkspace) =>
        mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
      );

      if (shouldFallbackToProjectSession) {
        if (fallbackProjectSessionId !== null) {
          const fallbackProjectId = findProjectIdBySessionId(
            nextWorkspace,
            fallbackProjectSessionId,
          );

          setSelectedSessionId(fallbackProjectSessionId);

          if (fallbackProjectId !== null) {
            router.push(
              buildProjectSessionHref(
                fallbackProjectId,
                fallbackProjectSessionId,
              ),
            );
          }

          if (nextWorkspace.selectedSessionId !== fallbackProjectSessionId) {
            void persistSessionConfig(fallbackProjectSessionId, {
              makeActive: true,
            }).catch(() => undefined);
          }
        } else {
          router.push(buildProjectHomeHref(sessionItem.projectId));
        }
      } else if (fallbackArchivedSessionId !== null) {
        const fallbackProjectId = findProjectIdBySessionId(
          nextWorkspace,
          fallbackArchivedSessionId,
        );

        setSelectedSessionId(fallbackArchivedSessionId);

        if (fallbackProjectId !== null) {
          router.push(
            buildProjectSessionHref(
              fallbackProjectId,
              fallbackArchivedSessionId,
            ),
          );
        }

        if (nextWorkspace.selectedSessionId !== fallbackArchivedSessionId) {
          void persistSessionConfig(fallbackArchivedSessionId, {
            makeActive: true,
          }).catch(() => undefined);
        }
      } else {
        setSelectedSessionId((currentSelectedSessionId) =>
          resolveSelectedSessionId(
            nextWorkspace,
            currentSelectedSessionId,
            Boolean(draftSessionRef.current),
          ),
        );
      }

      setChatStatusMessage(null);
      toast.success("归档成功", {
        description: `会话「${getSessionDisplayTitle(sessionItem)}」已移入归档。`,
      });
    } catch (archiveError) {
      setChatStatusMessage(
        archiveError instanceof Error
          ? archiveError.message
          : "归档会话失败，请重试。",
      );
    } finally {
      setSessionActionState(null);
    }
  }

  async function handleDeleteSession(sessionItem: WorkspaceSession) {
    if (sessionActionState) {
      return;
    }

    const sessionTitle = getSessionDisplayTitle(sessionItem);

    setSessionActionState({
      sessionId: sessionItem.id,
      action: "delete",
    });

    try {
      const response = await fetch("/api/sessions", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: sessionItem.id,
        }),
      });
      const payload = (await response.json()) as RemoveSessionPayload;

      if (!response.ok || !payload.ok || !payload.workspace || !payload.removedSession) {
        throw new Error(payload.error ?? "删除会话失败。");
      }

      const nextWorkspace = payload.workspace;
      const shouldFallbackSelection =
        selectedSessionIdRef.current === sessionItem.id && currentPage !== "archive";
      const fallbackProjectSessionId = shouldFallbackSelection
        ? findFirstProjectSessionIdByArchiveState(
            nextWorkspace,
            sessionItem.projectId,
            false,
          )
        : null;

      setWorkspace((currentWorkspace) =>
        mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
      );

      if (shouldFallbackSelection) {
        if (fallbackProjectSessionId !== null) {
          const fallbackProjectId = findProjectIdBySessionId(
            nextWorkspace,
            fallbackProjectSessionId,
          );

          setSelectedSessionId(fallbackProjectSessionId);

          if (fallbackProjectId !== null) {
            router.push(
              buildProjectSessionHref(
                fallbackProjectId,
                fallbackProjectSessionId,
              ),
            );
          }

          if (nextWorkspace.selectedSessionId !== fallbackProjectSessionId) {
            void persistSessionConfig(fallbackProjectSessionId, {
              makeActive: true,
            }).catch(() => undefined);
          }
        } else {
          router.push(buildProjectHomeHref(sessionItem.projectId));
        }
      } else {
        setSelectedSessionId((currentSelectedSessionId) =>
          resolveSelectedSessionId(
            nextWorkspace,
            currentSelectedSessionId,
            Boolean(draftSessionRef.current),
          ),
        );
      }

      setChatStatusMessage(null);
      toast.success("删除成功", {
        description: `会话「${sessionTitle}」已删除。`,
      });
    } catch (deleteError) {
      setChatStatusMessage(
        deleteError instanceof Error
          ? deleteError.message
          : "删除会话失败，请重试。",
      );
    } finally {
      setSessionActionState(null);
    }
  }

  async function persistSessionConfig(
    sessionId: number,
    body: {
      model?: string;
      reasoningEffort?: WorkspaceReasoningEffort;
      makeActive?: boolean;
    },
  ) {
    const response = await fetch("/api/session-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        ...body,
      }),
    });
    const payload = (await response.json()) as SessionConfigPayload;
    const shouldMergeWorkspace =
      body.model !== undefined || body.reasoningEffort !== undefined;

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "会话配置保存失败。");
    }

    if (!shouldMergeWorkspace) {
      return;
    }

    if (!payload.workspace) {
      throw new Error("会话配置保存失败。");
    }

    const nextWorkspace = payload.workspace;

    setWorkspace((currentWorkspace) =>
      mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
    );
    setSelectedSessionId((currentSelectedSessionId) =>
      resolveSelectedSessionId(
        nextWorkspace,
        currentSelectedSessionId,
        Boolean(draftSessionRef.current),
      ),
    );
  }

  useEffect(() => {
    if (!workspace || effectiveSelectedSessionId === null) {
      return;
    }

    const selectedSession = findSessionById(workspace, effectiveSelectedSessionId);

    if (!selectedSession?.hasUnread) {
      return;
    }

    setWorkspace((currentWorkspace) =>
      currentWorkspace
        ? updateSessionUnreadStateInWorkspace(
            currentWorkspace,
            effectiveSelectedSessionId,
            false,
          )
        : currentWorkspace,
    );

    void persistSessionConfig(effectiveSelectedSessionId, {
      makeActive: true,
    }).catch(() => undefined);
  }, [effectiveSelectedSessionId, workspace]);

  function handleSelectSession(sessionId: number) {
    if (
      !isProjectHomeRoute &&
      effectiveSelectedSessionId === sessionId &&
      !draftSessionRef.current
    ) {
      scheduleComposerFocus();
      return;
    }

    const projectId = workspace
      ? findProjectIdBySessionId(workspace, sessionId)
      : null;

    shouldFocusComposerOnSessionChangeRef.current = true;
    setSelectedSessionId(sessionId);
    setChatStatusMessage(null);
    setWorkspace((currentWorkspace) =>
      currentWorkspace
        ? updateSessionUnreadStateInWorkspace(currentWorkspace, sessionId, false)
        : currentWorkspace,
    );

    if (projectId !== null) {
      const nextHref = buildProjectSessionHref(projectId, sessionId);

      window.history.pushState(null, "", nextHref);
    }

    void persistSessionConfig(sessionId, { makeActive: true }).catch(
      (saveError) => {
        setChatStatusMessage(
          saveError instanceof Error
            ? saveError.message
            : "切换会话失败，请重试。",
        );
      },
    );
  }

  function handleToggleConversationHistory() {
    setIsConversationHistoryOpen((currentState) => !currentState);
  }

  function handleCloseConversationHistory() {
    setIsConversationHistoryOpen(false);
  }

  function handleOpenFilePreview(href: string) {
    setFilePreviewHref(href);
  }

  function handleCloseFilePreview() {
    setFilePreviewHref(null);
  }

  function handleSelectConversationHistoryMessage(messageId: number) {
    setActiveConversationHistoryMessageId(messageId);

    const viewport = chatViewportRef.current;

    if (!viewport) {
      return;
    }

    const targetMessage = viewport.querySelector<HTMLElement>(
      `[data-workspace-message-id="${messageId}"]`,
    );

    if (!targetMessage) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const targetRect = targetMessage.getBoundingClientRect();
    const nextTop =
      viewport.scrollTop +
      (targetRect.top - viewportRect.top) -
      viewport.clientHeight / 2 +
      targetRect.height / 2;

    viewport.scrollTo({
      top: Math.max(nextTop, 0),
      behavior: "smooth",
    });
  }

  function handleToggleProject(projectId: number) {
    setExpandedProjectIds((currentExpandedProjectIds) => {
      const isCurrentlyExpanded = currentExpandedProjectIds.includes(projectId);

      if (isCurrentlyExpanded) {
        setProjectSessionDisplayCounts((currentProjectSessionDisplayCounts) => ({
          ...currentProjectSessionDisplayCounts,
          [projectId]: PROJECT_SESSION_PAGE_SIZE,
        }));

        return currentExpandedProjectIds.filter((id) => id !== projectId);
      }

      return [projectId, ...currentExpandedProjectIds];
    });
  }

  async function handleLoadMoreProjectSessions(projectId: number) {
    if (!workspace || loadingMoreProjectSessionIds.includes(projectId)) {
      return;
    }

    const projectItem = findProjectById(workspace, projectId);

    if (!projectItem) {
      return;
    }

    const currentVisibleCount = Math.max(
      projectSessionDisplayCounts[projectId] ?? PROJECT_SESSION_PAGE_SIZE,
      PROJECT_SESSION_PAGE_SIZE,
    );

    if (projectItem.validSessionCount <= currentVisibleCount) {
      return;
    }

    setLoadingMoreProjectSessionIds((currentProjectIds) =>
      currentProjectIds.includes(projectId)
        ? currentProjectIds
        : [...currentProjectIds, projectId],
    );

    try {
      const searchParams = new URLSearchParams({
        projectId: String(projectId),
        offset: String(currentVisibleCount),
        limit: String(PROJECT_SESSION_PAGE_SIZE),
      });
      const response = await fetch(`/api/sessions?${searchParams.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as ProjectSessionsPagePayload | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "加载更多会话失败。");
      }

      const loadedSessionCount = payload.sessions?.length ?? 0;

      setProjectSessionDisplayCounts((currentProjectSessionDisplayCounts) => {
        const resolvedCurrentCount = Math.max(
          currentProjectSessionDisplayCounts[projectId] ??
            PROJECT_SESSION_PAGE_SIZE,
          PROJECT_SESSION_PAGE_SIZE,
        );
        let nextVisibleCount = Math.max(
          resolvedCurrentCount,
          (payload.offset ?? currentVisibleCount) + loadedSessionCount,
        );

        if (typeof payload.totalCount === "number" && !payload.hasMore) {
          nextVisibleCount = Math.max(nextVisibleCount, payload.totalCount);
        }

        return {
          ...currentProjectSessionDisplayCounts,
          [projectId]: nextVisibleCount,
        };
      });
    } catch (loadError) {
      toast.error(
        loadError instanceof Error ? loadError.message : "加载更多会话失败。",
      );
    } finally {
      setLoadingMoreProjectSessionIds((currentProjectIds) =>
        removeStateEntry(currentProjectIds, projectId),
      );
    }
  }

  function handleLoadMoreSidebarSessions() {
    setSidebarSessionDisplayCount(
      (currentCount) => currentCount + SIDEBAR_SESSION_LOAD_MORE_COUNT,
    );
  }

  function handleCreateDraftSession(projectItem: WorkspaceProject) {
    if (isProjectHomeRoute || routeSessionId !== null) {
      router.push("/");
    }

    const defaultSessionConfig = resolveDefaultSessionConfigForProjectServer(
      projectItem.server,
      savedSettings,
    );
    const nextDraftSession: DraftWorkspaceSession = {
      id: -Date.now(),
      clientId: globalThis.crypto.randomUUID(),
      isDraft: true,
      projectId: projectItem.id,
      server: projectItem.server,
      createdAt: new Date().toISOString(),
      name: "新会话",
      preview: "",
      providerId: defaultSessionConfig.providerId,
      model: defaultSessionConfig.model,
      reasoningEffort: defaultSessionConfig.reasoningEffort,
      durationMs: 0,
      durationMinutes: 0,
      status: "未开始",
      hasUnread: false,
      isArchived: false,
      queuedPromptCount: 0,
      queuedPrompts: [],
      messages: [],
    };

    shouldFocusComposerOnSessionChangeRef.current = true;
    pendingDraftSessionRef.current = null;
    setDraftSession(nextDraftSession);
    setSelectedSessionId(null);
    setChatStatusMessage(null);
    setExpandedProjectIds((currentExpandedProjectIds) =>
      currentExpandedProjectIds.includes(projectItem.id)
        ? currentExpandedProjectIds
        : [projectItem.id, ...currentExpandedProjectIds],
    );
  }

  function handleDraftSessionServerChange(server: WorkspaceProjectServer) {
    if (!session || !isDraftWorkspaceSession(session)) {
      return;
    }

    const nextServer = normalizeWorkspaceProjectServer(server);

    if (session.server === nextServer) {
      return;
    }

    const defaultSessionConfig = resolveDefaultSessionConfigForProjectServer(
      nextServer,
      savedSettings,
    );

    setDraftSession((currentDraftSession) => {
      if (!currentDraftSession || currentDraftSession.clientId !== session.clientId) {
        return currentDraftSession;
      }

      return {
        ...currentDraftSession,
        server: nextServer,
        providerId: defaultSessionConfig.providerId,
        model: defaultSessionConfig.model,
        reasoningEffort: defaultSessionConfig.reasoningEffort,
      };
    });
    setChatStatusMessage(null);
  }

  async function handleSessionConfigChange(
    field: "model" | "reasoningEffort",
    value: string,
  ) {
    if (!session) {
      return;
    }

    if (isDraftWorkspaceSession(session)) {
      setDraftSession((currentDraftSession) => {
        if (!currentDraftSession || currentDraftSession.clientId !== session.clientId) {
          return currentDraftSession;
        }

        return {
          ...currentDraftSession,
          model: field === "model" ? value : currentDraftSession.model,
          reasoningEffort:
            field === "reasoningEffort"
              ? (value as WorkspaceReasoningEffort)
              : currentDraftSession.reasoningEffort,
        };
      });
      setChatStatusMessage(null);
      return;
    }

    if (!workspace) {
      return;
    }

    const previousConfig = {
      model: session.model,
      reasoningEffort: session.reasoningEffort,
    };
    const nextConfig = {
      model: field === "model" ? value : session.model,
      reasoningEffort:
        field === "reasoningEffort"
          ? (value as WorkspaceReasoningEffort)
          : session.reasoningEffort,
    };

    setWorkspace((currentWorkspace) =>
      currentWorkspace
        ? updateSessionAgentConfigInWorkspace(
            currentWorkspace,
            session.id,
            nextConfig,
          )
        : currentWorkspace,
    );
    setChatStatusMessage(null);

    try {
      await persistSessionConfig(session.id, nextConfig);
    } catch (saveError) {
      setWorkspace((currentWorkspace) =>
        currentWorkspace
          ? updateSessionAgentConfigInWorkspace(
              currentWorkspace,
              session.id,
              previousConfig,
            )
          : currentWorkspace,
      );
      setChatStatusMessage(
        saveError instanceof Error
          ? saveError.message
          : "会话配置保存失败，请重试。",
      );
    }
  }

  async function handleSendPrompt() {
    const prompt = composerValue.trim();
    const shouldQueueIntoCurrentSession = isCurrentSessionRunning;
    const shouldBlockPromptSubmission =
      isCurrentSessionSending && !shouldQueueIntoCurrentSession;

    if (!prompt || !session || shouldBlockPromptSubmission) {
      return;
    }

    if (
      workspaceRealtimePhase !== "connected" &&
      !shouldQueueIntoCurrentSession
    ) {
      setChatStatusMessage(
        workspaceRealtimeError ?? "本地实时通道未连接，暂时无法发送。",
      );
      return;
    }

    const sessionKey = getSessionRuntimeKey(session);
    const composerDraftToRestore = composerValue;
    const targetSessionId = isDraftWorkspaceSession(session) ? null : session.id;
    const pendingMessageLocalId = `pending-${pendingOutgoingMessageSequenceRef.current++}`;
    const pendingMessageCreatedAt = new Date().toISOString();

    setPendingSendSessionKeys((currentSessionKeys) =>
      appendUniqueStateEntry(currentSessionKeys, sessionKey),
    );
    setPendingOutgoingMessages((currentPendingMessages) =>
      appendPendingOutgoingMessage(currentPendingMessages, sessionKey, {
        localId: pendingMessageLocalId,
        content: prompt,
        createdAt: pendingMessageCreatedAt,
      }),
    );
    handleComposerValueChange("");

    try {
      if (isDraftWorkspaceSession(session)) {
        pendingDraftSessionRef.current = session.clientId;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          sessionId: targetSessionId,
          projectId: isDraftWorkspaceSession(session) ? session.projectId : null,
          server: session.server,
          providerId: session.providerId,
          model: session.model,
          reasoningEffort: session.reasoningEffort,
        }),
      });
      const payload = (await response.json()) as ChatResponsePayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "消息发送失败。");
      }

      if (payload.workspace) {
        const nextWorkspace = payload.workspace;
        const currentDraftSession = draftSessionRef.current;
        const shouldAdoptPendingDraftSession =
          Boolean(pendingDraftSessionRef.current) &&
          Boolean(currentDraftSession) &&
          findProjectIdBySessionId(
            nextWorkspace,
            nextWorkspace.selectedSessionId,
          ) === currentDraftSession?.projectId;

        setWorkspace((currentWorkspace) =>
          mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
        );

        if (shouldAdoptPendingDraftSession) {
          pendingDraftSessionRef.current = null;
          setDraftSession(null);
          setSelectedSessionId(nextWorkspace.selectedSessionId);
        } else {
          setSelectedSessionId((currentSelectedSessionId) =>
            resolveSelectedSessionId(
              nextWorkspace,
              currentSelectedSessionId,
              Boolean(currentDraftSession),
            ),
          );
        }

        const nextSessionId =
          shouldAdoptPendingDraftSession &&
          typeof nextWorkspace.selectedSessionId === "number"
            ? nextWorkspace.selectedSessionId
            : null;

        if (nextSessionId !== null) {
          const nextSessionKey = getPersistedSessionRuntimeKey(nextSessionId);

          setPendingOutgoingMessages((currentPendingMessages) =>
            movePendingOutgoingMessages(
              currentPendingMessages,
              sessionKey,
              nextSessionKey,
            ),
          );

          if (payload.result?.status !== "queued") {
            setPendingOutgoingMessages((currentPendingMessages) =>
              removePendingOutgoingMessageById(
                currentPendingMessages,
                nextSessionKey,
                pendingMessageLocalId,
              ),
            );
          }
        } else if (payload.result?.status !== "queued") {
          setPendingOutgoingMessages((currentPendingMessages) =>
            removePendingOutgoingMessageById(
              currentPendingMessages,
              sessionKey,
              pendingMessageLocalId,
            ),
          );
        }
      }

      setChatStatusMessage(
        payload.result?.status === "queued"
          ? shouldQueueIntoCurrentSession
            ? null
            : "已加入待执行队列，当前没有可用的 provider。"
          : null,
      );
    } catch (sendError) {
      setChatStatusMessage(
        sendError instanceof Error ? sendError.message : "消息发送失败。",
      );
      setPendingOutgoingMessages((currentPendingMessages) =>
        removePendingOutgoingMessageById(
          currentPendingMessages,
          sessionKey,
          pendingMessageLocalId,
        ),
      );
      setComposerDrafts((currentDrafts) =>
        updateComposerDraftMap(
          currentDrafts,
          sessionKey,
          composerDraftToRestore,
        ),
      );
      if (currentSessionKeyRef.current === sessionKey) {
        setComposerValue(composerDraftToRestore);
      }
      if (isDraftWorkspaceSession(session)) {
        pendingDraftSessionRef.current = null;
      }
    } finally {
      setPendingSendSessionKeys((currentSessionKeys) =>
        removeStateEntry(currentSessionKeys, sessionKey),
      );
    }
  }

  async function handleRemoveQueuedPrompt(queuedPromptId: number) {
    if (removingQueuedPromptIds.includes(queuedPromptId)) {
      return;
    }

    const sessionKey = currentSessionKey;
    const removedQueuedPrompt =
      currentSessionQueuedPrompts.find((prompt) => prompt.id === queuedPromptId) ??
      null;

    setRemovingQueuedPromptIds((currentPromptIds) =>
      appendUniqueStateEntry(currentPromptIds, queuedPromptId),
    );

    try {
      const response = await fetch("/api/sessions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          queuedPromptId,
        }),
      });
      const payload = (await response.json()) as QueuedPromptMutationPayload;

      if (!response.ok || !payload.ok || !payload.workspace) {
        throw new Error(payload.error ?? "移除排队项失败。");
      }

      const nextWorkspace = payload.workspace;
      const currentDraftSession = draftSessionRef.current;

      setWorkspace((currentWorkspace) =>
        mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
      );
      setSelectedSessionId((currentSelectedSessionId) =>
        resolveSelectedSessionId(
          nextWorkspace,
          currentSelectedSessionId,
          Boolean(currentDraftSession),
        ),
      );
      if (sessionKey && removedQueuedPrompt) {
        setPendingOutgoingMessages((currentPendingMessages) =>
          removePendingOutgoingMessageByContent(
            currentPendingMessages,
            sessionKey,
            removedQueuedPrompt.content,
          ),
        );
      }
      setChatStatusMessage("已从会话队列中移除。");
    } catch (removeError) {
      setChatStatusMessage(
        removeError instanceof Error
          ? removeError.message
          : "移除排队项失败，请重试。",
      );
    } finally {
      setRemovingQueuedPromptIds((currentPromptIds) =>
        removeStateEntry(currentPromptIds, queuedPromptId),
      );
    }
  }

  async function handleStopPrompt() {
    if (!session || !isCurrentSessionRunning || isCurrentSessionStopping) {
      return;
    }

    if (isDraftWorkspaceSession(session)) {
      return;
    }

    const sessionId = session.id;

    setStoppingSessionIds((currentSessionIds) =>
      appendUniqueStateEntry(currentSessionIds, sessionId),
    );
    setChatStatusMessage("正在停止当前运行...");

    try {
      const response = await fetch("/api/chat", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
        }),
      });
      const payload = (await response.json()) as StopChatResponsePayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "停止当前运行失败。");
      }

      if (payload.workspace) {
        const nextWorkspace = payload.workspace;
        const currentDraftSession = draftSessionRef.current;

        setWorkspace((currentWorkspace) =>
          mergeIncomingWorkspacePayload(currentWorkspace, nextWorkspace),
        );
        setSelectedSessionId((currentSelectedSessionId) =>
          resolveSelectedSessionId(
            nextWorkspace,
            currentSelectedSessionId,
            Boolean(currentDraftSession),
          ),
        );
      }

      if (payload.state === "idle") {
        setChatStatusMessage(
          t("当前会话没有正在执行的任务。", "There is no running task in the current session."),
        );
      } else if (payload.state === "stopped") {
        setChatStatusMessage(t("已停止当前运行。", "Stopped the current run."));
      }
    } catch (stopError) {
      setChatStatusMessage(
        stopError instanceof Error
          ? translateError(stopError.message)
          : t("停止当前运行失败。", "Failed to stop the current run."),
      );
    } finally {
      setStoppingSessionIds((currentSessionIds) =>
        removeStateEntry(currentSessionIds, sessionId),
      );
    }
  }

  if (loading) {
    return <LoadingWorkspace />;
  }

  if (error || !workspace) {
    return (
      <ErrorState
        message={
          error ??
          t(
            "当前没有可展示的工作区数据。",
            "There is no workspace data to display right now.",
          )
        }
      />
    );
  }

  const archivedSessionCount = archivedProjectGroups.reduce(
    (totalCount, projectGroup) => totalCount + projectGroup.sessions.length,
    0,
  );
  const sidebarPanelMeta =
    currentPage === "sessions"
      ? {
          title: t(`会话（${sidebarSessions.length}条）`, `Sessions (${sidebarSessions.length})`),
          showCreateButton: false,
        }
      : currentPage === "archive"
        ? {
            title: t(
              `已归档（${archivedSessionCount}条）`,
              `Archived (${archivedSessionCount})`,
            ),
            showCreateButton: false,
          }
        : {
            title: t(
              `项目（${workspace.projects.length}个）`,
              `Projects (${workspace.projects.length})`,
            ),
            showCreateButton: true,
          };

  const renderWorkspaceSidebarPanel = (isFloating: boolean) => (
    <div
      className={cn(
        "h-full min-h-0 flex-col overflow-hidden bg-[#F6F5F4] backdrop-blur-xl",
        isFloating
          ? "fixed inset-y-0 left-0 z-[1000] flex w-[min(18rem,calc(100vw-1rem))] rounded-r-[28px] border-r border-black/6 shadow-[18px_0_48px_rgba(15,23,42,0.16)] lg:hidden"
          : "hidden lg:flex",
      )}
    >
      <div className="shrink-0 px-5 pb-3 pt-3 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            aria-label={t("返回项目列表", "Back to Projects")}
            className="group flex min-w-0 items-center gap-2.5"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#070d24] text-white shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-transform group-hover:scale-[1.02]">
              <Code2 className="size-[0.9rem] stroke-[2]" />
            </span>
            <span className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[#1f2937]">
              Playcode
            </span>
          </Link>

          <div className="flex items-center gap-2">
            {sidebarPanelMeta.showCreateButton ? (
              <Button
                type="button"
                variant="ghost"
                className="h-8 shrink-0 gap-1.5 rounded-full bg-white/80 px-3 text-[13px] font-medium text-[#4a4a48] shadow-none transition-colors hover:bg-black hover:text-white"
                aria-label={t("新项目", "New Project")}
                onClick={handleOpenProjectPicker}
                disabled={isCreatingProject}
              >
                {isCreatingProject ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                <span className="max-lg:hidden">{t("新项目", "New Project")}</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-full text-[#5e6775] hover:bg-black/[0.04] hover:text-[#111111] lg:hidden"
              aria-label={t("收起菜单", "Collapse Menu")}
              onClick={() => setIsMobileSidebarOpen(false)}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </div>
        </div>

        {currentPage !== "projects" ? (
          <div className="pt-3">
            <div className={WORKSPACE_SIDEBAR_HEADER_TITLE_CLASS_NAME}>
              {sidebarPanelMeta.title}
            </div>
          </div>
        ) : null}
      </div>

      {currentPage === "projects" ? (
        <ScrollArea
          className="min-h-0 flex-1 px-3 pb-1 pt-2 md:px-4"
          viewportRef={sidebarScrollViewportRef}
        >
          <div className="space-y-1">
            {workspace.projects.map((item) => (
              <ProjectListGroup
                key={item.id}
                project={item}
                selectedSessionId={effectiveSelectedSessionId}
                isExpanded={expandedProjectIds.includes(item.id)}
                isSelected={selectedProjectId === item.id}
                isDraftActive={
                  Boolean(effectiveDraftSession) &&
                  effectiveSelectedSessionId === null &&
                  effectiveDraftSession?.projectId === item.id
                }
                onToggleProject={handleToggleProject}
                visibleSessionCount={
                  projectSessionDisplayCounts[item.id] ??
                  PROJECT_SESSION_PAGE_SIZE
                }
                isLoadingMoreSessions={loadingMoreProjectSessionIds.includes(
                  item.id,
                )}
                onLoadMoreSessions={handleLoadMoreProjectSessions}
                isRemovingProject={
                  projectActionState?.projectId === item.id &&
                  projectActionState.action === "remove"
                }
                onOpenProjectHome={handleOpenProjectHome}
                onOpenProjectRename={handleOpenProjectRename}
                onRemoveProject={handleRemoveProject}
                onCreateDraftSession={handleCreateDraftSession}
                onSelectSession={handleSelectSession}
                sessionActionState={sessionActionState}
                onArchiveSession={handleArchiveSession}
                onDeleteSession={handleDeleteSession}
              />
            ))}
            {workspace.projects.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-black/10 px-4 py-5 text-sm leading-6 text-muted-foreground">
                {t(
                  "还没有项目，点击右上角“新项目”开始使用。",
                  'No projects yet. Click "New Project" in the top-right to get started.',
                )}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      ) : null}

      {currentPage === "sessions" ? (
        <ScrollArea
          className="min-h-0 flex-1 px-4 py-4"
          viewportRef={sidebarScrollViewportRef}
        >
          <div className="space-y-1.5">
            {visibleSidebarSessions.map((item) => (
              <SessionListItem
                key={item.id}
                session={item}
                isActive={effectiveSelectedSessionId === item.id}
                hasUnread={item.hasUnread}
                onSelectSession={handleSelectSession}
                sessionActionState={sessionActionState}
                onArchiveSession={handleArchiveSession}
                onDeleteSession={handleDeleteSession}
              />
            ))}
            {sidebarSessions.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-black/10 px-4 py-5 text-sm leading-6 text-muted-foreground">
                {t(
                  "暂无未归档会话，先在项目页创建一个新会话。",
                  "There are no unarchived sessions yet. Create one from the project page first.",
                )}
              </div>
            ) : null}
            {hasMoreSidebarSessions ? (
              <div
                ref={sidebarSessionsAutoLoadSentinelRef}
                className="h-4 w-full"
                aria-hidden="true"
              />
            ) : null}
          </div>
        </ScrollArea>
      ) : null}

      {currentPage === "archive" ? (
        <ScrollArea className="min-h-0 flex-1 px-4 py-4">
          <div className="space-y-3">
            {archivedProjectGroups.map((item) => (
              <ArchivedProjectGroup
                key={item.id}
                project={item}
                selectedSessionId={effectiveSelectedSessionId}
                onSelectSession={handleSelectSession}
                sessionActionState={sessionActionState}
                onDeleteSession={handleDeleteSession}
              />
            ))}
            {archivedProjectGroups.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-black/10 px-4 py-5 text-sm leading-6 text-muted-foreground">
                {t("暂无归档会话。", "There are no archived sessions yet.")}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      ) : null}

      <div className="shrink-0 px-4 py-1 pb-2 md:px-5">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleToggleSettings}
            className="inline-flex h-8 items-center gap-2 text-left text-[14px] font-medium text-[#5e6775] transition-colors hover:text-[#111111]"
            aria-label={t("打开设置", "Open Settings")}
          >
            <Settings className="size-[1rem] shrink-0 stroke-[1.8]" />
            <span>{t("设置", "Settings")}</span>
          </button>
          <LanguageToggle />
        </div>
      </div>
    </div>
  );

  return (
    <TooltipProvider>
      <main className="bg-background lg:h-screen lg:overflow-hidden">
        <div
          className={cn(
            "grid min-h-screen transition-[grid-template-columns] duration-200 lg:h-full",
            "grid-cols-[4.5rem_minmax(0,1fr)]",
            shouldShowConversationHistoryPanel
              ? "lg:grid-cols-[320px_minmax(0,1fr)_340px]"
              : "lg:grid-cols-[320px_minmax(0,1fr)]",
          )}
        >
          <aside className="overflow-hidden border-r border-black/6 bg-[#F6F5F4] backdrop-blur-xl lg:border-black/5">
            <div
              className={cn(
                "flex h-full flex-col justify-between px-2 py-3 lg:hidden",
                isMobileSidebarOpen && "hidden",
              )}
            >
              <div className="flex flex-col items-center gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/"
                      aria-label={t("返回项目列表", "Back to Projects")}
                      className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[#070d24] text-white shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-transform hover:scale-[1.02]"
                    >
                      <Code2 className="size-[0.9rem] stroke-[2]" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">Playcode</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="rounded-[14px] bg-white/80 text-[#667898] shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition-colors hover:bg-[#070d24] hover:text-white"
                      aria-label={t("展开菜单", "Expand Menu")}
                      onClick={() => setIsMobileSidebarOpen(true)}
                    >
                      <PanelLeftOpen className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t("展开菜单", "Expand Menu")}</TooltipContent>
                </Tooltip>

                {sidebarPanelMeta.showCreateButton ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="rounded-[14px] bg-white/80 text-[#667898] shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition-colors hover:bg-black hover:text-white"
                        aria-label={t("新项目", "New Project")}
                        onClick={handleOpenProjectPicker}
                        disabled={isCreatingProject}
                      >
                        {isCreatingProject ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{t("新项目", "New Project")}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>

              <div className="flex flex-col items-center gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <LanguageToggle compact />
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {t("切换中英文", "Switch language")}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="rounded-[14px] text-[#667898] hover:bg-white/88 hover:text-[#21304d]"
                      onClick={handleToggleSettings}
                      aria-label={t("打开设置", "Open Settings")}
                    >
                      <Settings className="size-[1rem] shrink-0 stroke-[1.8]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t("设置", "Settings")}</TooltipContent>
                </Tooltip>
              </div>
            </div>

            <div className="hidden h-full min-h-0 flex-col overflow-hidden bg-[#F6F5F4] backdrop-blur-xl lg:flex">
              <div className="shrink-0 px-5 pb-3 pt-3 md:px-6">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href="/"
                    aria-label={t("返回项目列表", "Back to Projects")}
                    className="group flex min-w-0 items-center gap-2.5"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#070d24] text-white shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-transform group-hover:scale-[1.02]">
                      <Code2 className="size-[0.9rem] stroke-[2]" />
                    </span>
                    <span className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[#1f2937]">
                      Playcode
                    </span>
                  </Link>

                  <div className="flex items-center gap-2">
                    {sidebarPanelMeta.showCreateButton ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 shrink-0 gap-1.5 rounded-full bg-white/80 px-3 text-[13px] font-medium text-[#4a4a48] shadow-none transition-colors hover:bg-black hover:text-white"
                        aria-label={t("新项目", "New Project")}
                        onClick={handleOpenProjectPicker}
                        disabled={isCreatingProject}
                      >
                        {isCreatingProject ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                        <span className="max-lg:hidden">{t("新项目", "New Project")}</span>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 rounded-full text-[#5e6775] hover:bg-black/[0.04] hover:text-[#111111] lg:hidden"
                      aria-label={t("收起菜单", "Collapse Menu")}
                      onClick={() => setIsMobileSidebarOpen(false)}
                    >
                      <PanelLeftClose className="size-4" />
                    </Button>
                  </div>
                </div>

                {currentPage !== "projects" ? (
                  <div className="pt-3">
                    <div className={WORKSPACE_SIDEBAR_HEADER_TITLE_CLASS_NAME}>
                      {sidebarPanelMeta.title}
                    </div>
                  </div>
                ) : null}
              </div>

            {isMobileSidebarOpen ? (
              <button
                type="button"
                aria-label={t("关闭侧边栏", "Close Sidebar")}
                className="fixed inset-0 z-[200] bg-black/18 backdrop-blur-[2px] lg:hidden"
                onClick={() => setIsMobileSidebarOpen(false)}
              />
            ) : null}

              {currentPage === "projects" ? (
                <ScrollArea
                  className="min-h-0 flex-1 px-3 pb-1 pt-2 md:px-4"
                  viewportRef={sidebarScrollViewportRef}
                >
                  <div className="space-y-1">
                    {workspace.projects.map((item) => (
                      <ProjectListGroup
                        key={item.id}
                        project={item}
                        selectedSessionId={effectiveSelectedSessionId}
                        isExpanded={expandedProjectIds.includes(item.id)}
                        isSelected={selectedProjectId === item.id}
                        isDraftActive={
                          Boolean(effectiveDraftSession) &&
                          effectiveSelectedSessionId === null &&
                          effectiveDraftSession?.projectId === item.id
                        }
                        onToggleProject={handleToggleProject}
                        visibleSessionCount={
                          projectSessionDisplayCounts[item.id] ??
                          PROJECT_SESSION_PAGE_SIZE
                        }
                        isLoadingMoreSessions={loadingMoreProjectSessionIds.includes(
                          item.id,
                        )}
                        onLoadMoreSessions={handleLoadMoreProjectSessions}
                        isRemovingProject={
                          projectActionState?.projectId === item.id &&
                          projectActionState.action === "remove"
                        }
                        onOpenProjectHome={handleOpenProjectHome}
                        onOpenProjectRename={handleOpenProjectRename}
                        onRemoveProject={handleRemoveProject}
                        onCreateDraftSession={handleCreateDraftSession}
                        onSelectSession={handleSelectSession}
                        sessionActionState={sessionActionState}
                        onArchiveSession={handleArchiveSession}
                        onDeleteSession={handleDeleteSession}
                      />
                    ))}
                    {workspace.projects.length === 0 ? (
                      <div className="rounded-[20px] border border-dashed border-black/10 px-4 py-5 text-sm leading-6 text-muted-foreground">
                        {t(
                          "还没有项目，点击右上角“新项目”开始使用。",
                          'No projects yet. Click "New Project" in the top-right to get started.',
                        )}
                      </div>
                    ) : null}
                  </div>
                </ScrollArea>
              ) : null}

              {currentPage === "sessions" ? (
                <ScrollArea
                  className="min-h-0 flex-1 px-4 py-4"
                  viewportRef={sidebarScrollViewportRef}
                >
                  <div className="space-y-1.5">
                    {visibleSidebarSessions.map((item) => (
                      <SessionListItem
                        key={item.id}
                        session={item}
                        isActive={effectiveSelectedSessionId === item.id}
                        hasUnread={item.hasUnread}
                        onSelectSession={handleSelectSession}
                        sessionActionState={sessionActionState}
                        onArchiveSession={handleArchiveSession}
                        onDeleteSession={handleDeleteSession}
                      />
                    ))}
                    {sidebarSessions.length === 0 ? (
                      <div className="rounded-[20px] border border-dashed border-black/10 px-4 py-5 text-sm leading-6 text-muted-foreground">
                        {t(
                          "暂无未归档会话，先在项目页创建一个新会话。",
                          "There are no unarchived sessions yet. Create one from the project page first.",
                        )}
                      </div>
                    ) : null}
                    {hasMoreSidebarSessions ? (
                      <div
                        ref={sidebarSessionsAutoLoadSentinelRef}
                        className="h-4 w-full"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                </ScrollArea>
              ) : null}

              {currentPage === "archive" ? (
                <ScrollArea className="min-h-0 flex-1 px-4 py-4">
                  <div className="space-y-3">
                    {archivedProjectGroups.map((item) => (
                      <ArchivedProjectGroup
                        key={item.id}
                        project={item}
                        selectedSessionId={effectiveSelectedSessionId}
                        onSelectSession={handleSelectSession}
                        sessionActionState={sessionActionState}
                        onDeleteSession={handleDeleteSession}
                      />
                    ))}
                    {archivedProjectGroups.length === 0 ? (
                      <div className="rounded-[20px] border border-dashed border-black/10 px-4 py-5 text-sm leading-6 text-muted-foreground">
                        {t("暂无归档会话。", "There are no archived sessions yet.")}
                      </div>
                    ) : null}
                  </div>
                </ScrollArea>
              ) : null}

      <div className="shrink-0 px-4 py-1 pb-2 md:px-5">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleToggleSettings}
            className="inline-flex h-8 items-center gap-2 text-left text-[14px] font-medium text-[#5e6775] transition-colors hover:text-[#111111]"
            aria-label={t("打开设置", "Open Settings")}
                  >
                    <Settings className="size-[1rem] shrink-0 stroke-[1.8]" />
                    <span>{t("设置", "Settings")}</span>
                  </button>
                  <LanguageToggle />
                </div>
              </div>
            </div>

          </aside>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white backdrop-blur-xl lg:h-full">
          {isViewingProjectHome && projectHomeProject ? (
            <ProjectHomePanel
              project={projectHomeProject}
              isProjectServerSaving={
                projectServerUpdateState?.projectId === projectHomeProject.id
              }
              onCreateDraftSession={handleCreateDraftSession}
              onProjectServerChange={handleProjectServerChange}
              onSelectSession={handleSelectSession}
            />
          ) : project && session ? (
            <>
              {shouldShowSessionWelcomeState ? null : (
                <header
                  className={cn("shrink-0", WORKSPACE_PANEL_HEADER_CLASS_NAME)}
                >
                  <div className={WORKSPACE_PANEL_HEADER_ROW_CLASS_NAME}>
                    <div
                      className={cn(
                        WORKSPACE_PANEL_HEADER_TITLE_CLASS_NAME,
                        "min-w-0 flex flex-1 items-center",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenProjectHome(project)}
                        title={t(
                          `打开项目首页：${project.name}`,
                          `Open project home: ${project.name}`,
                        )}
                        className="flex h-8 min-w-0 shrink items-center rounded-[10px] text-[#8b8b85] outline-none transition-colors hover:text-black focus-visible:text-black"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 px-2 py-1 leading-6">
                          <Folder className="size-3.5 shrink-0" />
                          <span className="truncate">{project.name}</span>
                        </span>
                      </button>
                      <span className="flex h-8 shrink-0 items-center text-[#c2c2bc]">
                        /
                      </span>
                      {isEditingCurrentSessionTitle ? (
                        <Input
                          ref={sessionRenameInputRef}
                          value={sessionRenameState?.value ?? ""}
                          onChange={(event) =>
                            handleSessionRenameValueChange(event.target.value)
                          }
                          onBlur={() => {
                            const blurMode = sessionRenameBlurModeRef.current;
                            sessionRenameBlurModeRef.current = "save";

                            if (blurMode === "ignore") {
                              return;
                            }

                            void handleSubmitSessionRename();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              sessionRenameBlurModeRef.current = "ignore";
                              void handleSubmitSessionRename();
                              return;
                            }

                            if (event.key === "Escape") {
                              event.preventDefault();
                              sessionRenameBlurModeRef.current = "ignore";
                              handleCloseSessionRename();
                            }
                          }}
                          aria-label={t("编辑会话名称", "Edit session name")}
                          disabled={sessionRenameState?.isSaving}
                          className="h-8 min-w-[12rem] flex-1 rounded-[10px] border-black/10 bg-white px-3 py-1 text-[14px] font-medium leading-6 text-foreground shadow-none focus-visible:ring-black/10 md:max-w-[24rem]"
                        />
                      ) : (
                        <button
                          type="button"
                          onDoubleClick={handleOpenSessionRename}
                          title={
                            currentPersistedSessionId === null
                              ? activeSessionTitle
                              : `${activeSessionTitle}${t("（双击编辑）", " (double-click to edit)")}`
                          }
                          className="group flex h-8 min-w-0 flex-1 items-center text-left text-foreground outline-none"
                        >
                          <span className="block min-w-0 max-w-full truncate rounded-[10px] px-2 py-1 leading-6 transition-colors group-hover:bg-black/[0.04] group-focus-visible:bg-black/[0.04]">
                            {activeSessionTitle}
                          </span>
                        </button>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="hidden items-center gap-2 md:flex md:justify-end">
                        <Badge
                          variant="outline"
                          className="gap-1.5 rounded-full border-black/10 bg-white/90 px-3 py-1 text-xs"
                        >
                          <Clock3 className="size-3.5" />
                          <span>{formatSessionCreatedAt(session.createdAt, locale)}</span>
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-black/10 bg-white/90 px-3 py-1 text-xs"
                        >
                          {t("总运行时长", "Total Run Time")}{" "}
                          {formatSessionDuration(session.durationMs, locale)}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleToggleConversationHistory}
                        aria-expanded={isConversationHistoryOpen}
                        className={cn(
                          "h-auto shrink-0 gap-1.5 rounded-full border px-3 py-1 text-xs shadow-none transition-colors",
                          isConversationHistoryOpen
                            ? "border-black bg-black text-white hover:bg-black/90 hover:text-white"
                            : "border-black/10 bg-white/90 text-[#4a4a48] hover:bg-[#f7f6f0] hover:text-[#2f2f2d]",
                        )}
                      >
                        <Clock3 className="size-3.5" />
                        <span>
                          {t(
                            `历史对话（${conversationHistoryEntryCount}）`,
                            `History (${conversationHistoryEntryCount})`,
                          )}
                        </span>
                      </Button>
                    </div>
                  </div>
                </header>
              )}

              {shouldShowSessionWelcomeState ? (
                <SessionWelcomeState
                  projectName={project.name}
                  sessionServer={session.server}
                  model={session.model}
                  reasoningEffort={session.reasoningEffort}
                  canChangeServer={isDraftWorkspaceSession(session)}
                  onServerChange={handleDraftSessionServerChange}
                />
              ) : (
                <ScrollArea
                  className="min-h-0 flex-1"
                  viewportRef={chatViewportRef}
                >
                  <div className="px-5 py-6 md:px-6">
                    <div className="mx-auto w-full max-w-[1160px] space-y-6">
                      {session.messages.map((message) => (
                        <WorkspaceMessageBubble
                          key={message.id}
                          projectId={project.id}
                          projectServer={session.server}
                          sessionModel={session.model}
                          providerLabel={sessionProviderLabel}
                          onFileClick={handleOpenFilePreview}
                          {...message}
                        />
                      ))}
                      {currentSessionPendingMessages.map((message) => (
                        <PendingWorkspaceMessageBubble
                          key={message.localId}
                          content={message.content}
                          createdAt={message.createdAt}
                        />
                      ))}
                      {currentStreamingAssistant && (
                          <div className="mx-auto flex w-full max-w-[1160px] justify-start py-1">
                            <div className="w-full max-w-full space-y-3">
                              <div className="flex items-center gap-2 text-[13px] leading-none text-[#7b7b74]">
                                <span className="font-medium">
                                  {formatAssistantIdentityLabel({
                                    projectServer: session.server,
                                    model: currentStreamingAssistant.model,
                                    providerLabel: sessionProviderLabel,
                                  })}
                                </span>
                                <span>
                                  {new Date(
                                    currentStreamingAssistant.createdAt,
                                  ).toLocaleTimeString(WORKSPACE_DISPLAY_LOCALE, {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: WORKSPACE_DISPLAY_TIME_ZONE,
                                  })}
                                </span>
                              </div>
                              <div className="space-y-2 text-[13px] leading-5 text-foreground">
                                {currentStreamingAssistant.transcript.length > 0 ? (
                                  <>
                                    <RunTranscriptEntries
                                      entries={currentStreamingAssistant.transcript}
                                      projectId={project.id}
                                    />
                                    {shouldShowStreamingThinking ? (
                                      <StreamingThinkingIndicator className="pt-1" />
                                    ) : null}
                                  </>
                                ) : shouldShowStreamingThinking ? (
                                  <StreamingThinkingIndicator />
                                ) : null}
                              </div>
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                </ScrollArea>
              )}

              <div className="shrink-0 px-5 pb-4 md:px-6 md:pb-5 pt-1">
                <div className="mx-auto w-full max-w-[1160px]">
                  {(chatStatusMessage || workspaceRealtimeError) && (
                    <div className="mb-2 flex items-center justify-end px-1 text-[13px] text-muted-foreground">
                      <span
                        className={cn(
                          shouldUseDestructiveChatStatusColor &&
                            "text-destructive",
                        )}
                      >
                        {chatStatusMessage ?? workspaceRealtimeError ?? " "}
                      </span>
                    </div>
                  )}

                  <QueuedPromptPreviewList
                    prompts={currentSessionQueuedPrompts}
                    pendingPromptIds={removingQueuedPromptIds}
                    onRemovePrompt={handleRemoveQueuedPrompt}
                  />

                  <form
                    className={cn(
                      "surface-shadow flex h-[120px] flex-col justify-between border bg-white px-3 py-2.5",
                      currentSessionQueuedPrompts.length > 0
                        ? "rounded-b-[8px] rounded-t-none border-[#d4d4d8]"
                        : "rounded-[8px] border-black/10",
                    )}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSendPrompt();
                    }}
                  >
                    <Textarea
                      ref={composerTextareaRef}
                      value={composerValue}
                      onChange={(event) =>
                        handleComposerValueChange(event.target.value)
                      }
                      onPaste={(event) => {
                        const pastedText =
                          event.clipboardData.getData("text/plain") ||
                          event.clipboardData.getData("text");

                        if (!pastedText || !/[\r\n]/u.test(pastedText)) {
                          return;
                        }

                        event.preventDefault();

                        const textarea = event.currentTarget;
                        const normalizedText =
                          normalizeComposerPasteText(pastedText);
                        const selectionStart =
                          textarea.selectionStart ?? textarea.value.length;
                        const selectionEnd =
                          textarea.selectionEnd ?? textarea.value.length;
                        const nextValue =
                          textarea.value.slice(0, selectionStart) +
                          normalizedText +
                          textarea.value.slice(selectionEnd);

                        textarea.setRangeText(
                          normalizedText,
                          selectionStart,
                          selectionEnd,
                          "end",
                        );
                        handleComposerValueChange(nextValue);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          void handleSendPrompt();
                        }
                      }}
                      placeholder={t("给playcode发消息", "Message Playcode")}
                      autoComplete="off"
                      className="min-h-0 flex-1 resize-none rounded-[8px] border-0 bg-transparent px-0 py-0 text-[13px] leading-5 shadow-none focus-visible:ring-0 placeholder:text-[#b7b7b7]"
                    />
                    <div className="flex items-center justify-between gap-3 border-t border-black/6 pt-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <SelectChip
                          value={session.model}
                          options={sessionModelOptions.map((option) => ({
                            value: option.value,
                            label: option.label,
                          }))}
                          ariaLabel={t("选择模型", "Choose model")}
                          onChange={(value) => {
                            void handleSessionConfigChange("model", value);
                          }}
                        />
                        <SelectChip
                          value={session.reasoningEffort}
                          options={sessionReasoningOptions.map((option) => ({
                            value: option.value,
                            label: translateReasoning(option.label),
                          }))}
                          ariaLabel={t("选择推理强度", "Choose reasoning level")}
                          onChange={(value) => {
                            void handleSessionConfigChange(
                              "reasoningEffort",
                              value,
                            );
                          }}
                        />
                        {activeProjectId !== null ? (
                          <ProjectBranchChip projectId={activeProjectId} />
                        ) : null}
                      </div>

                      <Button
                        type={
                          shouldShowQueueSubmitAction || !isCurrentSessionRunning
                            ? "submit"
                            : "button"
                        }
                        variant="ghost"
                        size="icon"
                        disabled={
                          shouldShowQueueSubmitAction || !isCurrentSessionRunning
                            ? shouldShowQueueSubmitAction
                              ? !canQueuePrompt
                              : !canSend
                            : !canStop
                        }
                        onClick={() => {
                          if (
                            isCurrentSessionRunning &&
                            !shouldShowQueueSubmitAction
                          ) {
                            void handleStopPrompt();
                          }
                        }}
                        className={cn(
                          "size-8 shrink-0 rounded-full border transition-colors",
                          isCurrentSessionRunning && !shouldShowQueueSubmitAction
                            ? "border-black bg-black text-white hover:bg-black/90"
                            : "border-black/10 bg-transparent hover:bg-[#f3f3f1]",
                        )}
                      >
                        <span className="sr-only">
                          {isCurrentSessionRunning && !shouldShowQueueSubmitAction
                            ? t("暂停当前运行", "Pause Current Run")
                            : isCurrentSessionRunning
                              ? t("提交到队列", "Add to Queue")
                              : t("发送", "Send")}
                        </span>
                        {isCurrentSessionRunning && !shouldShowQueueSubmitAction ? (
                          <Square className="size-3.5 fill-current text-white" />
                        ) : (
                          <ArrowUp
                            className={cn(
                              "size-4 transition-colors",
                              shouldShowQueueSubmitAction
                                ? canQueuePrompt
                                  ? "text-black"
                                  : "text-[#b9b9b9]"
                                : canSend
                                  ? "text-black"
                                  : "text-[#b9b9b9]",
                            )}
                          />
                        )}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            </>
          ) : isProjectHomeMissing ? (
            <ProjectNotFoundPanel
              onBackToProjects={() => {
                router.push("/projects");
              }}
            />
          ) : (
            <EmptyWorkspacePanel
              hasProjects={hasProjects}
              project={project}
              isCreatingProject={isCreatingProject}
              onOpenProjectPicker={handleOpenProjectPicker}
              onCreateDraftSession={handleCreateDraftSession}
            />
          )}
          </section>

          {shouldShowConversationHistoryPanel ? (
            <aside className="hidden min-h-0 flex-col overflow-hidden border-l border-black/6 bg-[#fcfbf7] lg:flex">
              <ConversationHistoryPanel
                entries={sessionConversationHistoryEntries}
                activeMessageId={activeConversationHistoryMessageId}
                onSelectMessage={handleSelectConversationHistoryMessage}
                onClose={handleCloseConversationHistory}
              />
            </aside>
          ) : null}
        </div>

        {hasMounted && isMobileSidebarOpen
          ? createPortal(
              <>
                <button
                  type="button"
                  aria-label="关闭侧边栏"
                  className="fixed inset-0 z-[990] bg-black/18 backdrop-blur-[2px] lg:hidden"
                  onClick={() => setIsMobileSidebarOpen(false)}
                />
                {renderWorkspaceSidebarPanel(true)}
              </>,
              document.body,
            )
          : null}

        {shouldShowConversationHistoryPanel ? (
          <div className="fixed inset-0 z-[90] lg:hidden">
            <button
              type="button"
              aria-label="关闭历史对话面板"
              className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
              onClick={handleCloseConversationHistory}
            />
            <div className="absolute inset-y-0 right-0 w-full max-w-[22rem] border-l border-black/8 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
              <ConversationHistoryPanel
                entries={sessionConversationHistoryEntries}
                activeMessageId={activeConversationHistoryMessageId}
                onSelectMessage={handleSelectConversationHistoryMessage}
                onClose={handleCloseConversationHistory}
                closeOnSelect
              />
            </div>
          </div>
        ) : null}

        {activeProjectPath ? (
          <WorkspaceFilePreviewDrawer
            rootPath={activeProjectPath}
            href={filePreviewHref}
            isOpen={isFilePreviewOpen}
            onClose={handleCloseFilePreview}
          />
        ) : null}

        <ProjectDirectoryPickerModal
          isOpen={isProjectPickerOpen}
          isCreatingProject={isCreatingProject}
          onClose={handleCloseProjectPicker}
          onConfirm={handleCreateProject}
        />

        <ProjectRenameModal
          isOpen={projectRenameState !== null}
          value={projectRenameState?.value ?? ""}
          isSaving={projectRenameState?.isSaving ?? false}
          errorMessage={projectRenameState?.errorMessage ?? null}
          onChange={handleProjectRenameValueChange}
          onClose={handleCloseProjectRename}
          onSubmit={() => {
            void handleSubmitProjectRename();
          }}
        />

        <WorkspaceSettingsModal
          key={isSettingsOpen ? "settings-open" : "settings-closed"}
          isOpen={isSettingsOpen}
          settings={settingsDraft}
          websocketError={websocketError}
          codexSettingsError={codexSettingsError}
          claudeSettingsError={claudeSettingsError}
          editingCodexProviderIds={editingCodexProviderIds}
          editingClaudeProviderIds={editingClaudeProviderIds}
          hasPendingCodexProviderEdit={hasPendingCodexProviderEdit}
          hasPendingClaudeProviderEdit={hasPendingClaudeProviderEdit}
          connectionPhase={connectionStatus.phase}
          connectionError={connectionStatus.error}
          onAddClaudeProvider={handleAddClaudeProvider}
          onCancelCodexProviderEdit={handleCancelCodexProviderEdit}
          onCancelClaudeProviderEdit={handleCancelClaudeProviderEdit}
          onFinishClaudeProviderEdit={handleFinishClaudeProviderEdit}
          onFinishCodexProviderEdit={handleFinishCodexProviderEdit}
          onMoveClaudeProvider={handleMoveClaudeProvider}
          onMoveCodexProvider={handleMoveCodexProvider}
          onAddCodexProvider={handleAddCodexProvider}
          onClose={handleCloseSettings}
          onChange={handleSettingsChange}
          onClaudeProviderChange={handleClaudeProviderChange}
          onCodexProviderChange={handleCodexProviderChange}
          onLogout={handleLogout}
          onRemoveClaudeProvider={handleRemoveClaudeProvider}
          onRemoveCodexProvider={handleRemoveCodexProvider}
          onStartClaudeProviderEdit={handleStartClaudeProviderEdit}
          onStartCodexProviderEdit={handleStartCodexProviderEdit}
          isLoggingOut={isLoggingOut}
        />
      </main>
    </TooltipProvider>
  );
}

function ConversationHistoryPanel({
  entries,
  activeMessageId,
  onSelectMessage,
  onClose,
  closeOnSelect = false,
}: {
  entries: SessionConversationHistoryEntry[];
  activeMessageId: number | null;
  onSelectMessage: (messageId: number) => void;
  onClose: () => void;
  closeOnSelect?: boolean;
}) {
  const { locale, t } = useLocale();
  return (
    <div className="flex min-h-0 h-full flex-col overflow-hidden bg-[#fcfbf7]">
      <div
        className={cn(
          WORKSPACE_PANEL_HEADER_CLASS_NAME,
          "border-black/6 bg-[#fcfbf7]",
        )}
      >
        <div className={cn(WORKSPACE_PANEL_HEADER_ROW_CLASS_NAME, "items-start")}>
          <div className="min-w-0">
            <div className={WORKSPACE_PANEL_HEADER_TITLE_CLASS_NAME}>
              {t("历史对话", "History")}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full text-[#7d7d77] hover:bg-black/[0.04] hover:text-foreground"
            onClick={onClose}
            aria-label={t("关闭历史对话面板", "Close history panel")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-4 py-4">
          <div className="rounded-[18px] border border-black/8 bg-white/88 px-4 py-3 text-[12px] leading-5 text-[#7d7d77]">
            {t("当前会话共", "This session has")}{" "}
            <span className="font-medium text-foreground">{entries.length}</span>{" "}
            {t("条用户消息。", "user messages.")}
          </div>

          {entries.length > 0 ? (
            entries.map((entry, index) => {
              const isActive = activeMessageId === entry.messageId;
              const sequence = entries.length - index;

              return (
                <button
                  key={entry.messageId}
                  type="button"
                  onClick={() => {
                    onSelectMessage(entry.messageId);

                    if (closeOnSelect) {
                      onClose();
                    }
                  }}
                  title={entry.content}
                  className={cn(
                    "flex w-full flex-col gap-2 rounded-[18px] border px-4 py-3 text-left transition-colors",
                    isActive
                      ? "border-black/14 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
                      : "border-black/8 bg-white/72 hover:bg-white",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px]",
                        isActive
                          ? "border-black/12 bg-black text-white"
                          : "border-black/10 bg-[#faf9f5] text-[#6d6d68]",
                      )}
                    >
                      {t("第", "#")} {sequence}
                    </Badge>
                    <span className="text-[12px] text-[#8b8b85]">
                      {formatConversationHistoryTimestamp(entry.createdAt, locale)}
                    </span>
                  </div>
                  <div
                    data-no-translate
                    className="whitespace-pre-wrap break-words text-[13px] leading-6 text-foreground"
                  >
                    {entry.content}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-[18px] border border-dashed border-black/10 px-4 py-5 text-sm leading-6 text-muted-foreground">
              {t(
                "当前会话还没有你发给模型的消息。",
                "There are no messages from you to the model in this session yet.",
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ProjectHomePanel({
  project,
  isProjectServerSaving,
  onCreateDraftSession,
  onProjectServerChange,
  onSelectSession,
}: {
  project: WorkspaceProject;
  isProjectServerSaving: boolean;
  onCreateDraftSession: (project: WorkspaceProject) => void;
  onProjectServerChange: (
    projectId: number,
    server: WorkspaceProjectServer,
  ) => void | Promise<void>;
  onSelectSession: (sessionId: number) => void;
}) {
  const { locale, t } = useLocale();
  const sortedSessions = useMemo(
    () => sortSessionsByLatestActivity(project.sessions),
    [project.sessions],
  );
  const recentValidSessions = useMemo(
    () => sortedSessions.filter((session) => !session.isArchived).slice(0, 6),
    [sortedSessions],
  );
  const recentArchivedSessions = useMemo(
    () => sortedSessions.filter((session) => session.isArchived).slice(0, 6),
    [sortedSessions],
  );
  const requirementEntries = useMemo(
    () => buildProjectRequirementEntries(project),
    [project],
  );
  const latestSession = sortedSessions[0] ?? null;
  const totalDurationMs = project.sessions.reduce(
    (totalDuration, session) => totalDuration + session.durationMs,
    0,
  );
  const [recentSessionTab, setRecentSessionTab] =
    useState<ProjectHomeSessionListTab>("valid");
  const [visibleRequirementState, setVisibleRequirementState] = useState<{
    projectId: number;
    count: number;
  }>({
    projectId: project.id,
    count: PROJECT_HOME_REQUIREMENT_PAGE_SIZE,
  });
  const resolvedVisibleRequirementCount =
    visibleRequirementState.projectId === project.id
      ? Math.max(
          visibleRequirementState.count,
          PROJECT_HOME_REQUIREMENT_PAGE_SIZE,
        )
      : PROJECT_HOME_REQUIREMENT_PAGE_SIZE;
  const visibleRequirementEntries = requirementEntries.slice(
    0,
    resolvedVisibleRequirementCount,
  );
  const projectUsageSummary = useMemo(
    () => calculateProjectUsageSummary(project),
    [project],
  );
  const visibleRecentSessions =
    recentSessionTab === "archived"
      ? recentArchivedSessions
      : recentValidSessions;
  const hasMoreRequirementSessions =
    requirementEntries.length > resolvedVisibleRequirementCount;

  function handleLoadMoreRequirementSessions() {
    setVisibleRequirementState((currentState) => {
      const currentVisibleCount =
        currentState.projectId === project.id
          ? currentState.count
          : PROJECT_HOME_REQUIREMENT_PAGE_SIZE;

      return {
        projectId: project.id,
        count: Math.min(
          currentVisibleCount + PROJECT_HOME_REQUIREMENT_LOAD_MORE_COUNT,
          requirementEntries.length,
        ),
      };
    });
  }

  function handleRequirementListScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMoreRequirementSessions) {
      return;
    }

    const currentTarget = event.currentTarget;
    const remainingScrollDistance =
      currentTarget.scrollHeight -
      currentTarget.scrollTop -
      currentTarget.clientHeight;

    if (remainingScrollDistance > 40) {
      return;
    }

    handleLoadMoreRequirementSessions();
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-5 py-6 md:px-6">
        <div className="w-full space-y-6">
          <section className="overflow-hidden rounded-[28px] border border-black/8 bg-[#f7f6f0] shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
            <div className="flex flex-col gap-6 px-6 py-6 md:px-7 md:py-7">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="break-words text-3xl font-semibold tracking-[-0.04em] text-foreground md:text-4xl">
                        {project.name}
                      </h1>
                      <div className="inline-flex shrink-0 flex-wrap rounded-full bg-[#f3f1e7] p-1">
                        {WORKSPACE_PROJECT_SERVER_OPTIONS.map((option) => {
                          const isActive = project.server === option.value;

                          return (
                            <button
                              key={option.value}
                              type="button"
                              disabled={isProjectServerSaving}
                              onClick={() => {
                                void onProjectServerChange(project.id, option.value);
                              }}
                              className={cn(
                                "inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70",
                                isActive
                                  ? "bg-white text-foreground shadow-sm"
                                  : "text-[#6d6d68] hover:text-foreground",
                              )}
                            >
                              {isProjectServerSaving && isActive ? (
                                <LoaderCircle className="size-3 animate-spin" />
                              ) : null}
                              <span>{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="rounded-full bg-white/90 px-3 py-1"
                      >
                        {formatProjectCreatedAt(project.createdAt, locale)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full bg-white/90 px-3 py-1"
                      >
                        {latestSession
                          ? formatLastActivityLabel(
                              getSessionLastActivityAt(latestSession),
                              locale,
                            )
                          : t("暂无会话活动", "No session activity yet")}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    className="rounded-2xl px-5"
                    onClick={() => onCreateDraftSession(project)}
                  >
                    <SquarePen className="mr-2 size-4" />
                    {t("新建会话", "New Session")}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="surface-shadow rounded-[20px] border-black/8 bg-white/96">
                  <CardContent className="p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.14em] text-[#8b8b85]">
                        <Folder className="size-3.5" />
                        <span>{t("项目目录", "Project Directory")}</span>
                      </div>
                    </div>
                    <div className="mt-3 break-all font-mono text-[12px] leading-6 text-foreground">
                      {project.path}
                    </div>
                  </CardContent>
                </Card>

                <ProjectGitInfoCard projectId={project.id} />
              </div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <ProjectHomeStatCard
              label={t("有效会话", "Valid Sessions")}
              value={String(project.validSessionCount)}
              description={
                project.validSessionCount > 0
                  ? t("这些会话还没有进入归档", "These sessions have not been archived yet")
                  : t("当前项目还没有未归档会话", "This project has no unarchived sessions yet")
              }
            />
            <ProjectHomeStatCard
              label={t("活跃会话", "Active Sessions")}
              value={String(project.activeSessionCount)}
              description={
                project.activeSessionCount > 0
                  ? t("这些会话当前正在进行中", "These sessions are currently in progress")
                  : t("当前没有进行中的会话", "There are no sessions in progress right now")
              }
            />
            <ProjectHomeStatCard
              label={t("已归档", "Archived")}
              value={String(project.archivedSessionCount)}
              description={
                project.archivedSessionCount > 0
                  ? t("历史会话已经收进归档列表", "Past sessions have been moved into the archive list")
                  : t("暂时还没有归档内容", "There is nothing archived yet")
              }
            />
            <ProjectHomeStatCard
              label={t("累计运行时长", "Total Run Time")}
              value={formatSessionDuration(totalDurationMs, locale)}
              description={t("按当前项目全部会话累计", "Calculated from all sessions in this project")}
            />
            <ProjectHomeStatCard
              label={t("累计输入", "Total Input")}
              value={formatTokenCount(projectUsageSummary.inputTokens)}
              description={
                projectUsageSummary.cachedInputTokens > 0
                  ? t(
                      `缓存命中 ${formatTokenCount(projectUsageSummary.cachedInputTokens)}`,
                      `Cache hits ${formatTokenCount(projectUsageSummary.cachedInputTokens)}`,
                    )
                  : t("按全部运行记录累计", "Calculated from all run records")
              }
            />
            <ProjectHomeStatCard
              label={t("累计输出", "Total Output")}
              value={formatTokenCount(projectUsageSummary.outputTokens)}
              description={t("按全部运行记录累计", "Calculated from all run records")}
            />
          </section>

          <ProjectCodeBrowser rootPath={project.path} />

          <section className="grid gap-4 xl:grid-cols-2">
            <Card className="surface-shadow rounded-[24px] border-black/8 bg-white/96">
              <Tabs
                value={recentSessionTab}
                onValueChange={(value) => {
                  if (value === "valid" || value === "archived") {
                    setRecentSessionTab(value);
                  }
                }}
                className="gap-0"
              >
                <CardHeader className="space-y-3">
                  <TabsList className="h-auto w-fit rounded-full bg-[#f3f1e7] p-1">
                    <TabsTrigger
                      value="valid"
                      className="rounded-full px-3.5 py-1.5 text-[13px]"
                    >
                      {t("有效会话", "Valid Sessions")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="archived"
                      className="rounded-full px-3.5 py-1.5 text-[13px]"
                    >
                      {t("已存档", "Archived")}
                    </TabsTrigger>
                  </TabsList>
                  <CardDescription className="text-sm leading-6">
                    {t(
                      "切换查看当前项目最近活跃的有效会话，或者已经归档的历史会话。",
                      "Switch between the most recently active valid sessions in this project and archived session history.",
                    )}
                  </CardDescription>
                </CardHeader>
              </Tabs>
              <CardContent className="space-y-2 pt-0">
                {visibleRecentSessions.length > 0 ? (
                  visibleRecentSessions.map((session) => {
                    const sessionTitle = getSessionDisplayTitle(session);

                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => onSelectSession(session.id)}
                        className="flex w-full items-start justify-between gap-3 rounded-[18px] border border-black/8 bg-[#faf9f5] px-4 py-3 text-left transition-colors hover:bg-[#f2f1ea]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <SessionStateIndicator
                              status={session.status}
                              hasUnread={session.hasUnread}
                              isActive={false}
                            />
                            <span className="truncate text-[14px] font-medium text-foreground">
                              {sessionTitle}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#7d7d77]">
                            <span>
                              {formatSessionModelLabel(session.server, session.model)}
                            </span>
                            <span>·</span>
                            <span>{formatSessionDuration(session.durationMs, locale)}</span>
                            <span>·</span>
                            <span>
                              {formatLastActivityLabel(
                                getSessionLastActivityAt(session),
                                locale,
                              )}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-[#8b8b85]" />
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-[18px] border border-dashed border-black/10 px-4 py-5 text-sm leading-6 text-muted-foreground">
                    {recentSessionTab === "archived"
                      ? t("这个项目还没有归档会话。", "This project does not have any archived sessions yet.")
                      : t(
                          "这个项目还没有有效会话。先新建一个会话，右侧聊天区就会围绕当前目录开始工作。",
                          "This project does not have any valid sessions yet. Create one first, and the chat area on the right will start working around the current directory.",
                        )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="surface-shadow rounded-[24px] border-black/8 bg-white/96">
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-xl">{t("对话列表", "Conversation List")}</CardTitle>
                    <CardDescription className="text-sm leading-6">
                      {t("查看全部的对话记录。", "View the full conversation history.")}
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className="rounded-full bg-[#faf9f5] px-3 py-1 text-[#6d6d68]"
                  >
                    {t("共", "Total")} {requirementEntries.length} {t("条", "")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {requirementEntries.length > 0 ? (
                  <div
                    key={project.id}
                    onScroll={handleRequirementListScroll}
                    className="max-h-[42rem] space-y-3 overflow-y-auto pr-1"
                  >
                    {visibleRequirementEntries.map((entry) => {
                      const requirementPreview =
                        buildSessionPreview(entry.content) ||
                        t(
                          "这条对话还没有可展示的需求描述。",
                          "This conversation does not have a requirement summary to display yet.",
                        );
                      const sessionStatusLabel = getSessionStatusLabel({
                        status: entry.sessionStatus,
                        isArchived: entry.sessionIsArchived,
                      }, locale);

                      return (
                        <button
                          key={entry.messageId}
                          type="button"
                          onClick={() => onSelectSession(entry.sessionId)}
                          className="flex w-full items-start gap-3 rounded-[18px] border border-black/8 bg-[#faf9f5] px-4 py-4 text-left transition-colors hover:bg-[#f2f1ea]"
                        >
                          <SessionStateIndicator
                            status={sessionStatusLabel}
                            hasUnread={entry.sessionHasUnread}
                            isActive={false}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div
                                  data-no-translate
                                  title={entry.content}
                                  className="text-[14px] font-medium leading-6 text-foreground"
                                >
                                  {requirementPreview}
                                </div>
                                <div className="mt-1 text-[12px] leading-5 text-[#8b8b85]">
                                  {t("所属会话：", "Session:")}
                                  {entry.sessionTitle}
                                </div>
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "rounded-full px-2.5 py-1 text-[11px]",
                                  getSessionStatusBadgeClassName({
                                    status: entry.sessionStatus,
                                    isArchived: entry.sessionIsArchived,
                                  }),
                                )}
                              >
                                {sessionStatusLabel}
                              </Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#7d7d77]">
                              <span>
                                {formatSessionCreatedAt(entry.createdAt, locale)}
                              </span>
                              <span>·</span>
                              <span>
                                {formatLastActivityLabel(entry.sessionLastActivityAt, locale)}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="mt-0.5 size-4 shrink-0 text-[#8b8b85]" />
                        </button>
                      );
                    })}

                    <div className="rounded-[18px] border border-dashed border-black/10 px-4 py-3 text-center text-[12px] leading-6 text-[#8b8b85]">
                      {hasMoreRequirementSessions
                        ? t(
                            `继续下滑可再加载 ${Math.min(
                              PROJECT_HOME_REQUIREMENT_LOAD_MORE_COUNT,
                              requirementEntries.length -
                                visibleRequirementEntries.length,
                            )} 条`,
                            `Scroll to load ${Math.min(
                              PROJECT_HOME_REQUIREMENT_LOAD_MORE_COUNT,
                              requirementEntries.length -
                                visibleRequirementEntries.length,
                            )} more`,
                          )
                        : t(
                            `已展示全部 ${requirementEntries.length} 条聊天记录`,
                            `Showing all ${requirementEntries.length} chat records`,
                          )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[18px] border border-dashed border-black/10 px-4 py-5 text-sm leading-6 text-muted-foreground">
                    {t(
                      "当前项目还没有已提交给模型的聊天记录，先新建一个会话描述你的需求。",
                      "This project does not have any submitted chat history yet. Create a session first and describe your request.",
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </ScrollArea>
  );
}

function ProjectHomeStatCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <Card className="surface-shadow rounded-[20px] border-black/8 bg-white/96">
      <CardHeader className="space-y-2">
        <CardDescription className="text-[13px] leading-5">
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tracking-[-0.04em]">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm leading-6 text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  );
}

function ProjectNotFoundPanel({
  onBackToProjects,
}: {
  onBackToProjects: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Card className="surface-shadow w-full max-w-xl rounded-[8px] border-white/90 bg-white/96">
        <CardHeader className="space-y-3">
          <div className="flex size-14 items-center justify-center rounded-[8px] border bg-[#f5f5f2] text-foreground">
            <Folder className="size-6" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl">
              {t("项目不存在", "Project Not Found")}
            </CardTitle>
            <CardDescription className="text-sm leading-6">
              {t(
                "这个项目可能已经被移除，或者当前链接里的项目 ID 不再有效。",
                "This project may have been removed, or the project ID in the current link is no longer valid.",
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Button
            type="button"
            className="rounded-2xl px-5"
            onClick={onBackToProjects}
          >
            {t("返回项目列表", "Back to Projects")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectRenameModal({
  isOpen,
  value,
  isSaving,
  errorMessage,
  onChange,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  value: string;
  isSaving: boolean;
  errorMessage: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useLocale();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label={t("关闭项目重命名弹层", "Close project rename modal")}
        className="absolute inset-0 cursor-pointer bg-black/18 backdrop-blur-sm"
        onClick={onClose}
      />

      <Card className="surface-shadow relative z-10 w-full max-w-lg rounded-[24px] border-white/90 bg-white/96">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-xl">
                {t("修改项目名称", "Rename Project")}
              </CardTitle>
              <CardDescription className="text-sm leading-6">
                {t(
                  "修改后会立即同步到左侧项目列表和项目首页。",
                  "After saving, the name is synced to the project list and project home immediately.",
                )}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 rounded-full text-muted-foreground hover:text-foreground"
              onClick={onClose}
              disabled={isSaving}
            >
              <X className="size-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <div className="space-y-2">
              <label
                htmlFor="project-rename-input"
                className="text-sm font-medium text-foreground"
              >
                {t("项目名称", "Project Name")}
              </label>
              <Input
                id="project-rename-input"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={t("输入新的项目名称", "Enter the new project name")}
                autoComplete="off"
                autoFocus
                disabled={isSaving}
                className="h-11 rounded-xl border-black/10 bg-white text-foreground shadow-none"
              />
              {errorMessage ? (
                <p className="text-xs text-destructive">{errorMessage}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={onClose}
                disabled={isSaving}
              >
                {t("取消", "Cancel")}
              </Button>
              <Button type="submit" className="rounded-xl" disabled={isSaving}>
                {isSaving ? (
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                ) : null}
                {t("保存", "Save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyWorkspacePanel({
  hasProjects,
  project,
  isCreatingProject,
  onOpenProjectPicker,
  onCreateDraftSession,
}: {
  hasProjects: boolean;
  project: WorkspaceProject | null;
  isCreatingProject: boolean;
  onOpenProjectPicker: () => void;
  onCreateDraftSession: (project: WorkspaceProject) => void;
}) {
  const { t } = useLocale();
  const title = hasProjects
    ? t("当前项目还没有会话", "This Project Has No Sessions Yet")
    : t("还没有项目", "No Projects Yet");
  const description = hasProjects
    ? t(
        `先在「${project?.name ?? "当前项目"}」里新建一个会话，再开始和 Codex 协作。`,
        `Create a session in "${project?.name ?? t("当前项目", "Current Project")}" before collaborating with Codex.`,
      )
    : t(
        "先添加一个本地目录到左侧项目列表，工作区就会准备好。",
        "Add a local directory to the project list on the left first, and the workspace will be ready.",
      );

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Card className="surface-shadow w-full max-w-2xl rounded-[8px] border-white/90 bg-white/96">
        <CardHeader className="space-y-3">
          <div className="flex size-14 items-center justify-center rounded-[8px] border bg-[#f5f5f2] text-foreground">
            {hasProjects ? (
              <SquarePen className="size-6" />
            ) : (
              <Plus className="size-6" />
            )}
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl">{title}</CardTitle>
            <CardDescription className="text-sm leading-6">
              {description}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 pt-0">
          {hasProjects && project ? (
            <Button
              type="button"
              className="rounded-2xl px-5"
              onClick={() => onCreateDraftSession(project)}
            >
              {t("在当前项目中新建会话", "Create a Session in This Project")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={hasProjects ? "outline" : "default"}
            className="rounded-2xl px-5"
            onClick={onOpenProjectPicker}
            disabled={isCreatingProject}
          >
            {isCreatingProject ? t("添加中...", "Adding...") : t("新项目", "New Project")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SessionWelcomeState({
  projectName,
  sessionServer,
  model,
  reasoningEffort,
  canChangeServer = false,
  onServerChange,
}: {
  projectName: string;
  sessionServer: WorkspaceProjectServer;
  model: string;
  reasoningEffort: WorkspaceReasoningEffort;
  canChangeServer?: boolean;
  onServerChange?: (server: WorkspaceProjectServer) => void;
}) {
  const { t, translateReasoning } = useLocale();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-3xl flex-col items-center gap-5 text-center">
        <div className="flex size-[4.5rem] items-center justify-center rounded-full border border-black/10 bg-[#f6f5f1] text-foreground shadow-[0_24px_48px_rgba(15,23,42,0.08)]">
          <Code2 className="size-8" />
        </div>
        <div className="space-y-2">
          <p className="text-4xl font-semibold tracking-[-0.05em] text-foreground md:text-6xl">
            {t("启动新会话于", "Start New Session in")}
          </p>
          <p className="break-words text-3xl font-medium tracking-[-0.05em] text-[#8b8b85] mt-1 md:text-5xl">
            {projectName}
          </p>
        </div>
        {canChangeServer && onServerChange ? (
          <div className="flex flex-col items-center gap-2">
            <div className="inline-flex flex-wrap rounded-full bg-[#f3f1e7] p-1">
              {WORKSPACE_PROJECT_SERVER_OPTIONS.map((option) => {
                const isActive = sessionServer === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onServerChange(option.value)}
                    className={cn(
                      "inline-flex min-w-[6.5rem] items-center justify-center rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                      isActive
                        ? "bg-white text-foreground shadow-sm"
                        : "text-[#6d6d68] hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          {t("在下方输入你的需求，", "Describe your request below. ")}
          {formatWorkspaceProjectServerLabel(sessionServer)} {t("会围绕", "will work around")} 「{projectName}」
          {t("开始工作。", ".",)}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge variant="outline" className="rounded-full px-3 py-1">
            {formatSessionModelLabel(sessionServer, model)}
          </Badge>
          <Badge variant="outline" className="rounded-full px-3 py-1">
            {t("推理", "Reasoning")}{" "}
            {translateReasoning(
              formatSessionReasoningEffortLabel(sessionServer, reasoningEffort),
            )}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function ProjectRemoveButton({
  project,
  isRemovingProject,
  onRemoveProject,
}: {
  project: WorkspaceProject;
  isRemovingProject: boolean;
  onRemoveProject: (project: WorkspaceProject) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const resolvedOpen = isRemovingProject ? false : open;

  return (
    <Popover open={resolvedOpen} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-full text-[#8a5c5c] transition-colors hover:text-[#7a3030] focus-visible:text-[#7a3030] disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`${t("移除项目", "Remove Project")} ${project.name}`}
              disabled={isRemovingProject}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {isRemovingProject ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{t("移除项目", "Remove Project")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={10}
        className="relative w-[240px] rounded-[18px] border border-white/90 bg-white px-3.5 py-3 shadow-[0_18px_52px_rgba(15,23,42,0.14)]"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-full size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-b border-r border-[#f1efe8] bg-white"
        />
        <div className="space-y-2.5">
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-5 text-[#262626]">
              {t("确认移除项目", "Remove Project?")}
            </p>
            <p className="text-[13px] leading-5 text-[#4f4f4f]">
              {t(
                "这只会从工作台移除，不会删除本地目录。",
                "This only removes it from the workspace, not the local directory.",
              )}
            </p>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-7 rounded-md px-2.5 text-xs"
            >
              {t("取消", "Cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                setOpen(false);
                onRemoveProject(project);
              }}
              className="h-7 rounded-md px-2.5 text-xs"
            >
              {t("移除项目", "Remove Project")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProjectListGroup({
  project,
  selectedSessionId,
  isExpanded,
  isSelected,
  isDraftActive,
  onToggleProject,
  visibleSessionCount,
  isLoadingMoreSessions,
  onLoadMoreSessions,
  isRemovingProject,
  onOpenProjectHome,
  onOpenProjectRename,
  onRemoveProject,
  onCreateDraftSession,
  onSelectSession,
  sessionActionState,
  onArchiveSession,
  onDeleteSession,
}: {
  project: WorkspaceProject;
  selectedSessionId: number | null;
  isExpanded: boolean;
  isSelected: boolean;
  isDraftActive: boolean;
  onToggleProject: (projectId: number) => void;
  visibleSessionCount: number;
  isLoadingMoreSessions: boolean;
  onLoadMoreSessions: (projectId: number) => void | Promise<void>;
  isRemovingProject: boolean;
  onOpenProjectHome: (project: WorkspaceProject) => void;
  onOpenProjectRename: (project: WorkspaceProject) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onCreateDraftSession: (project: WorkspaceProject) => void;
  onSelectSession: (sessionId: number) => void;
  sessionActionState: SessionActionState;
  onArchiveSession: (session: WorkspaceSession) => void;
  onDeleteSession: (session: WorkspaceSession) => void;
}) {
  const { locale, t } = useLocale();
  const isProjectActive = isSelected;
  const sortedSessions = sortSessionsBySubmissionTime(
    project.sessions.filter((session) => !session.isArchived),
  );
  const resolvedVisibleSessionCount = Math.max(
    visibleSessionCount,
    PROJECT_SESSION_PAGE_SIZE,
  );
  const visibleSessions = sortedSessions.slice(0, resolvedVisibleSessionCount);
  const hasMoreSessions = sortedSessions.length > resolvedVisibleSessionCount;
  const projectClickTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (projectClickTimeoutRef.current !== null) {
        window.clearTimeout(projectClickTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "group/project sticky top-0 z-10 flex items-center rounded-[10px] px-2 py-1 backdrop-blur-sm transition-all",
          "relative",
          isProjectActive
            ? "bg-[#e5e7eb]"
            : "hover:bg-[#e5e7eb] focus-within:bg-[#e5e7eb]",
        )}
      >
        <button
          type="button"
          onClick={() => onToggleProject(project.id)}
          aria-label={`${isExpanded ? t("收起", "Collapse") : t("展开", "Expand")} ${project.name} ${t("会话列表", "sessions")}`}
          aria-expanded={isExpanded}
          className="group/project-expand flex size-6 shrink-0 items-center justify-center rounded-full text-[#5a5a55] transition-colors hover:text-[#2f2f2d] focus-visible:text-[#2f2f2d]"
        >
          <span className="relative flex size-4 items-center justify-center">
            <Folder
              className={cn(
                "absolute size-4 transition-opacity duration-150 group-hover/project-expand:opacity-0",
                isProjectActive && "text-[#31312f]",
              )}
            />
            {isExpanded ? (
              <ChevronDown className="absolute size-4 opacity-0 transition-opacity duration-150 group-hover/project-expand:opacity-100" />
            ) : (
              <ChevronRight className="absolute size-4 opacity-0 transition-opacity duration-150 group-hover/project-expand:opacity-100" />
            )}
          </span>
        </button>
        <button
          type="button"
          className={cn(
            "min-w-0 flex-1 rounded-[10px] py-0.5 pl-0.5 pr-[4.5rem] text-left text-[14px] font-medium text-[#3f3f3b] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10",
            isProjectActive && "text-foreground",
          )}
          aria-current={isSelected ? "page" : undefined}
          title={`${project.name}${t("（双击修改名称）", " (double-click to rename)")}`}
          onClick={() => {
            if (projectClickTimeoutRef.current !== null) {
              window.clearTimeout(projectClickTimeoutRef.current);
            }

            projectClickTimeoutRef.current = window.setTimeout(() => {
              projectClickTimeoutRef.current = null;
              onOpenProjectHome(project);
            }, 220);
          }}
          onDoubleClick={() => {
            if (projectClickTimeoutRef.current !== null) {
              window.clearTimeout(projectClickTimeoutRef.current);
              projectClickTimeoutRef.current = null;
            }

            onOpenProjectRename(project);
          }}
        >
          <span className="flex min-w-0 items-baseline">
            <span className="min-w-0 truncate">{project.name}</span>
            <span className="shrink-0 text-[12px] font-normal text-[#8b8b85]">
              （{project.validSessionCount}）
            </span>
          </span>
        </button>

        <div className="pointer-events-none absolute right-0 top-1/2 z-10 flex -translate-y-1/2 items-center justify-end gap-0 opacity-0 transition-opacity group-hover/project:pointer-events-auto group-hover/project:opacity-100 group-focus-within/project:pointer-events-auto group-focus-within/project:opacity-100">
          <ProjectRemoveButton
            project={project}
            isRemovingProject={isRemovingProject}
            onRemoveProject={onRemoveProject}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded-full text-[#6d6d68] transition-colors hover:text-[#2f2f2d] focus-visible:text-[#2f2f2d]"
                aria-label={`${t("在", "Create in")} ${project.name} ${t("中新建会话", "a new session")}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateDraftSession(project);
                }}
              >
                <SquarePen className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{t("新会话", "New Session")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {isExpanded ? (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onCreateDraftSession(project)}
            className={cn(
              "flex w-full items-center rounded-[10px] pl-[30px] pr-2 py-1 text-left transition-all",
              isDraftActive
                ? "bg-[#e5e7eb] text-[#3f3f3b]"
                : "text-[#6d6d68] hover:bg-[#e5e7eb] hover:text-[#3f3f3b]",
            )}
            aria-current={isDraftActive ? "page" : undefined}
          >
            <div className="flex min-w-0 flex-1 items-center px-2 py-0.5">
              <span className="truncate text-[13px] font-medium">
                {t("创建新会话", "New Session")}
              </span>
            </div>
          </button>
          {visibleSessions.map((session) => {
            const isActive = selectedSessionId === session.id;
            const sessionTitle = getSessionDisplayTitle(session);
            const isArchiving =
              sessionActionState?.sessionId === session.id &&
              sessionActionState.action === "archive";
            const isDeleting =
              sessionActionState?.sessionId === session.id &&
              sessionActionState.action === "delete";
            const isSessionActionDisabled = sessionActionState !== null;

            return (
              <div
                key={session.id}
                className={cn(
                  "group/session-item relative flex w-full items-center rounded-[10px] pl-3.5 pr-2 py-1 transition-all",
                  isActive
                    ? "bg-[#e5e7eb] text-[#3f3f3b]"
                    : "text-[#3f3f3b] hover:bg-[#e5e7eb]",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className="flex min-w-0 flex-1 items-center pr-[3.5rem] text-left"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1 pr-1.5 py-0.5">
                    <SessionStateIndicator
                      status={session.status}
                      hasUnread={session.hasUnread}
                      isActive={isActive}
                    />
                    <SessionTitle title={sessionTitle} />
                  </div>
                </button>
                <span className={getSessionDurationClassName()}>
                  {formatSessionDurationPrimaryUnit(session.durationMs, locale)}
                </span>
                <div
                  className={getSessionActionGroupClassName(
                    sessionActionState,
                    session.id,
                  )}
                >
                  <SessionDeleteButton
                    sessionTitle={sessionTitle}
                    isPending={isDeleting}
                    disabled={isSessionActionDisabled}
                    onDelete={() => onDeleteSession(session)}
                  />
                  <SessionArchiveButton
                    sessionTitle={sessionTitle}
                    isPending={isArchiving}
                    disabled={isSessionActionDisabled}
                    onArchive={() => onArchiveSession(session)}
                  />
                </div>
              </div>
            );
          })}
          {hasMoreSessions ? (
            <div className="pl-[38px] pr-2">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 bg-transparent py-0.5 text-left text-[13px] font-medium text-[#6d6d68] transition-colors hover:bg-transparent hover:text-[#2f2f2d] focus-visible:outline-none focus-visible:text-[#2f2f2d] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoadingMoreSessions}
                onClick={() => {
                  void onLoadMoreSessions(project.id);
                }}
              >
                {isLoadingMoreSessions ? (
                  <>
                    <LoaderCircle className="size-3.5 animate-spin" />
                    <span>{t("加载中...", "Loading...")}</span>
                  </>
                ) : (
                  <span>{t("加载更多", "Load More")}</span>
                )}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ArchivedProjectGroup({
  project,
  selectedSessionId,
  onSelectSession,
  sessionActionState,
  onDeleteSession,
}: {
  project: WorkspaceProject;
  selectedSessionId: number | null;
  onSelectSession: (sessionId: number) => void;
  sessionActionState: SessionActionState;
  onDeleteSession: (session: WorkspaceSession) => void;
}) {
  const { locale } = useLocale();
  return (
    <div className="overflow-hidden rounded-[18px] border border-black/8 bg-white/70 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 border-b border-black/6 px-3 py-2.5 text-[13px] font-medium text-[#4a4a48]">
        <Folder className="size-3.5 shrink-0" />
        <span className="truncate">{project.name}</span>
        <span className="shrink-0 text-[11px] text-[#8b8b85]">
          {project.sessions.length}
        </span>
      </div>
      <div className="space-y-1 p-2">
        {project.sessions.map((session) => {
          const isActive = selectedSessionId === session.id;
          const sessionTitle = getSessionDisplayTitle(session);
          const isDeleting =
            sessionActionState?.sessionId === session.id &&
            sessionActionState.action === "delete";
          const isSessionActionDisabled = sessionActionState !== null;

          return (
            <div
              key={session.id}
              className={cn(
                "group/session-item relative flex w-full items-center rounded-[10px] px-2 py-1 text-left transition-all",
                isActive
                  ? "bg-[#e5e7eb] text-[#3f3f3b]"
                  : "text-[#3f3f3b] hover:bg-[#e5e7eb]",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-[3.5rem] text-left"
              >
                <div className="min-w-0 flex flex-1 items-start pr-1.5 py-0.5">
                  <div className="min-w-0 flex-1">
                    <SessionTitle title={sessionTitle} />
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#8b8b85]">
                      <span className="truncate">
                        {formatSessionModelLabel(session.server, session.model)}
                      </span>
                      <span className="shrink-0 text-[#6d6d68]">
                        · {formatSessionDurationPrimaryUnit(session.durationMs, locale)}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
              <div
                className={getSessionActionGroupClassName(
                  sessionActionState,
                  session.id,
                )}
              >
                <SessionDeleteButton
                  sessionTitle={sessionTitle}
                  isPending={isDeleting}
                  disabled={isSessionActionDisabled}
                  onDelete={() => onDeleteSession(session)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionArchiveButton({
  sessionTitle,
  isPending,
  disabled,
  onArchive,
  className,
}: {
  sessionTitle: string;
  isPending: boolean;
  disabled: boolean;
  onArchive: () => void;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${t("归档会话", "Archive Session")} ${sessionTitle}`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onArchive();
          }}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-[#6d6d68] transition-colors hover:text-[#2f2f2d] focus-visible:text-[#2f2f2d] disabled:cursor-not-allowed disabled:opacity-50",
            isPending && "disabled:opacity-100",
            className,
          )}
        >
          {isPending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Archive className="size-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{t("归档", "Archive")}</TooltipContent>
    </Tooltip>
  );
}

function SessionDeleteButton({
  sessionTitle,
  isPending,
  disabled,
  onDelete,
  className,
}: {
  sessionTitle: string;
  isPending: boolean;
  disabled: boolean;
  onDelete: () => void;
  className?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const resolvedOpen = disabled ? false : open;

  return (
    <Popover open={resolvedOpen} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${t("删除会话", "Delete Session")} ${sessionTitle}`}
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
              }}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-[#8a5c5c] transition-colors hover:text-[#7a3030] focus-visible:text-[#7a3030] disabled:cursor-not-allowed disabled:opacity-50",
                isPending && "disabled:opacity-100",
                className,
              )}
            >
              {isPending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{t("删除", "Delete")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={10}
        className="relative w-[216px] rounded-[18px] border border-white/90 bg-white px-3.5 py-3 shadow-[0_18px_52px_rgba(15,23,42,0.14)]"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-full size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-b border-r border-[#f1efe8] bg-white"
        />
        <div className="space-y-2.5">
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-5 text-[#262626]">
              {t("确认删除", "Confirm Deletion")}
            </p>
            <p className="text-[13px] leading-5 text-[#4f4f4f]">
              {t("删除后无法恢复", "This action cannot be undone")}
            </p>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-7 rounded-md px-2.5 text-xs"
            >
              {t("取消", "Cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="h-7 rounded-md px-2.5 text-xs"
            >
              {t("确认", "Confirm")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SessionListItem({
  session,
  isActive,
  hasUnread,
  onSelectSession,
  sessionActionState,
  onArchiveSession,
  onDeleteSession,
}: {
  session: SidebarSessionItem;
  isActive: boolean;
  hasUnread: boolean;
  onSelectSession: (sessionId: number) => void;
  sessionActionState: SessionActionState;
  onArchiveSession: (session: WorkspaceSession) => void;
  onDeleteSession: (session: WorkspaceSession) => void;
}) {
  const { locale } = useLocale();
  const sessionTitle = getSessionDisplayTitle(session);
  const sessionModelLabel = formatSessionModelLabel(session.server, session.model);
  const isArchiving =
    sessionActionState?.sessionId === session.id &&
    sessionActionState.action === "archive";
  const isDeleting =
    sessionActionState?.sessionId === session.id &&
    sessionActionState.action === "delete";
  const isSessionActionDisabled = sessionActionState !== null;

  return (
    <div
      className={cn(
        "group/session-item relative flex w-full items-center rounded-[10px] pr-2 py-1 transition-all",
        isActive
          ? "bg-[#e5e7eb] text-[#3f3f3b]"
          : "text-[#3f3f3b] hover:bg-[#e5e7eb]",
      )}
    >
      <button
        type="button"
        onClick={() => onSelectSession(session.id)}
        className="flex min-w-0 flex-1 items-center pr-[3.5rem] text-left"
      >
        <div className="min-w-0 flex flex-1 items-start gap-2 pr-1.5 py-0.5">
          <SessionStateIndicator
            status={session.status}
            hasUnread={hasUnread}
            isActive={isActive}
          />
          <div className="min-w-0 flex-1">
            <SessionTitle title={sessionTitle} />
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#8b8b85]">
              <Folder className="size-3 shrink-0" />
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{session.projectName}</span>
                <span className="shrink-0 text-[#6d6d68]">
                  · {sessionModelLabel}
                </span>
              </div>
            </div>
          </div>
        </div>
      </button>
      <span className={getSessionDurationClassName()}>
        {formatSessionDurationPrimaryUnit(session.durationMs, locale)}
      </span>
      <div
        className={getSessionActionGroupClassName(sessionActionState, session.id)}
      >
        <SessionDeleteButton
          sessionTitle={sessionTitle}
          isPending={isDeleting}
          disabled={isSessionActionDisabled}
          onDelete={() => onDeleteSession(session)}
        />
        <SessionArchiveButton
          sessionTitle={sessionTitle}
          isPending={isArchiving}
          disabled={isSessionActionDisabled}
          onArchive={() => onArchiveSession(session)}
        />
      </div>
    </div>
  );
}

function SessionStateIndicator({
  status,
  hasUnread = false,
  isActive,
}: {
  status: string;
  hasUnread?: boolean;
  isActive: boolean;
}) {
  const { t } = useLocale();
  const isInProgress = status === "进行中";
  const isPending = status === "待执行";
  const showUnread = hasUnread && !isActive;
  const label = showUnread
    ? t("未读更新", "Unread Update")
    : isInProgress
      ? t("会话进行中", "Session In Progress")
      : isPending
        ? t("会话待执行", "Session Queued")
        : null;

  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className="flex size-4 shrink-0 items-center justify-center"
    >
      {showUnread ? (
        <span className="size-2 rounded-full bg-emerald-500" />
      ) : null}
      {!showUnread && isInProgress ? (
        <LoaderCircle className="size-3.5 animate-spin text-[#6d6d68]" />
      ) : null}
      {!showUnread && !isInProgress && isPending ? (
        <Hourglass className="size-3.5 text-[#8a8a91]" />
      ) : null}
    </span>
  );
}

function QueuedPromptPreviewList({
  prompts,
  pendingPromptIds,
  onRemovePrompt,
}: {
  prompts: WorkspaceQueuedPrompt[];
  pendingPromptIds: number[];
  onRemovePrompt: (queuedPromptId: number) => Promise<void> | void;
}) {
  const { t } = useLocale();
  if (prompts.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto w-[98%] overflow-hidden rounded-t-[8px] border border-b-0 border-[#d4d4d8] bg-white">
      <div className="max-h-[200px] overflow-y-auto">
        {prompts.map((prompt, index) => {
          const isRemovingPrompt = pendingPromptIds.includes(prompt.id);

          return (
            <div
              key={prompt.id}
              className={cn(
                "flex h-10 items-center gap-3 bg-white px-3",
                index > 0 && "border-t border-[#e4e4e7]",
              )}
            >
              <span className="shrink-0 text-center text-[12px] font-medium leading-5 text-[#8a8a91]">
                {t(`队列${index + 1}`, `Queue ${index + 1}`)}
              </span>
              <p className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[#303036]">
                {prompt.content}
              </p>
              <button
                type="button"
                aria-label={t(
                  `移除第 ${index + 1} 条排队消息`,
                  `Remove queued message #${index + 1}`,
                )}
                disabled={isRemovingPrompt}
                onClick={() => {
                  void onRemovePrompt(prompt.id);
                }}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-[#8f8f97] transition-colors hover:bg-[#f4f4f5] hover:text-[#52525b] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRemovingPrompt ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionTitle({
  title,
}: {
  title: string;
}) {
  const titleChars = Array.from(title);
  const displayTitle =
    titleChars.length > 13 ? `${titleChars.slice(0, 13).join("")}...` : title;

  return (
    <span
      title={title}
      className="block min-w-0 max-w-full truncate text-[13px] font-medium"
    >
      {displayTitle}
    </span>
  );
}
