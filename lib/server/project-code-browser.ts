import fs from "node:fs/promises";
import path from "node:path";
import type {
  ProjectCodeBrowserDirectoryPayload,
  ProjectCodeBrowserEntry,
  ProjectCodeBrowserFilePayload,
} from "@/lib/project-code-browser";
import {
  PROJECT_CODE_BROWSER_TEXT_PREVIEW_BYTE_LIMIT,
  PROJECT_CODE_BROWSER_TEXT_PREVIEW_LINE_LIMIT,
} from "@/lib/project-code-browser";

const IGNORED_ENTRY_NAMES = new Set([".git", ".next", "node_modules"]);
const IMAGE_MIME_TYPES_BY_EXTENSION = new Map<string, string>([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function normalizeRequiredPath(input: string, label: string) {
  const trimmedPath = input.trim();

  if (!trimmedPath) {
    throw new Error(`${label}不能为空。`);
  }

  return path.resolve(trimmedPath);
}

function resolveTargetPathWithinRoot(
  rootPath: string,
  input: string,
  label: string,
) {
  const trimmedPath = input.trim();

  if (!trimmedPath) {
    throw new Error(`${label}不能为空。`);
  }

  const resolvedTargetPath = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(rootPath, trimmedPath);

  return ensurePathWithinRoot(rootPath, resolvedTargetPath);
}

function ensurePathWithinRoot(rootPath: string, targetPath: string) {
  const relativePath = path.relative(rootPath, targetPath);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return targetPath;
  }

  throw new Error("目标路径超出项目目录范围。");
}

function toRelativePath(rootPath: string, targetPath: string) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath ? relativePath.split(path.sep).join("/") : "";
}

function getRootDisplayName(rootPath: string) {
  return path.basename(rootPath) || rootPath;
}

function buildBreadcrumbs(
  rootPath: string,
  currentPath: string,
): ProjectCodeBrowserDirectoryPayload["breadcrumbs"] {
  const relativePath = toRelativePath(rootPath, currentPath);
  const segments = relativePath.split("/").filter(Boolean);
  const breadcrumbs = [
    {
      name: getRootDisplayName(rootPath),
      path: rootPath,
      relativePath: "",
    },
  ];
  let partialPath = rootPath;

  for (const segment of segments) {
    partialPath = path.join(partialPath, segment);
    breadcrumbs.push({
      name: segment,
      path: partialPath,
      relativePath: toRelativePath(rootPath, partialPath),
    });
  }

  return breadcrumbs;
}

function compareEntries(left: ProjectCodeBrowserEntry, right: ProjectCodeBrowserEntry) {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }

  return left.name.localeCompare(right.name, "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

async function resolveEntryType(entryPath: string) {
  const stats = await fs.stat(entryPath);

  return {
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
  };
}

function looksLikeBinary(buffer: Buffer) {
  const sampleLength = Math.min(buffer.length, 8000);

  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }

  return false;
}

