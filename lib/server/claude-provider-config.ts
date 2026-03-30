import {
  getWorkspaceClaudeProviderById,
  type WorkspaceClaudeProvider,
  type WorkspaceSettings,
} from "@/lib/settings";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const BLOCKED_CLAUDE_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
]);

function resolvePreferredClaudeProvider(storedSettings: WorkspaceSettings) {
  const availableProviders = storedSettings.claudeProviders.filter(
    (provider) => provider.enabled,
  );

  if (availableProviders.length === 0) {
    return null;
  }

  return availableProviders[0] ?? null;
}

export function resolveConfiguredClaudeProviderCandidates(
  storedSettings: WorkspaceSettings,
  preferredProviderId?: string | null,
): WorkspaceClaudeProvider[] {
  const availableProviders = storedSettings.claudeProviders.filter(
    (provider) => provider.enabled,
  );

  if (availableProviders.length === 0) {
    return [];
  }

  const preferredProvider =
    getWorkspaceClaudeProviderById(availableProviders, preferredProviderId) ??
    availableProviders[0] ??
    null;

  if (!preferredProvider) {
    return availableProviders;
  }

  return [
    preferredProvider,
    ...availableProviders.filter(
      (provider) => provider.id !== preferredProvider.id,
    ),
  ];
}

export function resolveConfiguredClaudeProvider(
  storedSettings: WorkspaceSettings,
  sessionProviderId?: string | null,
) {
  const preferredProvider = resolvePreferredClaudeProvider(storedSettings);

  if (!sessionProviderId?.trim()) {
    return preferredProvider;
  }

  return (
    getWorkspaceClaudeProviderById(
      storedSettings.claudeProviders.filter((provider) => provider.enabled),
      sessionProviderId,
    ) ?? preferredProvider
  );
}

export function resolveClaudeProviderBaseUrl(
  configuredProvider: WorkspaceClaudeProvider,
) {
  return configuredProvider.base_url.trim() || DEFAULT_ANTHROPIC_BASE_URL;
}

function buildClaudeCliEnv() {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string" || BLOCKED_CLAUDE_ENV_KEYS.has(key)) {
      continue;
    }

    env[key] = value;
  }

  return env;
}

export function resolveClaudeProviderLaunchConfig(
  configuredProvider?: WorkspaceClaudeProvider | null,
) {
  if (!configuredProvider) {
    throw new Error("当前没有启用的 Provider，请先在 Claude 设置中启用至少一个 Provider。");
  }

  const providerTitle = configuredProvider.title.trim() || "未命名 Provider";
  const apiKey = configuredProvider.api_key.trim();
  const baseUrl = resolveClaudeProviderBaseUrl(configuredProvider);

  if (!apiKey) {
    throw new Error(
      `Provider「${providerTitle}」缺少 api_key，请先在 Claude 设置中补全后再运行 Claude。`,
    );
  }

  const env = buildClaudeCliEnv();

  env.ANTHROPIC_API_KEY = apiKey;
  env.ANTHROPIC_BASE_URL = baseUrl;

  return {
    apiKey,
    baseUrl,
    env,
  };
}
