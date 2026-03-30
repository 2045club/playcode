import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DirectoryEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  isSymbolicLink: boolean;
};

function parseShowHiddenEntries(input?: string | null) {
  const normalizedValue = input?.trim().toLowerCase() ?? "";
  return normalizedValue === "1" || normalizedValue === "true";
}

function normalizeDirectoryPath(input?: string | null) {
  const rawPath = input?.trim() ?? "";
  const homePath = os.homedir();

  if (!rawPath) {
    return path.resolve(homePath);
  }

  if (rawPath === "~") {
    return homePath;
  }

  if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
    return path.resolve(homePath, /* turbopackIgnore: true */ rawPath.slice(2));
  }

  return path.resolve(/* turbopackIgnore: true */ rawPath);
}

function getRootLabel(rootPath: string) {
  const normalizedRootPath = rootPath.replace(/[\\/]+$/g, "");
  return normalizedRootPath || path.sep;
}

function buildBreadcrumbs(currentPath: string) {
  const rootPath = path.parse(currentPath).root;
  const relativePath = currentPath.slice(rootPath.length);
  const segments = relativePath.split(path.sep).filter(Boolean);
  const breadcrumbs = [
    {
      name: getRootLabel(rootPath),
      path: rootPath,
    },
  ];
  let partialPath = rootPath;

  for (const segment of segments) {
    partialPath = path.join(partialPath, segment);
    breadcrumbs.push({
      name: segment,
      path: partialPath,
    });
  }

  return breadcrumbs;
}

async function listEntries(
  currentPath: string,
  options?: {
    showHiddenEntries?: boolean;
  },
) {
  const entries = await fs.readdir(currentPath, {
    withFileTypes: true,
  });
  const resolvedEntries: DirectoryEntry[] = [];
  const showHiddenEntries = options?.showHiddenEntries ?? false;

  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") {
      continue;
    }

    const entryPath = path.join(
      /* turbopackIgnore: true */ currentPath,
      entry.name,
    );
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (!isDirectory && !isFile && entry.isSymbolicLink()) {
      try {
        const entryStats = await fs.stat(entryPath);
        isDirectory = entryStats.isDirectory();
        isFile = entryStats.isFile();
      } catch {
        isDirectory = false;
        isFile = false;
      }
    }

    if (!isDirectory && !isFile) {
      continue;
    }

    if (!showHiddenEntries && isDirectory && entry.name.startsWith(".")) {
      continue;
    }

    resolvedEntries.push({
      name: entry.name,
      path: entryPath,
      kind: isDirectory ? "directory" : "file",
      isSymbolicLink: entry.isSymbolicLink(),
    });
  }

  resolvedEntries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name, "zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });

  return resolvedEntries;
}

export async function GET(request: NextRequest) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const requestedPath = request.nextUrl.searchParams.get("path");
  const showHiddenEntries = parseShowHiddenEntries(
    request.nextUrl.searchParams.get("showHidden"),
  );
  const currentPath = normalizeDirectoryPath(requestedPath);
  const homePath = os.homedir();
  const rootPath = path.parse(currentPath).root;

  try {
    const directoryStats = await fs.stat(currentPath);

    if (!directoryStats.isDirectory()) {
      throw new Error("当前路径不是目录。");
    }

    const entries = await listEntries(currentPath, {
      showHiddenEntries,
    });

    return NextResponse.json({
      ok: true,
      currentPath,
      parentPath: currentPath === rootPath ? null : path.dirname(currentPath),
      homePath,
      rootPath,
      breadcrumbs: buildBreadcrumbs(currentPath),
      entries,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "读取目录内容失败，请重试。",
      },
      { status: 400 },
    );
  }
}