async function readPreviewBuffer(filePath: string, byteSize: number) {
  const handle = await fs.open(filePath, "r");
  const bytesToRead = Math.min(
    byteSize,
    PROJECT_CODE_BROWSER_TEXT_PREVIEW_BYTE_LIMIT + 1,
  );
  const previewBuffer = Buffer.alloc(bytesToRead);

  try {
    const { bytesRead } = await handle.read(previewBuffer, 0, bytesToRead, 0);
    return previewBuffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readFullTextBuffer(filePath: string) {
  return fs.readFile(filePath);
}

function getMimeTypeForFile(filePath: string) {
  return IMAGE_MIME_TYPES_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) ?? null;
}

async function resolveProjectRootAndFile(options: {
  rootPath: string;
  filePath: string;
}) {
  const rootPath = normalizeRequiredPath(options.rootPath, "项目根目录");
  const filePath = resolveTargetPathWithinRoot(rootPath, options.filePath, "文件路径");
  const [rootStats, fileStats] = await Promise.all([
    fs.stat(rootPath),
    fs.stat(filePath),
  ]);

  if (!rootStats.isDirectory()) {
    throw new Error("项目根目录不存在或不是有效目录。");
  }

  if (!fileStats.isFile()) {
    throw new Error("当前路径不是文件。");
  }

  return {
    rootPath,
    filePath,
    fileStats,
  };
}

function normalizeTextContent(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

async function readTextProjectFileContent(options: {
  filePath: string;
  fileSize: number;
  fullContent: boolean;
}) {
  if (options.fullContent) {
    const fullBuffer = await readFullTextBuffer(options.filePath);

    if (looksLikeBinary(fullBuffer)) {
      throw new Error("当前文件看起来像二进制内容，暂不支持预览。");
    }

    const content = normalizeTextContent(fullBuffer.toString("utf8"));

    return {
      content,
      isTruncated: false,
    };
  }

  const previewBuffer = await readPreviewBuffer(options.filePath, options.fileSize);

  if (looksLikeBinary(previewBuffer)) {
    throw new Error("当前文件看起来像二进制内容，暂不支持预览。");
  }

  let content = normalizeTextContent(previewBuffer.toString("utf8"));
  let isTruncated = options.fileSize > PROJECT_CODE_BROWSER_TEXT_PREVIEW_BYTE_LIMIT;
  const lines = content.split("\n");

  if (lines.length > PROJECT_CODE_BROWSER_TEXT_PREVIEW_LINE_LIMIT) {
    content = lines
      .slice(0, PROJECT_CODE_BROWSER_TEXT_PREVIEW_LINE_LIMIT)
      .join("\n");
    isTruncated = true;
  }

  return {
    content,
    isTruncated,
  };
}

async function writeFileAtomically(
  filePath: string,
  content: string,
  mode: number,
) {
  const tempFilePath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await fs.writeFile(tempFilePath, content, {
      encoding: "utf8",
      mode,
    });
    await fs.rename(tempFilePath, filePath);
    await fs.chmod(filePath, mode);
  } catch (error) {
    try {
      await fs.unlink(tempFilePath);
    } catch {
      // Ignore temp file cleanup failures and surface the original write error.
    }

    throw error;
  }
}

export async function readProjectDirectory(options: {
  rootPath: string;
  currentPath?: string | null;
}): Promise<ProjectCodeBrowserDirectoryPayload> {
  const rootPath = normalizeRequiredPath(options.rootPath, "项目根目录");
  const currentPath = resolveTargetPathWithinRoot(
    rootPath,
    options.currentPath ?? rootPath,
    "当前目录",
  );
  const rootStats = await fs.stat(rootPath);
  const currentStats = await fs.stat(currentPath);

  if (!rootStats.isDirectory()) {
    throw new Error("项目根目录不存在或不是有效目录。");
  }

  if (!currentStats.isDirectory()) {
    throw new Error("当前路径不是目录。");
  }

  const directoryEntries = await fs.readdir(currentPath, {
    withFileTypes: true,
  });
  const entries: ProjectCodeBrowserEntry[] = [];

  for (const entry of directoryEntries) {
    if (IGNORED_ENTRY_NAMES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(currentPath, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (!isDirectory && !isFile && entry.isSymbolicLink()) {
      try {
        const resolvedEntryType = await resolveEntryType(entryPath);
        isDirectory = resolvedEntryType.isDirectory;
        isFile = resolvedEntryType.isFile;
      } catch {
        isDirectory = false;
        isFile = false;
      }
    }

    if (!isDirectory && !isFile) {
      continue;
    }

    entries.push({
      name: entry.name,
      path: entryPath,
      relativePath: toRelativePath(rootPath, entryPath),
      kind: isDirectory ? "directory" : "file",
      isSymbolicLink: entry.isSymbolicLink(),
    });
  }

  entries.sort(compareEntries);

  return {
    rootPath,
    currentPath,
    relativeCurrentPath: toRelativePath(rootPath, currentPath),
    parentPath: currentPath === rootPath ? null : path.dirname(currentPath),
    breadcrumbs: buildBreadcrumbs(rootPath, currentPath),
    entries,
  };
}

export async function readProjectFile(options: {
  rootPath: string;
  filePath: string;
  fullContent?: boolean;
}): Promise<ProjectCodeBrowserFilePayload> {
  const { rootPath, filePath, fileStats } = await resolveProjectRootAndFile(options);
  const mimeType = getMimeTypeForFile(filePath);

  if (mimeType) {
    return {
      rootPath,
      filePath,
      relativePath: toRelativePath(rootPath, filePath),
      size: fileStats.size,
      mimeType,
      previewKind: "image",
      content: null,
      lineCount: null,
      isTruncated: false,
    };
  }

  const { content, isTruncated } = await readTextProjectFileContent({
    filePath,
    fileSize: fileStats.size,
    fullContent: options.fullContent ?? false,
  });

  return {
    rootPath,
    filePath,
    relativePath: toRelativePath(rootPath, filePath),
    size: fileStats.size,
    mimeType,
    previewKind: "text",
    content,
    lineCount: content.split("\n").length,
    isTruncated,
  };
}

export async function writeProjectFile(options: {
  rootPath: string;
  filePath: string;
  content: string;
}) {
  const { rootPath, filePath, fileStats } = await resolveProjectRootAndFile(options);
  const [resolvedRootPath, resolvedFilePath] = await Promise.all([
    fs.realpath(rootPath),
    fs.realpath(filePath),
  ]);

  ensurePathWithinRoot(resolvedRootPath, resolvedFilePath);

  const mode = fileStats.mode & 0o777;
  await writeFileAtomically(resolvedFilePath, options.content, mode);

  return {
    rootPath,
    filePath,
    relativePath: toRelativePath(rootPath, filePath),
    size: Buffer.byteLength(options.content, "utf8"),
    mimeType: getMimeTypeForFile(filePath),
  };
}

export async function getProjectFileAsset(options: {
  rootPath: string;
  filePath: string;
}) {
  const { rootPath, filePath, fileStats } = await resolveProjectRootAndFile(options);
  const mimeType = getMimeTypeForFile(filePath);

  if (!mimeType) {
    throw new Error("当前文件不支持图片预览。");
  }

  return {
    rootPath,
    filePath,
    relativePath: toRelativePath(rootPath, filePath),
    size: fileStats.size,
    mimeType,
  };
}
