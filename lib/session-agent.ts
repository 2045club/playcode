import {
  CLAUDE_MODEL_OPTIONS,
  CLAUDE_REASONING_OPTIONS,
  getWorkspaceClaudeProviderById,
  getWorkspaceCodexProviderById,
  normalizeClaudeModel,
  normalizeClaudeReasoningEffort,
  type WorkspaceClaudeProvider,
  type WorkspaceClaudeReasoningEffort,
  type WorkspaceCodexProvider,
  type WorkspaceSettings,
} from "@/lib/settings";
import {
  DEFAULT_WORKSPACE_MODEL,
  DEFAULT_WORKSPACE_REASONING_EFFORT,
  WORKSPACE_MODEL_OPTIONS,
  WORKSPACE_REASONING_OPTIONS,
  formatWorkspaceModelLabel,
  normalizeReasoningEffort,
  normalizeWorkspaceModel,
  normalizeWorkspaceProjectServer,
  type WorkspaceProjectServer,
  type WorkspaceReasoningEffort,
} from "@/lib/workspace";

export type WorkspaceAgentReasoningEffort =
  | WorkspaceReasoningEffort
  | WorkspaceClaudeReasoningEffort;

const claudeModelValues = new Set<string>(
  CLAUDE_MODEL_OPTIONS.map((option) => option.value),
);
const claudeReasoningValues = new Set<string>(
  CLAUDE_REASONING_OPTIONS.map((option) => option.value),
);
const codexModelValues = new Set<string>(
  WORKSPACE_MODEL_OPTIONS.map((option) => option.value),
);
const codexReasoningValues = new Set<string>(
  WORKSPACE_REASONING_OPTIONS.map((option) => option.value),
);

export function isClaudeProjectServer(server?: string | null) {
  return normalizeWorkspaceProjectServer(server) === "claude";
}

export function normalizeSessionModelForProjectServer(
  server: WorkspaceProjectServer,
  model?: string | null,
) {
  return isClaudeProjectServer(server)
    ? normalizeClaudeModel(model)
    : normalizeWorkspaceModel(model);
}

export function normalizeSessionReasoningEffortForProjectServer(
  server: WorkspaceProjectServer,
  reasoningEffort?: string | null,
): WorkspaceAgentReasoningEffort {
  return isClaudeProjectServer(server)
    ? normalizeClaudeReasoningEffort(reasoningEffort)
    : normalizeReasoningEffort(reasoningEffort);
}

export function normalizeStoredSessionModel(
  model?: string | null,
  options?: {
    projectServer?: WorkspaceProjectServer | null;
  },
) {
  const trimmedModel = model?.trim() ?? "";

  if (!trimmedModel) {
    return null;
  }

  const detectedServer =
    options?.projectServer ?? detectProjectServerFromModel(trimmedModel);

  if (detectedServer) {
    return normalizeSessionModelForProjectServer(detectedServer, trimmedModel);
  }

  return trimmedModel;
}

export function normalizeStoredSessionReasoningEffort(
  reasoningEffort?: string | null,
  options?: {
    projectServer?: WorkspaceProjectServer | null;
  },
): WorkspaceAgentReasoningEffort | null {
  const trimmedReasoningEffort = reasoningEffort?.trim() ?? "";

  if (!trimmedReasoningEffort) {
    return null;
  }

  const detectedServer =
    options?.projectServer ??
    detectProjectServerFromReasoningEffort(trimmedReasoningEffort);

  if (detectedServer) {
    return normalizeSessionReasoningEffortForProjectServer(
      detectedServer,
      trimmedReasoningEffort,
    );
  }

  if (
    claudeReasoningValues.has(
      trimmedReasoningEffort as WorkspaceClaudeReasoningEffort,
    )
  ) {
    return normalizeClaudeReasoningEffort(trimmedReasoningEffort);
  }

  return normalizeReasoningEffort(trimmedReasoningEffort);
}

export function getModelOptionsForProjectServer(server: WorkspaceProjectServer) {
  return isClaudeProjectServer(server)
    ? CLAUDE_MODEL_OPTIONS
    : WORKSPACE_MODEL_OPTIONS;
}

export function getReasoningOptionsForProjectServer(
  server: WorkspaceProjectServer,
) {
  return isClaudeProjectServer(server)
    ? CLAUDE_REASONING_OPTIONS
    : WORKSPACE_REASONING_OPTIONS;
}

