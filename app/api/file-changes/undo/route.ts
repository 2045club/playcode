import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import { undoProjectFileChanges } from "@/lib/server/git-diff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UndoFileChangesRequestBody = {
  projectId?: number;
  paths?: string[];
};

function normalizeProjectId(input: unknown) {
  return typeof input === "number" && Number.isInteger(input) ? input : null;
}

function normalizePaths(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  const uniquePaths = new Set<string>();

  input.forEach((value) => {
    if (typeof value !== "string") {
      return;
    }

    const trimmedValue = value.trim();

    if (!trimmedValue) {
      return;
    }

    uniquePaths.add(trimmedValue);
  });

  return Array.from(uniquePaths).slice(0, 50);
}

export async function POST(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body =
    (await request.json().catch(() => ({}))) as UndoFileChangesRequestBody;
  const projectId = normalizeProjectId(body.projectId);
  const paths = normalizePaths(body.paths);

  if (projectId === null) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少有效的项目 ID。",
      },
      { status: 400 },
    );
  }

  if (paths.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少需要撤销的文件路径。",
      },
      { status: 400 },
    );
  }

  try {
    const project = getProject(projectId);

    if (!project) {
      throw new Error("项目不存在。");
    }

    await undoProjectFileChanges({
      projectPath: project.path,
      paths,
    });

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "撤销文件变更失败。",
      },
      { status: 400 },
    );
  }
}
