import { NextRequest, NextResponse } from "next/server";
import {
  getProjectSessionsPage,
  getInProgressSessionCountByProvider,
  getSessionAgentConfig,
  getSessionUsageTotals,
  getSessionUserMessages,
  getWorkspacePayload,
  removeQueuedSessionPrompt,
  removeSession,
  renameSession,
  setSessionArchived,
} from "@/lib/db";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import { publishWorkspaceRealtimeEvent } from "@/lib/server/realtime-events";
import { normalizeWorkspaceProjectServer } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionArchiveRequestBody = {
  sessionId?: number;
  archived?: boolean;
  name?: string;
  queuedPromptId?: number;
};

type SessionDeleteRequestBody = {
  sessionId?: number;
};

function publishWorkspaceSnapshot() {
  const workspace = getWorkspacePayload();

  publishWorkspaceRealtimeEvent({
    type: "workspace.snapshot",
    workspace,
  });

  return workspace;
}

export async function GET(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const sessionIdParam = request.nextUrl.searchParams.get("sessionId");
  const providerIdParam = request.nextUrl.searchParams.get("providerId");
  const projectIdParam = request.nextUrl.searchParams.get("projectId");
  const projectServerParam = request.nextUrl.searchParams.get("server");

  if (sessionIdParam === null && projectIdParam !== null) {
    const projectId = projectIdParam.trim() ? Number(projectIdParam) : NaN;
    const offsetParam = request.nextUrl.searchParams.get("offset");
    const limitParam = request.nextUrl.searchParams.get("limit");
    const offset =
      typeof offsetParam === "string" && offsetParam.trim()
        ? Number(offsetParam)
        : 0;
    const limit =
      typeof limitParam === "string" && limitParam.trim()
        ? Number(limitParam)
        : 10;

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "缺少有效的项目 ID。",
        },
        { status: 400 },
      );
    }

    if (!Number.isInteger(offset) || offset < 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "缺少有效的分页偏移量。",
        },
        { status: 400 },
      );
    }

    if (!Number.isInteger(limit) || limit <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "缺少有效的分页大小。",
        },
        { status: 400 },
      );
    }

    const page = getProjectSessionsPage(projectId, {
      offset,
      limit,
    });

    if (!page) {
      return NextResponse.json(
        {
          ok: false,
          error: "项目不存在。",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      projectId,
      offset,
      limit,
      sessions: page.sessions,
      totalCount: page.totalCount,
      hasMore: page.hasMore,
    });
  }

  if (sessionIdParam === null && providerIdParam !== null) {
    const normalizedProviderId = providerIdParam.trim();
    const normalizedProjectServer =
      typeof projectServerParam === "string" && projectServerParam.trim()
        ? normalizeWorkspaceProjectServer(projectServerParam)
        : null;

    return NextResponse.json({
      ok: true,
      providerId: normalizedProviderId,
      inProgressCount: getInProgressSessionCountByProvider(normalizedProviderId, {
        projectServer: normalizedProjectServer,
      }),
    });
  }

  const sessionId =
    typeof sessionIdParam === "string" && sessionIdParam.trim()
      ? Number(sessionIdParam)
      : NaN;

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少有效的会话 ID。",
      },
      { status: 400 },
    );
  }

  const usageTotals = getSessionUsageTotals(sessionId);
  const sessionConfig = getSessionAgentConfig(sessionId);

  if (!usageTotals || !sessionConfig) {
    return NextResponse.json(
      {
        ok: false,
        error: "会话不存在。",
      },
      { status: 404 },
    );
  }

  const userMessages = getSessionUserMessages(sessionId) ?? [];

  return NextResponse.json({
    ok: true,
    sessionId,
    providerId: sessionConfig.providerId,
    usageTotals,
    userMessages,
  });
}

export async function PATCH(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json().catch(() => ({}))) as SessionArchiveRequestBody;
  const sessionId = body.sessionId;
  const archived = body.archived;
  const name = body.name;
  const queuedPromptId = body.queuedPromptId;

  if (typeof queuedPromptId === "number") {
    try {
      const removedSessionId = removeQueuedSessionPrompt(queuedPromptId, {
        markSessionCompletedWhenQueueEmpty: true,
      });

      if (removedSessionId === null) {
        return NextResponse.json(
          {
            ok: false,
            error: "队列项不存在。",
          },
          { status: 404 },
        );
      }

      const workspace = publishWorkspaceSnapshot();

      return NextResponse.json({
        ok: true,
        queuedPromptId,
        sessionId: removedSessionId,
        workspace,
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "移除队列项失败。",
        },
        { status: 400 },
      );
    }
  }

  if (typeof sessionId !== "number") {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少有效的会话 ID。",
      },
      { status: 400 },
    );
  }

  if (typeof name === "string") {
    try {
      const renamedSession = renameSession(sessionId, name);
      const workspace = publishWorkspaceSnapshot();

      return NextResponse.json({
        ok: true,
        sessionId,
        name: renamedSession.name,
        workspace,
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "更新会话名称失败。",
        },
        { status: 400 },
      );
    }
  }

  if (typeof archived !== "boolean") {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少有效的归档状态。",
      },
      { status: 400 },
    );
  }

  try {
    setSessionArchived(sessionId, archived);
    const workspace = publishWorkspaceSnapshot();

    return NextResponse.json({
      ok: true,
      sessionId,
      archived,
      workspace,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "更新会话归档状态失败。",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json().catch(() => ({}))) as SessionDeleteRequestBody;
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
    const removedSession = removeSession(sessionId);
    const workspace = publishWorkspaceSnapshot();

    return NextResponse.json({
      ok: true,
      removedSession,
      workspace,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "删除会话失败。",
      },
      { status: 400 },
    );
  }
}
