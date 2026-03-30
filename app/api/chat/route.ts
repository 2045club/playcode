import { NextRequest, NextResponse } from "next/server";
import {
  getProject,
  getSessionProjectServer,
  getWorkspacePayload,
  resolveWorkspaceSessionId,
} from "@/lib/db";
import { normalizeClaudeReasoningEffort } from "@/lib/settings";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import { runCodexPrompt, stopCodexRun } from "@/lib/server/codex-bridge";
import { runClaudePrompt, stopClaudeRun } from "@/lib/server/claude-bridge";
import { normalizeReasoningEffort } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequestBody = {
  prompt?: string;
  sessionId?: number | null;
  projectId?: number | null;
  server?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  providerId?: string | null;
};

function resolveChatProjectServer(body: ChatRequestBody) {
  if (typeof body.sessionId === "number") {
    return getSessionProjectServer(body.sessionId);
  }

  if (typeof body.server === "string") {
    const requestedServer = body.server.trim().toLowerCase();

    if (requestedServer === "codex" || requestedServer === "claude") {
      return requestedServer;
    }
  }

  if (typeof body.projectId === "number") {
    return getProject(body.projectId)?.server ?? null;
  }

  try {
    return getSessionProjectServer(resolveWorkspaceSessionId(null));
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json()) as ChatRequestBody;
  const projectServer = resolveChatProjectServer(body);

  try {
    const chatRequest = {
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      sessionId: typeof body.sessionId === "number" ? body.sessionId : null,
      projectId: typeof body.projectId === "number" ? body.projectId : null,
      server:
        typeof body.server === "string" ? body.server : null,
      model: typeof body.model === "string" ? body.model : null,
      providerId: typeof body.providerId === "string" ? body.providerId : null,
      source: "ui" as const,
    };
    const result =
      projectServer === "claude"
        ? await runClaudePrompt({
            ...chatRequest,
            reasoningEffort:
              typeof body.reasoningEffort === "string"
                ? normalizeClaudeReasoningEffort(body.reasoningEffort)
                : null,
          })
        : await runCodexPrompt({
            ...chatRequest,
            reasoningEffort:
              typeof body.reasoningEffort === "string"
                ? normalizeReasoningEffort(body.reasoningEffort)
                : null,
          });

    return NextResponse.json({
      ok: true,
      result,
      workspace: getWorkspacePayload(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "消息发送失败。",
        workspace: getWorkspacePayload(),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
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
    const projectServer = getSessionProjectServer(sessionId);
    const result =
      projectServer === "claude" ? stopClaudeRun(sessionId) : stopCodexRun(sessionId);

    return NextResponse.json({
      ok: true,
      state: result.state,
      workspace: result.workspace ?? getWorkspacePayload(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "停止会话失败。",
        workspace: getWorkspacePayload(),
      },
      { status: 500 },
    );
  }
}
