import { NextRequest, NextResponse } from "next/server";
import {
  createProject,
  getWorkspacePayload,
  renameProject,
  removeProject,
  setProjectServer,
} from "@/lib/db";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import { publishWorkspaceRealtimeEvent } from "@/lib/server/realtime-events";
import {
  WORKSPACE_PROJECT_SERVER_OPTIONS,
  type WorkspaceProjectServer,
} from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateProjectRequestBody = {
  projectPath?: string;
};

type ProjectActionRequestBody = {
  projectId?: number;
};

type RenameProjectRequestBody = {
  projectId?: number;
  name?: string;
};

type UpdateProjectServerRequestBody = {
  projectId?: number;
  server?: string;
};

const projectServerValues = new Set<WorkspaceProjectServer>(
  WORKSPACE_PROJECT_SERVER_OPTIONS.map((option) => option.value),
);

function normalizeRequestPath(input?: string) {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeProjectId(input: unknown) {
  return typeof input === "number" && Number.isInteger(input) ? input : null;
}

function publishWorkspaceSnapshot() {
  const workspace = getWorkspacePayload();

  publishWorkspaceRealtimeEvent({
    type: "workspace.snapshot",
    workspace,
  });

  return workspace;
}

export async function POST(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json().catch(() => ({}))) as CreateProjectRequestBody;
  const requestedProjectPath = normalizeRequestPath(body.projectPath);

  if (!requestedProjectPath) {
    return NextResponse.json(
      {
        ok: false,
        error: "请选择要添加的本地目录。",
      },
      { status: 400 },
    );
  }

  try {
    const project = createProject(requestedProjectPath);
    const workspace = publishWorkspaceSnapshot();

    return NextResponse.json({
      ok: true,
      project,
      workspace,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "新增项目失败。",
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

  const body = (await request.json().catch(() => ({}))) as ProjectActionRequestBody;
  const projectId = normalizeProjectId(body.projectId);

  if (projectId === null) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少有效的项目 ID。",
      },
      { status: 400 },
    );
  }

  try {
    const removedProject = removeProject(projectId);
    const workspace = publishWorkspaceSnapshot();

    return NextResponse.json({
      ok: true,
      removedProject,
      workspace,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "移除项目失败。",
      },
      { status: 400 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json().catch(() => ({}))) as RenameProjectRequestBody;
  const projectId = normalizeProjectId(body.projectId);
  const nextName = typeof body.name === "string" ? body.name.trim() : "";

  if (projectId === null) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少有效的项目 ID。",
      },
      { status: 400 },
    );
  }

  if (!nextName) {
    return NextResponse.json(
      {
        ok: false,
        error: "项目名称不能为空。",
      },
      { status: 400 },
    );
  }

  try {
    const project = renameProject(projectId, nextName);
    const workspace = publishWorkspaceSnapshot();

    return NextResponse.json({
      ok: true,
      project,
      workspace,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "更新项目名称失败。",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json().catch(() => ({}))) as UpdateProjectServerRequestBody;
  const projectId = normalizeProjectId(body.projectId);
  const nextServer =
    typeof body.server === "string" ? body.server.trim().toLowerCase() : "";
  const normalizedServer = nextServer as WorkspaceProjectServer;

  if (projectId === null) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少有效的项目 ID。",
      },
      { status: 400 },
    );
  }

  if (!projectServerValues.has(normalizedServer)) {
    return NextResponse.json(
      {
        ok: false,
        error: "项目 server 仅支持 codex 或 claude。",
      },
      { status: 400 },
    );
  }

  try {
    const project = setProjectServer(projectId, normalizedServer);
    const workspace = publishWorkspaceSnapshot();

    return NextResponse.json({
      ok: true,
      project,
      workspace,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "更新项目 server 失败。",
      },
      { status: 400 },
    );
  }
}
