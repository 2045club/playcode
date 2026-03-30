import {
  DEFAULT_WORKSPACE_MODEL,
  DEFAULT_WORKSPACE_REASONING_EFFORT,
  type WorkspaceReasoningEffort,
} from "@/lib/workspace";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
export const DEFAULT_CLAUDE_REASONING_EFFORT = "medium";

export const CLAUDE_MODEL_OPTIONS = [
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
  { value: "claude-opus-4-5", label: "Opus 4.5" },
  { value: "claude-opus-3", label: "Opus 3" },
  { value: "claude-sonnet-4-5", label: "Sonnet 4.5" },
] as const;

export type WorkspaceClaudeModel =
  (typeof CLAUDE_MODEL_OPTIONS)[number]["value"];

export const CLAUDE_REASONING_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "max", label: "最高" },
] as const;

export type WorkspaceClaudeReasoningEffort =
  (typeof CLAUDE_REASONING_OPTIONS)[number]["value"];

export type WorkspaceSettingsSection = "system" | "codex" | "claude";

export type ConnectionPhase =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "error";

export type ConnectionStatus = {
  phase: ConnectionPhase;
  error: string | null;
};

export type WorkspaceProvider = {
  id: string;
  name: string;
  provider: string;
  title: string;
  api_key: string;
  base_url: string;
  custom: boolean;
  enabled: boolean;
};

export type WorkspaceCodexProvider = WorkspaceProvider;
export type WorkspaceClaudeProvider = WorkspaceProvider;

export type WorkspaceSettings = {
  websocketUrl: string;
  token: string;
  codexProviders: WorkspaceCodexProvider[];
  selectedCodexProviderId: string;
  defaultCodexProviderId: string;
  codexProviderConcurrentSessionLimit: number;
  codexModel: string;
  codexReasoningEffort: WorkspaceReasoningEffort;
  claudeProviders: WorkspaceClaudeProvider[];
  selectedClaudeProviderId: string;
  defaultClaudeProviderId: string;
  claudeProviderConcurrentSessionLimit: number;
  claudeModel: WorkspaceClaudeModel;
  claudeReasoningEffort: WorkspaceClaudeReasoningEffort;
};

export const defaultWorkspaceSettings: WorkspaceSettings = {
  websocketUrl: "",
  token: "",
  codexProviders: [],
  selectedCodexProviderId: "",
  defaultCodexProviderId: "",
  codexProviderConcurrentSessionLimit: 5,
  codexModel: DEFAULT_WORKSPACE_MODEL,
  codexReasoningEffort: DEFAULT_WORKSPACE_REASONING_EFFORT,
  claudeProviders: [],
  selectedClaudeProviderId: "",
  defaultClaudeProviderId: "",
  claudeProviderConcurrentSessionLimit: 5,
  claudeModel: DEFAULT_CLAUDE_MODEL,
  claudeReasoningEffort: DEFAULT_CLAUDE_REASONING_EFFORT,
};

export const defaultConnectionStatus: ConnectionStatus = {
  phase: "disconnected",
  error: null,
};

export function createWorkspaceProvider(
  overrides?: Partial<WorkspaceProvider>,
  existingNames: Iterable<string> = [],
  options?: {
    defaultProvider?: string;
  },
): WorkspaceProvider {
  const base_url =
    typeof overrides?.base_url === "string" ? overrides.base_url.trim() : "";

  return {
    id: overrides?.id?.trim() || createWorkspaceCodexEntityId("provider"),
    name: resolveWorkspaceCodexProviderName({
      rawName: overrides?.name,
      seenNames: new Set(existingNames),
      hasExplicitTitle: typeof overrides?.title === "string",
    }),
    provider: resolveWorkspaceProviderValue(
      overrides?.provider,
      options?.defaultProvider,
    ),
    title: typeof overrides?.title === "string" ? overrides.title.trim() : "",
    api_key:
      typeof overrides?.api_key === "string" ? overrides.api_key.trim() : "",
    base_url,
    custom: base_url.length > 0,
    enabled: overrides?.enabled ?? true,
  };
}

export function createWorkspaceCodexProvider(
  overrides?: Partial<WorkspaceCodexProvider>,
  existingNames: Iterable<string> = [],
): WorkspaceCodexProvider {
  return createWorkspaceProvider(overrides, existingNames, {
    defaultProvider: "openai",
  });
}

export function createWorkspaceClaudeProvider(
  overrides?: Partial<WorkspaceClaudeProvider>,
  existingNames: Iterable<string> = [],
): WorkspaceClaudeProvider {
  return createWorkspaceProvider(overrides, existingNames, {
    defaultProvider: "anthropic",
  });
}

