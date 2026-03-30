import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ProjectGitBranch,
  ProjectGitInfo,
  ProjectGitRemote,
} from "@/lib/project-git";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;

type ExecFileResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export async function getProjectGitInfo(
  projectPath: string,
): Promise<ProjectGitInfo> {
  const resolvedProjectPath = path.resolve(projectPath);

  await assertProjectDirectory(resolvedProjectPath);

  const repositoryRootResult = await runGitCommand(resolvedProjectPath, [
    "rev-parse",
    "--show-toplevel",
  ]);

  if (repositoryRootResult.exitCode !== 0) {
    return {
      isRepository: false,
      isDetachedHead: false,
      currentBranch: null,
      head: null,
      repositoryRoot: null,
      primaryRemote: null,
      localBranches: [],
    };
  }

  const repositoryRoot = repositoryRootResult.stdout.trim() || null;
  const [branchResult, headResult, primaryRemote, localBranches] = await Promise.all([
    runGitCommand(resolvedProjectPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGitCommand(resolvedProjectPath, ["rev-parse", "--short", "HEAD"]),
    readPrimaryRemote(resolvedProjectPath),
    readLocalBranches(resolvedProjectPath),
  ]);

  const currentBranch =
    branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null;
  const head = headResult.exitCode === 0 ? headResult.stdout.trim() || null : null;

  return {
    isRepository: true,
    isDetachedHead: currentBranch === null && head !== null,
    currentBranch,
    head,
    repositoryRoot,
    primaryRemote,
    localBranches: prioritizeCurrentBranch(localBranches, currentBranch),
  };
}

async function assertProjectDirectory(projectPath: string) {
  const projectStats = await fs.stat(projectPath).catch((error) => {
    const fileSystemError = error as NodeJS.ErrnoException;

    if (fileSystemError.code === "ENOENT") {
      throw new Error("当前项目目录不存在。");
    }

    throw error;
  });

  if (!projectStats.isDirectory()) {
    throw new Error("当前项目路径不是目录。");
  }
}

async function readPrimaryRemote(projectPath: string): Promise<ProjectGitRemote | null> {
  const remoteNamesResult = await runGitCommand(projectPath, ["remote"]);

  if (remoteNamesResult.exitCode !== 0) {
    return null;
  }

  const remoteNames = remoteNamesResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (remoteNames.length === 0) {
    return null;
  }

  const preferredRemoteName = remoteNames.includes("origin")
    ? "origin"
    : remoteNames[0];
  const remoteUrlResult = await runGitCommand(projectPath, [
    "remote",
    "get-url",
    preferredRemoteName,
  ]);

  if (remoteUrlResult.exitCode !== 0) {
    return {
      name: preferredRemoteName,
      url: "",
    };
  }

  return {
    name: preferredRemoteName,
    url: redactGitValue(remoteUrlResult.stdout.trim()),
  };
}

async function readLocalBranches(projectPath: string): Promise<ProjectGitBranch[]> {
  const branchResult = await runGitCommand(projectPath, [
    "for-each-ref",
    "--format=%(refname:short)",
    "--sort=refname",
    "refs/heads",
  ]);

  if (branchResult.exitCode !== 0) {
    return [];
  }

  return branchResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      isCurrent: false,
    }));
}

function prioritizeCurrentBranch(
  branches: ProjectGitBranch[],
  currentBranch: string | null,
) {
  return branches
    .map((branch) => ({
      ...branch,
      isCurrent: branch.name === currentBranch,
    }))
    .sort((leftBranch, rightBranch) => {
      if (leftBranch.isCurrent && !rightBranch.isCurrent) {
        return -1;
      }

      if (!leftBranch.isCurrent && rightBranch.isCurrent) {
        return 1;
      }

      return leftBranch.name.localeCompare(rightBranch.name);
    });
}

function redactGitValue(value: string) {
  return redactUrlCredentials(value);
}

function redactUrlCredentials(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue || !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedValue)) {
    return value;
  }

  try {
    const parsedUrl = new URL(trimmedValue);

    if (!parsedUrl.username && !parsedUrl.password) {
      return value;
    }

    parsedUrl.username = parsedUrl.username ? "****" : "";
    parsedUrl.password = parsedUrl.password ? "****" : "";
    return parsedUrl.toString();
  } catch {
    return value;
  }
}

async function runGitCommand(projectPath: string, args: string[]) {
  return runExecFile("git", ["-C", projectPath, ...args]);
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
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string | null;
    };

    if (execError.code === "ENOENT") {
      throw new Error("当前环境未安装 git，无法读取仓库信息。");
    }

    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: typeof execError.code === "number" ? execError.code : null,
    } satisfies ExecFileResult;
  }
}