export function formatSessionModelLabel(
  server?: WorkspaceProjectServer | null,
  model?: string | null,
) {
  const resolvedServer = server ?? detectProjectServerFromModel(model) ?? "codex";

  if (isClaudeProjectServer(resolvedServer)) {
    const normalizedModel = normalizeClaudeModel(model);

    return (
      CLAUDE_MODEL_OPTIONS.find((option) => option.value === normalizedModel)
        ?.label ?? CLAUDE_MODEL_OPTIONS[0]?.label ?? normalizedModel
    );
  }

  return formatWorkspaceModelLabel(model?.trim() || DEFAULT_WORKSPACE_MODEL);
}

export function formatSessionReasoningEffortLabel(
  server?: WorkspaceProjectServer | null,
  reasoningEffort?: string | null,
) {
  const resolvedServer =
    server ?? detectProjectServerFromReasoningEffort(reasoningEffort) ?? "codex";

  if (isClaudeProjectServer(resolvedServer)) {
    const normalizedReasoningEffort =
      normalizeClaudeReasoningEffort(reasoningEffort);

    return (
      CLAUDE_REASONING_OPTIONS.find(
        (option) => option.value === normalizedReasoningEffort,
      )?.label ??
      CLAUDE_REASONING_OPTIONS[0]?.label ??
      DEFAULT_WORKSPACE_REASONING_EFFORT
    );
  }

  const normalizedReasoningEffort = normalizeReasoningEffort(reasoningEffort);

  return (
    WORKSPACE_REASONING_OPTIONS.find(
      (option) => option.value === normalizedReasoningEffort,
    )?.label ??
    WORKSPACE_REASONING_OPTIONS[0]?.label ??
    "中"
  );
}

export function getProviderLabelForProjectServer({
  projectServer,
  providerId,
  settings,
}: {
  projectServer: WorkspaceProjectServer;
  providerId?: string | null;
  settings: WorkspaceSettings;
}) {
  const normalizedProviderId = providerId?.trim() ?? "";

  if (!normalizedProviderId) {
    return "默认环境";
  }

  const provider = isClaudeProjectServer(projectServer)
    ? getWorkspaceClaudeProviderById(settings.claudeProviders, normalizedProviderId)
    : getWorkspaceCodexProviderById(settings.codexProviders, normalizedProviderId);

  return provider?.title.trim() || "默认环境";
}

export function resolveDefaultSessionConfigForProjectServer(
  projectServer: WorkspaceProjectServer,
  settings: WorkspaceSettings,
) {
  if (isClaudeProjectServer(projectServer)) {
    return {
      providerId:
        settings.selectedClaudeProviderId || settings.defaultClaudeProviderId || "",
      model: settings.claudeModel,
      reasoningEffort: settings.claudeReasoningEffort as WorkspaceAgentReasoningEffort,
    };
  }

  return {
    providerId:
      settings.selectedCodexProviderId || settings.defaultCodexProviderId || "",
    model: settings.codexModel,
    reasoningEffort: settings.codexReasoningEffort,
  };
}

export function getProvidersForProjectServer(
  projectServer: WorkspaceProjectServer,
  settings: WorkspaceSettings,
): WorkspaceCodexProvider[] | WorkspaceClaudeProvider[] {
  return isClaudeProjectServer(projectServer)
    ? settings.claudeProviders
    : settings.codexProviders;
}

function detectProjectServerFromModel(model?: string | null) {
  const normalizedModel = model?.trim().toLowerCase() ?? "";

  if (!normalizedModel) {
    return null;
  }

  if (
    claudeModelValues.has(normalizedModel) ||
    normalizedModel.startsWith("claude-") ||
    /(?:sonnet|opus|haiku)/u.test(normalizedModel)
  ) {
    return "claude" satisfies WorkspaceProjectServer;
  }

  if (
    codexModelValues.has(normalizedModel) ||
    normalizedModel.startsWith("gpt-")
  ) {
    return "codex" satisfies WorkspaceProjectServer;
  }

  return null;
}

function detectProjectServerFromReasoningEffort(reasoningEffort?: string | null) {
  const normalizedReasoningEffort = reasoningEffort?.trim().toLowerCase() ?? "";

  if (!normalizedReasoningEffort) {
    return null;
  }

  if (normalizedReasoningEffort === "max") {
    return "claude" satisfies WorkspaceProjectServer;
  }

  if (
    normalizedReasoningEffort === "xhigh" ||
    codexReasoningValues.has(normalizedReasoningEffort)
  ) {
    return "codex" satisfies WorkspaceProjectServer;
  }

  return null;
}
