import { NextRequest, NextResponse } from "next/server";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import {
  readProjectDirectory,
  readProjectFile,
  writeProjectFile,
} from "@/lib/server/project-code-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSearchParam(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBooleanSearchParam(value?: string | null) {
  const normalizedValue = normalizeSearchParam(value);
  return normalizedValue === "1" || normalizedValue.toLowerCase() === "true";
}

export async function GET(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const rootPath = normalizeSearchParam(request.nextUrl.searchParams.get("root"));
  const currentPath = normalizeSearchParam(request.nextUrl.searchParams.get("path"));
  const filePath = normalizeSearchParam(request.nextUrl.searchParams.get("file"));
  const fullContent = parseBooleanSearchParam(
    request.nextUrl.searchParams.get("full"),
  );

  if (!rootPath) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少项目根目录。",
      },
      { status: 400 },
    );
  }

  try {
    if (filePath) {
      const payload = await readProjectFile({
        rootPath,
        filePath,
        fullContent,
      });

      return NextResponse.json({
        ok: true,
        mode: "file",
        ...payload,
      });
    }

    const payload = await readProjectDirectory({
      rootPath,
      currentPath: currentPath || rootPath,
    });

    return NextResponse.json({
      ok: true,
      mode: "directory",
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "读取项目代码失败，请重试。",
      },
      { status: 400 },
    );
  }
}

type UpdateProjectCodeFileRequestBody = {
  root?: string;
  file?: string;
  content?: string;
};

function normalizeRequestBodyText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json().catch(() => ({}))) as UpdateProjectCodeFileRequestBody;
  const rootPath = normalizeRequestBodyText(body.root);
  const filePath = normalizeRequestBodyText(body.file);
  const content = typeof body.content === "string" ? body.content : null;

  if (!rootPath) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少项目根目录。",
      },
      { status: 400 },
    );
  }

  if (!filePath) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少文件路径。",
      },
      { status: 400 },
    );
  }

  if (content === null) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少文件内容。",
      },
      { status: 400 },
    );
  }

  try {
    await writeProjectFile({
      rootPath,
      filePath,
      content,
    });

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "保存文件失败，请重试。",
      },
      { status: 400 },
    );
  }
}