export function normalizeWorkspaceProviders(
  input: unknown,
  options?: {
    defaultProvider?: string;
  },
): WorkspaceProvider[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalizedProviders: WorkspaceProvider[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const rawProvider of input) {
    if (!rawProvider || typeof rawProvider !== "object") {
      continue;
    }

    const candidateProvider = rawProvider as Partial<WorkspaceCodexProvider> & {
      provider?: string;
      baseUrl?: string;
      base_url?: string;
      apiKey?: string;
      api_key?: string;
      API_URL?: string;
      API_KEY?: string;
    };
    let nextId =
      candidateProvider.id?.trim() || createWorkspaceCodexEntityId("provider");

    while (seenIds.has(nextId)) {
      nextId = createWorkspaceCodexEntityId("provider");
    }

    const base_url =
      typeof candidateProvider.base_url === "string"
        ? candidateProvider.base_url.trim()
        : typeof candidateProvider.baseUrl === "string"
          ? candidateProvider.baseUrl.trim()
          : typeof candidateProvider.API_URL === "string"
            ? candidateProvider.API_URL.trim()
          : "";
    const title =
      typeof candidateProvider.title === "string"
        ? candidateProvider.title.trim()
        : typeof candidateProvider.name === "string"
          ? candidateProvider.name.trim()
          : "";
    const nextName = resolveWorkspaceCodexProviderName({
      rawName: candidateProvider.name,
      seenNames,
      hasExplicitTitle: typeof candidateProvider.title === "string",
    });

    seenIds.add(nextId);
    seenNames.add(nextName);
    const normalizedProvider = resolveWorkspaceProviderValue(
      candidateProvider.provider,
      options?.defaultProvider,
    );

    normalizedProviders.push({
      id: nextId,
      name: nextName,
      provider: normalizedProvider,
      title,
      api_key:
        typeof candidateProvider.api_key === "string"
          ? candidateProvider.api_key.trim()
          : typeof candidateProvider.apiKey === "string"
            ? candidateProvider.apiKey.trim()
            : typeof candidateProvider.API_KEY === "string"
              ? candidateProvider.API_KEY.trim()
            : "",
      base_url,
      custom: base_url.length > 0,
      enabled:
        typeof candidateProvider.enabled === "boolean"
          ? candidateProvider.enabled
          : true,
    });
  }

  return normalizedProviders;
}

export function normalizeWorkspaceCodexProviders(
  input: unknown,
): WorkspaceCodexProvider[] {
  return normalizeWorkspaceProviders(input, {
    defaultProvider: "openai",
  });
}

export function normalizeWorkspaceClaudeProviders(
  input: unknown,
): WorkspaceClaudeProvider[] {
  return normalizeWorkspaceProviders(input, {
    defaultProvider: "anthropic",
  });
}

export function resolveWorkspaceProviderIds({
  providers,
  selectedProviderId,
  defaultProviderId,
}: {
  providers: WorkspaceProvider[];
  selectedProviderId?: string | null;
  defaultProviderId?: string | null;
}) {
  const normalizedSelectedProviderId =
    getWorkspaceProviderById(providers, selectedProviderId)?.id ??
    getWorkspaceProviderById(providers, defaultProviderId)?.id ??
    providers[0]?.id ??
    "";

  return {
    selectedProviderId: normalizedSelectedProviderId,
    defaultProviderId:
      getWorkspaceProviderById(providers, defaultProviderId)?.id ??
      normalizedSelectedProviderId,
  };
}

export function resolveWorkspaceCodexProviderIds({
  providers,
  selectedCodexProviderId,
  defaultCodexProviderId,
}: {
  providers: WorkspaceCodexProvider[];
  selectedCodexProviderId?: string | null;
  defaultCodexProviderId?: string | null;
}) {
  const resolvedProviderIds = resolveWorkspaceProviderIds({
    providers,
    selectedProviderId: selectedCodexProviderId,
    defaultProviderId: defaultCodexProviderId,
  });

  return {
    selectedCodexProviderId: resolvedProviderIds.selectedProviderId,
    defaultCodexProviderId: resolvedProviderIds.defaultProviderId,
  };
}

export function resolveWorkspaceClaudeProviderIds({
  providers,
  selectedClaudeProviderId,
  defaultClaudeProviderId,
}: {
  providers: WorkspaceClaudeProvider[];
  selectedClaudeProviderId?: string | null;
  defaultClaudeProviderId?: string | null;
}) {
  const resolvedProviderIds = resolveWorkspaceProviderIds({
    providers,
    selectedProviderId: selectedClaudeProviderId,
    defaultProviderId: defaultClaudeProviderId,
  });

  return {
    selectedClaudeProviderId: resolvedProviderIds.selectedProviderId,
    defaultClaudeProviderId: resolvedProviderIds.defaultProviderId,
  };
}

export function getWorkspaceProviderById(
  providers: WorkspaceProvider[],
  providerId?: string | null,
) {
  const normalizedProviderId = providerId?.trim() ?? "";

  if (!normalizedProviderId) {
    return null;
  }

  return (
    providers.find((provider) => provider.id === normalizedProviderId) ?? null
  );
}

export function getWorkspaceCodexProviderById(
  providers: WorkspaceCodexProvider[],
  providerId?: string | null,
) {
  return getWorkspaceProviderById(providers, providerId);
}

