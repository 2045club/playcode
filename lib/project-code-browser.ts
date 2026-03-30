export type ProjectCodeBrowserEntry = {
  name: string;
  path: string;
  relativePath: string;
  kind: "directory" | "file";
  isSymbolicLink: boolean;
};

export type ProjectCodeBrowserBreadcrumb = {
  name: string;
  path: string;
  relativePath: string;
};

export type ProjectCodeBrowserDirectoryPayload = {
  rootPath: string;
  currentPath: string;
  relativeCurrentPath: string;
  parentPath: string | null;
  breadcrumbs: ProjectCodeBrowserBreadcrumb[];
  entries: ProjectCodeBrowserEntry[];
};

type ProjectCodeBrowserBaseFilePayload = {
  rootPath: string;
  filePath: string;
  relativePath: string;
  size: number;
  mimeType: string | null;
};

export type ProjectCodeBrowserTextFilePayload =
  ProjectCodeBrowserBaseFilePayload & {
    previewKind: "text";
    content: string;
    lineCount: number;
    isTruncated: boolean;
  };

export type ProjectCodeBrowserImageFilePayload =
  ProjectCodeBrowserBaseFilePayload & {
    previewKind: "image";
    content: null;
    lineCount: null;
    isTruncated: false;
  };

export type ProjectCodeBrowserFilePayload =
  | ProjectCodeBrowserTextFilePayload
  | ProjectCodeBrowserImageFilePayload;

export const PROJECT_CODE_BROWSER_TEXT_PREVIEW_BYTE_LIMIT = 256 * 1024;
export const PROJECT_CODE_BROWSER_TEXT_PREVIEW_LINE_LIMIT = 1600;

export function buildProjectCodeAssetUrl(rootPath: string, filePath: string) {
  const searchParams = new URLSearchParams({
    root: rootPath,
    file: filePath,
  });

  return `/api/project-code/asset?${searchParams.toString()}`;
}

export function buildProjectCodeFileUrl(
  rootPath: string,
  filePath: string,
  options?: {
    fullContent?: boolean;
  },
) {
  const searchParams = new URLSearchParams({
    root: rootPath,
    file: filePath,
  });

  if (options?.fullContent) {
    searchParams.set("full", "1");
  }

  return `/api/project-code?${searchParams.toString()}`;
}

export function buildProjectCodeBrowserTextFilePreviewPayload(
  payload: Pick<
    ProjectCodeBrowserTextFilePayload,
    "rootPath" | "filePath" | "relativePath" | "mimeType"
  > & {
    content: string;
    size: number;
  },
): ProjectCodeBrowserTextFilePayload {
  const normalizedContent = payload.content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const encodedContent = new TextEncoder().encode(normalizedContent);
  let content = normalizedContent;
  let isTruncated =
    encodedContent.byteLength > PROJECT_CODE_BROWSER_TEXT_PREVIEW_BYTE_LIMIT;
  const lines = content.split("\n");

  if (lines.length > PROJECT_CODE_BROWSER_TEXT_PREVIEW_LINE_LIMIT) {
    content = lines.slice(0, PROJECT_CODE_BROWSER_TEXT_PREVIEW_LINE_LIMIT).join("\n");
    isTruncated = true;
  }

  return {
    rootPath: payload.rootPath,
    filePath: payload.filePath,
    relativePath: payload.relativePath,
    size: payload.size,
    mimeType: payload.mimeType,
    previewKind: "text",
    content,
    lineCount: content.split("\n").length,
    isTruncated,
  };
}

export function isTextProjectCodeBrowserFile(
  payload: ProjectCodeBrowserFilePayload | null | undefined,
): payload is ProjectCodeBrowserTextFilePayload {
  return payload?.previewKind === "text";
}

export function isImageProjectCodeBrowserFile(
  payload: ProjectCodeBrowserFilePayload | null | undefined,
): payload is ProjectCodeBrowserImageFilePayload {
  return payload?.previewKind === "image";
}
