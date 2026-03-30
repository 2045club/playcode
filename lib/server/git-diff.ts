import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_DIFF_PREVIEW_CHARS = 50_000;

export type ProjectFileChangePreview = {
  path: string;
  addedLines: number;
  removedLines: number;
  diff: string | null;
  error: string | null;
};

type ExecFileResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export async function getProjectFileChangePreviews({
  projectPath,
  paths,
}: {
  projectPath: string;
  paths: string[];
}): Promise<ProjectFileChangePreview[]> {
  const resolvedProjectPath = path.resolve(projectPath);
  const isGitRepository = await checkGitRepository(resolvedProjectPath);

  return Promise.all(
    paths.map(async (relativePath) => {
      const normalizedPath = relativePath.trim();
      const resolvedFilePath = path.resolve(resolvedProjectPath, normalizedPath);

      if (!normalizedPath) {
        return createUnavailablePreview("", "文件路径无效。");
      }

      if (!isPathInsideDirectory(resolvedProjectPath, resolvedFilePath)) {
        return createUnavailablePreview(normalizedPath, "文件路径超出项目目录。");
      }

      if (!isGitRepository) {
        return createUnavailablePreview(
          normalizedPath,
          "当前项目不是 Git 仓库，暂时无法展示代码 diff。",
        );
      }

      const diffResult = await readGitDiff(resolvedProjectPath, normalizedPath);

      if (diffResult.stdout.trim()) {
        return buildPreviewFromDiff(normalizedPath, diffResult.stdout);
      }

      if (!(await isUntrackedFile(resolvedProjectPath, normalizedPath))) {
        return createUnavailablePreview(
          normalizedPath,
          diffResult.stderr.trim() || "当前没有可展示的 Git diff。",
        );
      }

      return buildUntrackedFilePreview({
        projectPath: resolvedProjectPath,
        relativePath: normalizedPath,
      });
    }),
  );
}

