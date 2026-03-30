import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import { getProjectFileAsset } from "@/lib/server/project-code-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSearchParam(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const rootPath = normalizeSearchParam(request.nextUrl.searchParams.get("root"));
  const filePath = normalizeSearchParam(request.nextUrl.searchParams.get("file"));

  if (!rootPath || !filePath) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少项目根目录或文件路径。",
      },
      { status: 400 },
    );
  }

  try {
    const asset = await getProjectFileAsset({
      rootPath,
      filePath,
    });
    const buffer = await fs.readFile(asset.filePath);

    return new NextResponse(buffer, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
          path.basename(asset.filePath),
        )}`,
        "Content-Length": String(buffer.byteLength),
        "Content-Type": asset.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "读取文件资源失败，请重试。",
      },
      { status: 400 },
    );
  }
}
