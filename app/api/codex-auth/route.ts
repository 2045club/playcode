import { NextResponse } from "next/server";
import { getStoredWorkspaceSettings } from "@/lib/db";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import {
  resolveConfiguredCodexProvider,
  resolveCodexProviderBaseUrl,
} from "@/lib/server/codex-provider-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const storedSettings = getStoredWorkspaceSettings();
  const provider = resolveConfiguredCodexProvider(storedSettings);

  return NextResponse.json({
    apiKey: provider?.api_key.trim() || null,
    baseUrl: provider ? resolveCodexProviderBaseUrl(provider) : null,
    providerId: provider?.id ?? null,
    providerTitle: provider?.title.trim() || null,
  });
}
