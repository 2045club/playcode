import type { CodexOptions } from "@openai/codex-sdk";
import {
  getWorkspaceCodexProviderById,
  type WorkspaceCodexProvider,
  type WorkspaceSettings,
} from "@/lib/settings";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const BLOCKED_CODEX_ENV_KEYS = new Set([
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
]);

function resolvePreferredCodexProvider(storedSettings: WorkspaceSettings) {
  const availableProviders = storedSettings.codexProviders.filter(
    (provider) => provider.enabled,
  );

  if (availableProviders.length === 0) {
    return null;
  }

  return (
    availableProviders[0] ??
    null
  );
}

export function resolveConfiguredCodexProviderCandidates(
  storedSettings: WorkspaceSettings,
  preferredProviderId?: string | null,
): WorkspaceCodexProvider[] {
  const availableProviders = storedSettings.codexProviders.filter(
    (provider) => provider.enabled,
  );

  if (availableProviders.length === 0) {
    return [];
  }

  const preferredProvider =
    getWorkspaceCodexProviderById(availableProviders, preferredProviderId) ??
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

export function resolveConfiguredCodexProvider(
  storedSettings: WorkspaceSettings,
  sessionProviderId?: string | null,
) {
  const preferredProvider = resolvePreferredCodexProvider(storedSettings);

  if (!sessionProviderId?.trim()) {
    return preferredProvider;
  }

  return (
    getWorkspaceCodexProviderById(
      storedSettings.codexProviders.filter((provider) => provider.enabled),
      sessionProviderId,
    ) ?? preferredProvider
  );
}

export function resolveCodexProviderBaseUrl(
  configuredProvider: WorkspaceCodexProvider,
) {
  return configuredProvider.base_url.trim() || DEFAULT_OPENAI_BASE_URL;
}

export function resolveCodexProviderName(
  configuredProvider: WorkspaceCodexProvider,
) {
  return (
    configuredProvider.name.trim() ||
    configuredProvider.id.trim() ||
    "provider"
  );
}

function buildCodexCliEnv() {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string" || BLOCKED_CODEX_ENV_KEYS.has(key)) {
      continue;
    }

    env[key] = value;
  }

  return env;
}

export function resolveCodexProviderLaunchConfig(
  configuredProvider?: WorkspaceCodexProvider | null,
) {
  if (!configuredProvider) {
    throw new Error("当前没有启用的 Provider，请先在 Codex 设置中启用至少一个 Provider。");
  }

  const providerTitle =
    configuredProvider.title.trim() || "未命名 Provider";
  const providerName = resolveCodexProviderName(configuredProvider);
  const providerConfigName =
    configuredProvider.provider.trim() || providerName;
  const apiKey = configuredProvider.api_key.trim();
  const providerBaseUrl = configuredProvider.base_url.trim();
  const runtimeBaseUrl =
    providerBaseUrl || resolveCodexProviderBaseUrl(configuredProvider);
  const modelProvider = providerName;

  if (!apiKey) {
    throw new Error(
      `Provider「${providerTitle}」缺少 api_key，请先在系统设置中补全后再运行 Codex。`,
    );
  }

  const config: NonNullable<CodexOptions["config"]> = {
    model_provider: modelProvider,
    model_providers: {
      [providerName]: {
        name: providerConfigName,
        base_url: runtimeBaseUrl,
      },
    },
  };

  return {
    apiKey,
    baseUrl: runtimeBaseUrl,
    modelProvider,
    config,
    env: buildCodexCliEnv(),
  };
}
