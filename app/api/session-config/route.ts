import { NextRequest, NextResponse } from "next/server";
import {
  getSessionAgentConfig,
  getWorkspacePayload,
  markSessionAsRead,
  saveSessionAgentConfig,
  setActiveSession,
} from "@/lib/db";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import { publishWorkspaceRealtimeEvent } from "@/lib/server/realtime-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionConfigRequestBody = {
  sessionId?: number;
  model?: string;
  reasoningEffort?: string;
  providerId?: string;
  makeActive?: boolean;
};

export async function POST(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json().catch(() => ({}))) as SessionConfigRequestBody;
  const sessionId = body.sessionId;

  if (typeof sessionId !== "number") {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少有效的会话 ID。",
      },
      { status: 400 },
    );
  }

  try {
    const currentConfig = getSessionAgentConfig(sessionId);

    if (!currentConfig) {
      return NextResponse.json(
        {
          ok: false,
          error: "会话不存在。",
        },
        { status: 404 },
      );
    }

    const hasConfigMutation =
      typeof body.model === "string" ||
      typeof body.reasoningEffort === "string" ||
      typeof body.providerId === "string";
    const nextConfig = hasConfigMutation
      ? saveSessionAgentConfig({
          sessionId,
          model: typeof body.model === "string" ? body.model : currentConfig.model,
          reasoningEffort:
            typeof body.reasoningEffort === "string"
              ? body.reasoningEffort
              : currentConfig.reasoningEffort,
          providerId:
            typeof body.providerId === "string"
              ? body.providerId
              : currentConfig.providerId,
        })
      : currentConfig;

    if (body.makeActive) {
      setActiveSession(sessionId);
      markSessionAsRead(sessionId);
    }

    const responseBody: {
      ok: true;
      sessionId: number;
      config: typeof nextConfig;
      workspace?: ReturnType<typeof getWorkspacePayload>;
    } = {
      ok: true,
      sessionId,
      config: nextConfig,
    };

    if (hasConfigMutation) {
      const workspace = getWorkspacePayload();

      publishWorkspaceRealtimeEvent({
        type: "workspace.snapshot",
        workspace,
      });
      responseBody.workspace = workspace;
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "保存会话配置失败。",
      },
      { status: 400 },
    );
  }
}