export async function undoProjectFileChanges({
  projectPath,
  paths,
}: {
  projectPath: string;
  paths: string[];
}) {
  const resolvedProjectPath = path.resolve(projectPath);
  const isGitRepository = await checkGitRepository(resolvedProjectPath);

  if (!isGitRepository) {
    throw new Error("当前项目不是 Git 仓库，暂时无法撤销代码变更。");
  }

  const normalizedPaths = Array.from(
    new Set(
      paths
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  const trackedPaths: string[] = [];
  const untrackedPaths: string[] = [];

  for (const relativePath of normalizedPaths) {
    const resolvedFilePath = path.resolve(resolvedProjectPath, relativePath);

    if (!isPathInsideDirectory(resolvedProjectPath, resolvedFilePath)) {
      throw new Error(`文件路径超出项目目录：${relativePath}`);
    }

    if (await isUntrackedFile(resolvedProjectPath, relativePath)) {
      untrackedPaths.push(relativePath);
      continue;
    }

    if (await isTrackedFile(resolvedProjectPath, relativePath)) {
      trackedPaths.push(relativePath);
    }
  }

  if (trackedPaths.length > 0) {
    const restoreResult = await runExecFile("git", [
      "-C",
      resolvedProjectPath,
      "restore",
      "--worktree",
      "--",
      ...trackedPaths,
    ]);

    if (restoreResult.exitCode !== 0) {
      throw new Error(restoreResult.stderr.trim() || "撤销文件变更失败。");
    }
  }

  await Promise.all(
    untrackedPaths.map(async (relativePath) => {
      const absolutePath = path.resolve(resolvedProjectPath, relativePath);

      await fs.rm(absolutePath, {
        force: true,
        recursive: true,
      });
      await removeEmptyParentDirectories(
        path.dirname(absolutePath),
        resolvedProjectPath,
      );
    }),
  );
}

async function checkGitRepository(projectPath: string) {
  const result = await runExecFile("git", [
    "-C",
    projectPath,
    "rev-parse",
    "--is-inside-work-tree",
  ]);

  return result.exitCode === 0 && result.stdout.trim() === "true";
}

async function readGitDiff(projectPath: string, relativePath: string) {
  return runExecFile("git", [
    "-C",
    projectPath,
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--unified=3",
    "--",
    relativePath,
  ]);
}

async function isUntrackedFile(projectPath: string, relativePath: string) {
  const result = await runExecFile("git", [
    "-C",
    projectPath,
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    relativePath,
  ]);

  if (result.exitCode !== 0) {
    return false;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes(relativePath);
}

async function isTrackedFile(projectPath: string, relativePath: string) {
  const result = await runExecFile("git", [
    "-C",
    projectPath,
    "ls-files",
    "--error-unmatch",
    "--",
    relativePath,
  ]);

  return result.exitCode === 0;
}

async function buildUntrackedFilePreview({
  projectPath,
  relativePath,
}: {
  projectPath: string;
  relativePath: string;
}): Promise<ProjectFileChangePreview> {
  const absolutePath = path.resolve(projectPath, relativePath);

  try {
    const content = await fs.readFile(absolutePath, "utf8");

    if (content.includes("\u0000")) {
      return createUnavailablePreview(relativePath, "二进制文件暂不支持预览。");
    }

    const normalizedContent = content.replace(/\r\n/g, "\n");
    const lines = splitPreservingBlankLines(normalizedContent);
    const diffHeader = [
      `diff --git a/${relativePath} b/${relativePath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${relativePath}`,
      `@@ -0,0 +1,${lines.length} @@`,
    ];
    const diffBody = lines.map((line) => `+${line}`);
    const diff = truncateDiffPreview([...diffHeader, ...diffBody].join("\n"));

    return {
      path: relativePath,
      addedLines: lines.length,
      removedLines: 0,
      diff,
      error: null,
    };
  } catch (error) {
    return createUnavailablePreview(
      relativePath,
      error instanceof Error ? error.message : "无法读取新增文件内容。",
    );
  }
}

function buildPreviewFromDiff(
  relativePath: string,
  diffOutput: string,
): ProjectFileChangePreview {
  const { addedLines, removedLines } = countDiffLines(diffOutput);

  return {
    path: relativePath,
    addedLines,
    removedLines,
    diff: truncateDiffPreview(diffOutput),
    error: null,
  };
}

function countDiffLines(diffOutput: string) {
  return diffOutput.split(/\r?\n/).reduce(
    (counts, line) => {
      if (
        line.startsWith("+++ ") ||
        line.startsWith("--- ") ||
        line.startsWith("@@")
      ) {
        return counts;
      }

      if (line.startsWith("+")) {
        counts.addedLines += 1;
        return counts;
      }

      if (line.startsWith("-")) {
        counts.removedLines += 1;
      }

      return counts;
    },
    {
      addedLines: 0,
      removedLines: 0,
    },
  );
}

function splitPreservingBlankLines(content: string) {
  if (!content) {
    return [];
  }

  const lines = content.split("\n");

  if (content.endsWith("\n")) {
    lines.pop();
  }

  return lines;
}

function truncateDiffPreview(diffOutput: string) {
  if (diffOutput.length <= MAX_DIFF_PREVIEW_CHARS) {
    return diffOutput;
  }

  return `${diffOutput.slice(0, MAX_DIFF_PREVIEW_CHARS)}\n\n... diff 已截断，完整内容过长。`;
}

function createUnavailablePreview(
  pathname: string,
  error: string,
): ProjectFileChangePreview {
  return {
    path: pathname,
    addedLines: 0,
    removedLines: 0,
    diff: null,
    error,
  };
}

function isPathInsideDirectory(parentPath: string, childPath: string) {
  const relativePath = path.relative(parentPath, childPath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function removeEmptyParentDirectories(
  currentDirectory: string,
  stopDirectory: string,
) {
  let nextDirectory = currentDirectory;

  while (
    nextDirectory !== stopDirectory &&
    isPathInsideDirectory(stopDirectory, nextDirectory)
  ) {
    const entries = await fs.readdir(nextDirectory).catch((error) => {
      const fileSystemError = error as NodeJS.ErrnoException;

      if (fileSystemError.code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (entries === null || entries.length > 0) {
      return;
    }

    await fs.rmdir(nextDirectory).catch((error) => {
      const fileSystemError = error as NodeJS.ErrnoException;

      if (
        fileSystemError.code === "ENOENT" ||
        fileSystemError.code === "ENOTEMPTY"
      ) {
        return;
      }

      throw error;
    });
    nextDirectory = path.dirname(nextDirectory);
  }
}

async function runExecFile(command: string, args: string[]) {
  try {
    const result = await execFileAsync(command, args, {
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    } satisfies ExecFileResult;
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number | null;
    };

    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: typeof execError.code === "number" ? execError.code : null,
    } satisfies ExecFileResult;
  }
}