export function getWorkspaceClaudeProviderById(
  providers: WorkspaceClaudeProvider[],
  providerId?: string | null,
) {
  return getWorkspaceProviderById(providers, providerId);
}

export function validateCodexApiUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);

    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return null;
    }

    return "接口地址需要以 http:// 或 https:// 开头。";
  } catch {
    return "请输入有效的接口地址。";
  }
}

export function getWorkspaceProviderDraftError(provider: WorkspaceProvider) {
  if (!provider.enabled) {
    return null;
  }

  if (!provider.title.trim()) {
    return "请输入 Provider 名称。";
  }

  if (!provider.api_key.trim()) {
    return "请输入 api_key。";
  }

  const apiUrlError = validateCodexApiUrl(provider.base_url);

  if (apiUrlError) {
    return `base_url 无效：${apiUrlError}`;
  }

  return null;
}

export function getCodexProviderDraftError(provider: WorkspaceCodexProvider) {
  return getWorkspaceProviderDraftError(provider);
}

export function getClaudeProviderDraftError(provider: WorkspaceClaudeProvider) {
  return getWorkspaceProviderDraftError(provider);
}

function createWorkspaceCodexEntityId(prefix: "provider" | "token") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function resolveWorkspaceProviderValue(
  rawProvider: unknown,
  fallbackProvider = "openai",
) {
  const trimmedProvider =
    typeof rawProvider === "string" ? rawProvider.trim() : "";

  return trimmedProvider || fallbackProvider;
}

export function normalizeWorkspaceProviderConcurrentSessionLimit(
  value: unknown,
) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return defaultWorkspaceSettings.codexProviderConcurrentSessionLimit;
  }

  return Math.max(1, Math.floor(numericValue));
}

export function normalizeClaudeModel(
  model?: string | null,
): WorkspaceClaudeModel {
  const normalizedModel = model?.trim().toLowerCase() ?? "";

  if (!normalizedModel) {
    return DEFAULT_CLAUDE_MODEL;
  }

  const directMatch = CLAUDE_MODEL_OPTIONS.find(
    (option) => option.value === normalizedModel,
  );

  if (directMatch) {
    return directMatch.value;
  }

  return claudeModelAliases.get(normalizedModel) ?? DEFAULT_CLAUDE_MODEL;
}

export function normalizeClaudeReasoningEffort(
  reasoningEffort?: string | null,
): WorkspaceClaudeReasoningEffort {
  const normalizedReasoningEffort = reasoningEffort?.trim().toLowerCase() ?? "";

  return (
    claudeReasoningEffortAliases.get(normalizedReasoningEffort) ??
    DEFAULT_CLAUDE_REASONING_EFFORT
  );
}

function resolveWorkspaceCodexProviderName({
  rawName,
  seenNames,
  hasExplicitTitle,
}: {
  rawName: unknown;
  seenNames: Set<string>;
  hasExplicitTitle: boolean;
}) {
  const normalizedRawName =
    typeof rawName === "string" ? rawName.trim().toLowerCase() : "";
  const canReuseExistingName =
    hasExplicitTitle && /^[a-z]{6}$/.test(normalizedRawName);

  if (canReuseExistingName && !seenNames.has(normalizedRawName)) {
    return normalizedRawName;
  }

  let nextName = generateWorkspaceCodexProviderName();

  while (seenNames.has(nextName)) {
    nextName = generateWorkspaceCodexProviderName();
  }

  return nextName;
}

function generateWorkspaceCodexProviderName() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let value = "";

  for (let index = 0; index < 6; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return value;
}

const claudeModelAliases = new Map<string, WorkspaceClaudeModel>([
  ["claude-sonnet-4-6", "claude-sonnet-4-6"],
  ["sonnet-4.6", "claude-sonnet-4-6"],
  ["sonnet 4.6", "claude-sonnet-4-6"],
  ["claude-opus-4-6", "claude-opus-4-6"],
  ["opus-4.6", "claude-opus-4-6"],
  ["opus 4.6", "claude-opus-4-6"],
  ["claude-haiku-4-5", "claude-haiku-4-5"],
  ["haiku-4.5", "claude-haiku-4-5"],
  ["haiku 4.5", "claude-haiku-4-5"],
  ["claude-opus-4-5", "claude-opus-4-5"],
  ["opus-4.5", "claude-opus-4-5"],
  ["opus 4.5", "claude-opus-4-5"],
  ["claude-opus-3", "claude-opus-3"],
  ["opus-3", "claude-opus-3"],
  ["opus 3", "claude-opus-3"],
  ["claude-sonnet-4-5", "claude-sonnet-4-5"],
  ["sonnet-4.5", "claude-sonnet-4-5"],
  ["sonnet 4.5", "claude-sonnet-4-5"],
]);

const claudeReasoningEffortAliases = new Map<
  string,
  WorkspaceClaudeReasoningEffort
>([
  ["low", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["max", "max"],
  ["xhigh", "max"],
]);
