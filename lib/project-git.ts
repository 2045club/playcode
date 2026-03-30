export type ProjectGitRemote = {
  name: string;
  url: string;
};

export type ProjectGitBranch = {
  name: string;
  isCurrent: boolean;
};

export type ProjectGitInfo = {
  isRepository: boolean;
  isDetachedHead: boolean;
  currentBranch: string | null;
  head: string | null;
  repositoryRoot: string | null;
  primaryRemote: ProjectGitRemote | null;
  localBranches: ProjectGitBranch[];
};
