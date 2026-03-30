import { NextRequest, NextResponse } from "next/server";
import { getStoredWorkspaceSettings, saveStoredWorkspaceSettings } from "@/lib/db";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import {
  getClaudeProviderDraftError,
  getCodexProviderDraftError,
  normalizeClaudeModel,
  normalizeClaudeReasoningEffort,
  normalizeWorkspaceClaudeProviders,
  normalizeWorkspaceCodexProviders,
  normalizeWorkspaceProviderConcurrentSessionLimit,
  resolveWorkspaceClaudeProviderIds,
  resolveWorkspaceCodexProviderIds,
  type WorkspaceSettings,
  type WorkspaceSettingsSection,
} from "@/lib/settings";
import {
  normalizeReasoningEffort,
  normalizeWorkspaceModel,
} from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSystemSettings(input: Partial<WorkspaceSettings>) {
  return {
    websocketUrl:
      typeof input.websocketUrl === "string" ? input.websocketUrl.trim() : "",
    token: typeof input.token === "string" ? input.token.trim() : "",
  } satisfies Pick<WorkspaceSettings, "websocketUrl" | "token">;
}

function normalizeCodexSettings(input: Partial<WorkspaceSettings>) {
  const codexProviders = normalizeWorkspaceCodexProviders(input.codexProviders);
  const codexProviderIds = resolveWorkspaceCodexProviderIds({
    providers: codexProviders,
    selectedCodexProviderId: input.selectedCodexProviderId,
    defaultCodexProviderId: input.defaultCodexProviderId,
  });

  return {
    codexProviders,
    selectedCodexProviderId: codexProviderIds.selectedCodexProviderId,
    defaultCodexProviderId: codexProviderIds.defaultCodexProviderId,
    codexProviderConcurrentSessionLimit:
      normalizeWorkspaceProviderConcurrentSessionLimit(
        input.codexProviderConcurrentSessionLimit,
      ),
    codexModel: normalizeWorkspaceModel(
      typeof input.codexModel === "string" ? input.codexModel : "",
    ),
    codexReasoningEffort: normalizeReasoningEffort(
      typeof input.codexReasoningEffort === "string"
        ? input.codexReasoningEffort
        : "",
    ),
  } satisfies Pick<
    WorkspaceSettings,
    | "codexProviders"
    | "selectedCodexProviderId"
    | "defaultCodexProviderId"
    | "codexProviderConcurrentSessionLimit"
    | "codexModel"
    | "codexReasoningEffort"
  >;
}

function normalizeClaudeSettings(input: Partial<WorkspaceSettings>) {
  const claudeProviders = normalizeWorkspaceClaudeProviders(
    input.claudeProviders,
  );
  const claudeProviderIds = resolveWorkspaceClaudeProviderIds({
    providers: claudeProviders,
    selectedClaudeProviderId: input.selectedClaudeProviderId,
    defaultClaudeProviderId: input.defaultClaudeProviderId,
  });

  return {
    claudeProviders,
    selectedClaudeProviderId: claudeProviderIds.selectedClaudeProviderId,
    defaultClaudeProviderId: claudeProviderIds.defaultClaudeProviderId,
    claudeProviderConcurrentSessionLimit:
      normalizeWorkspaceProviderConcurrentSessionLimit(
        input.claudeProviderConcurrentSessionLimit,
      ),
    claudeModel: normalizeClaudeModel(
      typeof input.claudeModel === "string" ? input.claudeModel : "",
    ),
    claudeReasoningEffort: normalizeClaudeReasoningEffort(
      typeof input.claudeReasoningEffort === "string"
        ? input.claudeReasoningEffort
        : "",
    ),
  } satisfies Pick<
    WorkspaceSettings,
    | "claudeProviders"
    | "selectedClaudeProviderId"
    | "defaultClaudeProviderId"
    | "claudeProviderConcurrentSessionLimit"
    | "claudeModel"
    | "claudeReasoningEffort"
  >;
}

function validateCodexSettings(
  settings: ReturnType<typeof normalizeCodexSettings>,
) {
  if (settings.codexProviders.length === 0) {
    return "至少需要配置一个 Provider。";
  }

  for (const provider of settings.codexProviders) {
    const providerLabel = provider.title.trim() || "未命名 Provider";
    const providerError = getCodexProviderDraftError(provider);

    if (providerError) {
      return `Provider「${providerLabel}」配置有误：${providerError}`;
    }
  }

  return null;
}

function validateClaudeSettings(
  settings: ReturnType<typeof normalizeClaudeSettings>,
) {
  if (settings.claudeProviders.length === 0) {
    return null;
  }

  for (const provider of settings.claudeProviders) {
    const providerLabel = provider.title.trim() || "未命名 Provider";
    const providerError = getClaudeProviderDraftError(provider);

    if (providerError) {
      return `Provider「${providerLabel}」配置有误：${providerError}`;
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const storedSettings = getStoredWorkspaceSettings();

  return NextResponse.json({
    settings: storedSettings,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json()) as {
    section?: WorkspaceSettingsSection;
    settings?: Partial<WorkspaceSettings>;
  };
  const section = body.section;
  const currentSettings = getStoredWorkspaceSettings();

  if (section === "system") {
    const nextSettings = normalizeSystemSettings({
      ...currentSettings,
      ...(body.settings ?? {}),
    });
    const savedSettings = saveStoredWorkspaceSettings(nextSettings);

    return NextResponse.json({
      settings: savedSettings,
    });
  }

  if (section === "codex") {
    const nextSettings = normalizeCodexSettings({
      ...currentSettings,
      ...(body.settings ?? {}),
    });

    const codexSettingsError = validateCodexSettings(nextSettings);

    if (codexSettingsError) {
      return NextResponse.json(
        {
          error: codexSettingsError,
        },
        { status: 400 },
      );
    }

    const savedSettings = saveStoredWorkspaceSettings(nextSettings);

    return NextResponse.json({
      settings: savedSettings,
    });
  }

  if (section === "claude") {
    const nextSettings = normalizeClaudeSettings({
      ...currentSettings,
      ...(body.settings ?? {}),
    });

    const claudeSettingsError = validateClaudeSettings(nextSettings);

    if (claudeSettingsError) {
      return NextResponse.json(
        {
          error: claudeSettingsError,
        },
        { status: 400 },
      );
    }

    const savedSettings = saveStoredWorkspaceSettings(nextSettings);

    return NextResponse.json({
      settings: savedSettings,
    });
  }

  return NextResponse.json(
    {
      error: "当前设置分区暂不支持保存。",
    },
    { status: 400 },
  );
}
