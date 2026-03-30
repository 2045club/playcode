import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import { getProjectGitInfo } from "@/lib/server/project-git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeProjectId(input: string | null) {
  if (!input) {
    return null;
  }

  const projectId = Number(input);

  return Number.isInteger(projectId) && projectId > 0 ? projectId : null;
}

export async function GET(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const projectId = normalizeProjectId(
    new URL(request.url).searchParams.get("projectId"),
  );

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
    const project = getProject(projectId);

    if (!project) {
      throw new Error("项目不存在。");
    }

    const git = await getProjectGitInfo(project.path);

    return NextResponse.json({
      ok: true,
      git,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "读取 Git 信息失败。",
      },
      { status: 400 },
    );
  }
}
