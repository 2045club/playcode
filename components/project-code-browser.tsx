"use client";

import Image from "next/image";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  LoaderCircle,
  RefreshCcw,
  X,
} from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import type {
  ProjectCodeBrowserDirectoryPayload,
  ProjectCodeBrowserEntry,
  ProjectCodeBrowserFilePayload,
  ProjectCodeBrowserTextFilePayload,
} from "@/lib/project-code-browser";
import {
  buildProjectCodeBrowserTextFilePreviewPayload,
  buildProjectCodeAssetUrl,
  buildProjectCodeFileUrl,
  isImageProjectCodeBrowserFile,
  isTextProjectCodeBrowserFile,
} from "@/lib/project-code-browser";
import { cn } from "@/lib/utils";

type ProjectCodeBrowserErrorPayload = {
  ok: false;
  error?: string;
};

type ProjectCodeBrowserDirectoryResponse = {
  ok: true;
  mode: "directory";
} & ProjectCodeBrowserDirectoryPayload;

type ProjectCodeBrowserFileResponse = {
  ok: true;
  mode: "file";
} & ProjectCodeBrowserFilePayload;

type ProjectCodeBrowserSaveResponse = {
  ok: true;
};

type TranslateFn = (zhText: string, enText: string) => string;

function normalizeComparablePath(pathname?: string | null) {
  return (pathname ?? "").replace(/[\\/]+$/g, "");
}

function pathsMatch(left?: string | null, right?: string | null) {
  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

function formatByteSize(byteSize: number) {
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return "0 B";
  }

  if (byteSize < 1024) {
    return `${byteSize} B`;
  }

  if (byteSize < 1024 * 1024) {
    return `${(byteSize / 1024).toFixed(byteSize >= 10 * 1024 ? 0 : 1)} KB`;
  }

  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function getPathLabel(pathname: string) {
  const normalizedPath = normalizeComparablePath(pathname);
  const segments = normalizedPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? normalizedPath;
}

function getPreviewLabel(
  filePayload: ProjectCodeBrowserFilePayload | null,
  t: TranslateFn,
) {
  if (!filePayload) {
    return null;
  }

  if (filePayload.previewKind === "image") {
    return filePayload.mimeType === "image/svg+xml"
      ? t("SVG 预览", "SVG Preview")
      : t("图片预览", "Image Preview");
  }

  return t("文本预览", "Text Preview");
}

async function parseApiResponse<T extends object>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const payload = (await response.json()) as T | ProjectCodeBrowserErrorPayload;

  if (!response.ok || ("ok" in payload && payload.ok === false)) {
    const errorMessage =
      "error" in payload && typeof payload.error === "string"
        ? payload.error
        : fallbackMessage;
    throw new Error(errorMessage);
  }

  return payload as T;
}

async function requestProjectCodeFile(options: {
  rootPath: string;
  filePath: string;
  fullContent?: boolean;
}) {
  const response = await fetch(
    buildProjectCodeFileUrl(options.rootPath, options.filePath, {
      fullContent: options.fullContent,
    }),
    {
      cache: "no-store",
    },
  );

  return parseApiResponse<ProjectCodeBrowserFileResponse>(
    response,
    "读取文件失败，请重试。",
  );
}

export function ProjectCodeBrowser({
  rootPath,
  className,
}: {
  rootPath: string;
  className?: string;
}) {
  const { t, translateError } = useLocale();
  const [directoryPayloadMap, setDirectoryPayloadMap] = useState<
    Record<string, ProjectCodeBrowserDirectoryPayload>
  >({});
  const [expandedDirectoryPaths, setExpandedDirectoryPaths] = useState<string[]>([]);
  const [directoryErrorMap, setDirectoryErrorMap] = useState<Record<string, string>>(
    {},
  );
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<
    Record<string, boolean>
  >({});
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [filePayloadMap, setFilePayloadMap] = useState<
    Record<string, ProjectCodeBrowserFilePayload>
  >({});
  const [fileErrorMap, setFileErrorMap] = useState<Record<string, string>>({});
  const [loadingFilePaths, setLoadingFilePaths] = useState<Record<string, boolean>>(
    {},
  );
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null);
  const [editingDraftContent, setEditingDraftContent] = useState("");
  const [isPreparingEdit, setIsPreparingEdit] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editorErrorMessage, setEditorErrorMessage] = useState<string | null>(null);
  const fileEditorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const latestDirectoryRequestIdsRef = useRef<Record<string, number>>({});
  const latestFileRequestIdsRef = useRef<Record<string, number>>({});

  const loadDirectory = useCallback(
    async (targetPath: string) => {
      const normalizedTargetPath = targetPath.trim() || rootPath;
      const requestId =
        (latestDirectoryRequestIdsRef.current[normalizedTargetPath] ?? 0) + 1;
      latestDirectoryRequestIdsRef.current[normalizedTargetPath] = requestId;
      setLoadingDirectoryPaths((previous) => ({
        ...previous,
        [normalizedTargetPath]: true,
      }));
      setDirectoryErrorMap((previous) => {
        if (!(normalizedTargetPath in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[normalizedTargetPath];
        return next;
      });

      try {
        const searchParams = new URLSearchParams({
          root: rootPath,
          path: normalizedTargetPath,
        });
        const response = await fetch(`/api/project-code?${searchParams.toString()}`, {
          cache: "no-store",
        });
        const payload = await parseApiResponse<ProjectCodeBrowserDirectoryResponse>(
          response,
          "读取目录失败，请重试。",
        );

        if (
          latestDirectoryRequestIdsRef.current[normalizedTargetPath] !== requestId
        ) {
          return;
        }

        setDirectoryPayloadMap((previous) => ({
          ...previous,
          [normalizedTargetPath]: payload,
        }));
      } catch (error) {
        if (
          latestDirectoryRequestIdsRef.current[normalizedTargetPath] !== requestId
        ) {
          return;
        }

        setDirectoryErrorMap((previous) => ({
          ...previous,
          [normalizedTargetPath]:
            error instanceof Error ? error.message : "读取目录失败，请重试。",
        }));
      } finally {
        if (
          latestDirectoryRequestIdsRef.current[normalizedTargetPath] === requestId
        ) {
          setLoadingDirectoryPaths((previous) => {
            if (!(normalizedTargetPath in previous)) {
              return previous;
            }

            const next = { ...previous };
            delete next[normalizedTargetPath];
            return next;
          });
        }
      }
    },
    [rootPath],
  );

  const loadFile = useCallback(
    async (
      filePath: string,
      options?: {
        activate?: boolean;
        fullContent?: boolean;
      },
    ) => {
      const requestId = (latestFileRequestIdsRef.current[filePath] ?? 0) + 1;
      latestFileRequestIdsRef.current[filePath] = requestId;

      if (options?.activate ?? true) {
        setActiveFilePath(filePath);
      }

      setLoadingFilePaths((previous) => ({
        ...previous,
        [filePath]: true,
      }));
      setFileErrorMap((previous) => {
        if (!(filePath in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[filePath];
        return next;
      });

      try {
        const payload = await requestProjectCodeFile({
          rootPath,
          filePath,
          fullContent: options?.fullContent,
        });

        if (latestFileRequestIdsRef.current[filePath] !== requestId) {
          return;
        }

        setFilePayloadMap((previous) => ({
          ...previous,
          [filePath]: payload,
        }));
      } catch (error) {
        if (latestFileRequestIdsRef.current[filePath] !== requestId) {
          return;
        }

        setFileErrorMap((previous) => ({
          ...previous,
          [filePath]:
            error instanceof Error ? error.message : "读取文件失败，请重试。",
        }));
      } finally {
        if (latestFileRequestIdsRef.current[filePath] === requestId) {
          setLoadingFilePaths((previous) => {
            if (!(filePath in previous)) {
              return previous;
            }

            const next = { ...previous };
            delete next[filePath];
            return next;
          });
        }
      }
    },
    [rootPath],
  );

  useEffect(() => {
    latestDirectoryRequestIdsRef.current = {};
    latestFileRequestIdsRef.current = {};
    setDirectoryPayloadMap({});
    setExpandedDirectoryPaths([rootPath]);
    setDirectoryErrorMap({});
    setLoadingDirectoryPaths({});
    setOpenFilePaths([]);
    setActiveFilePath(null);
    setFilePayloadMap({});
    setFileErrorMap({});
    setLoadingFilePaths({});

    void loadDirectory(rootPath);
  }, [loadDirectory, rootPath]);

  const rootDirectoryPayload = directoryPayloadMap[rootPath] ?? null;
  const rootDirectoryError = directoryErrorMap[rootPath] ?? null;
  const rootDirectoryCount =
    rootDirectoryPayload?.entries.filter((entry) => entry.kind === "directory")
      .length ?? 0;
  const rootFileCount =
    (rootDirectoryPayload?.entries.length ?? 0) - rootDirectoryCount;
  const rootLabel =
    rootDirectoryPayload?.breadcrumbs[0]?.name ?? getPathLabel(rootPath);
  const activeFilePayload = activeFilePath ? filePayloadMap[activeFilePath] ?? null : null;
  const activeFileError = activeFilePath ? fileErrorMap[activeFilePath] ?? null : null;
  const isActiveFileLoading = activeFilePath
    ? Boolean(loadingFilePaths[activeFilePath])
    : false;
  const hasLoadingFiles = Object.keys(loadingFilePaths).length > 0;
  const hasOpenFiles = openFilePaths.length > 0;
  const activeTextFilePayload = isTextProjectCodeBrowserFile(activeFilePayload)
    ? activeFilePayload
    : null;
  const activeImageAssetUrl = isImageProjectCodeBrowserFile(activeFilePayload)
    ? buildProjectCodeAssetUrl(
        activeFilePayload.rootPath,
        activeFilePayload.filePath,
      )
    : null;
  const codeLines = useMemo(
    () => activeTextFilePayload?.content.split("\n") ?? [],
    [activeTextFilePayload],
  );
  const isEditingActiveFile =
    editingFilePath !== null && pathsMatch(editingFilePath, activeFilePath);
  const hasUnsavedActiveFileChanges = Boolean(
    isEditingActiveFile &&
      activeTextFilePayload &&
      editingDraftContent !== activeTextFilePayload.content,
  );
  const isActiveFileMutationBusy = isPreparingEdit || isSavingEdit;
  const isActiveFileEditorBusy =
    isPreparingEdit || isSavingEdit || isActiveFileLoading;
  const activeFileEditorValue = isEditingActiveFile ? editingDraftContent : "";

  useEffect(() => {
    if (!isEditingActiveFile) {
      return;
    }

    const textarea = fileEditorTextareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.focus({
      preventScroll: true,
    });
  }, [isEditingActiveFile]);

  useEffect(() => {
    if (!editingFilePath || pathsMatch(editingFilePath, activeFilePath)) {
      return;
    }

    latestFileRequestIdsRef.current[editingFilePath] =
      (latestFileRequestIdsRef.current[editingFilePath] ?? 0) + 1;
    setEditingFilePath(null);
    setEditingDraftContent("");
    setEditorErrorMessage(null);
    setIsPreparingEdit(false);
    setIsSavingEdit(false);
  }, [activeFilePath, editingFilePath]);

  function clearEditorState() {
    if (editingFilePath) {
      latestFileRequestIdsRef.current[editingFilePath] =
        (latestFileRequestIdsRef.current[editingFilePath] ?? 0) + 1;
    }

    setEditingFilePath(null);
    setEditingDraftContent("");
    setEditorErrorMessage(null);
    setIsPreparingEdit(false);
    setIsSavingEdit(false);
  }

  function confirmDiscardEditorChanges() {
    if (!isEditingActiveFile) {
      return true;
    }

    if (!hasUnsavedActiveFileChanges) {
      return true;
    }

    return window.confirm(
      t(
        "当前文件有未保存的修改，确定要放弃吗？",
        "This file has unsaved changes. Discard them?",
      ),
    );
  }

  function getPreviewPayloadFromTextContent(
    textPayload: ProjectCodeBrowserTextFilePayload,
    content: string,
  ) {
    const nextSize = new TextEncoder().encode(content).byteLength;

    return buildProjectCodeBrowserTextFilePreviewPayload({
      rootPath: textPayload.rootPath,
      filePath: textPayload.filePath,
      relativePath: textPayload.relativePath,
      mimeType: textPayload.mimeType,
      size: nextSize,
      content,
    });
  }

  async function handleStartEditor() {
    if (!activeFilePath || !activeTextFilePayload || isActiveFileEditorBusy) {
      return;
    }

    setEditorErrorMessage(null);
    const filePath = activeFilePath;
    const requestId = (latestFileRequestIdsRef.current[filePath] ?? 0) + 1;
    latestFileRequestIdsRef.current[filePath] = requestId;

    if (!activeTextFilePayload.isTruncated) {
      setEditingFilePath(filePath);
      setEditingDraftContent(activeTextFilePayload.content);
      return;
    }

    setIsPreparingEdit(true);

    try {
      const payload = await requestProjectCodeFile({
        rootPath,
        filePath,
        fullContent: true,
      });

      if (
        latestFileRequestIdsRef.current[filePath] !== requestId ||
        !pathsMatch(activeFilePath, filePath) ||
        !isTextProjectCodeBrowserFile(payload)
      ) {
        return;
      }

      setFilePayloadMap((previous) => ({
        ...previous,
        [filePath]: payload,
      }));
      setFileErrorMap((previous) => {
        if (!(filePath in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[filePath];
        return next;
      });
      setEditingFilePath(filePath);
      setEditingDraftContent(payload.content);
    } catch (error) {
      if (latestFileRequestIdsRef.current[filePath] !== requestId) {
        return;
      }

      setEditorErrorMessage(
        error instanceof Error ? error.message : "读取文件失败，请重试。",
      );
      toast.error(
        translateError(
          error instanceof Error ? error.message : "读取文件失败，请重试。",
        ),
      );
    } finally {
      if (latestFileRequestIdsRef.current[filePath] === requestId) {
        setIsPreparingEdit(false);
      }
    }
  }

  function handleCancelEditor() {
    if (!activeTextFilePayload || !isEditingActiveFile) {
      return;
    }

    const filePath = activeTextFilePayload.filePath;
    const previewPayload = getPreviewPayloadFromTextContent(
      activeTextFilePayload,
      activeTextFilePayload.content,
    );

    latestFileRequestIdsRef.current[filePath] =
      (latestFileRequestIdsRef.current[filePath] ?? 0) + 1;

    setFilePayloadMap((previous) => ({
      ...previous,
      [filePath]: previewPayload,
    }));
    setFileErrorMap((previous) => {
      if (!(filePath in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[filePath];
      return next;
    });
    clearEditorState();
  }

  async function handleSaveEditor() {
    if (!activeTextFilePayload || !isEditingActiveFile || isSavingEdit) {
      return;
    }

    const filePath = activeTextFilePayload.filePath;
    const nextContent = editingDraftContent;
    const requestId = (latestFileRequestIdsRef.current[filePath] ?? 0) + 1;
    latestFileRequestIdsRef.current[filePath] = requestId;
    setIsSavingEdit(true);
    setEditorErrorMessage(null);

    try {
      await parseApiResponse<ProjectCodeBrowserSaveResponse>(
        await fetch("/api/project-code", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            root: rootPath,
            file: filePath,
            content: nextContent,
          }),
        }),
        "保存文件失败，请重试。",
      );

      if (latestFileRequestIdsRef.current[filePath] !== requestId) {
        return;
      }

      const previewPayload = getPreviewPayloadFromTextContent(
        activeTextFilePayload,
        nextContent,
      );

      setFilePayloadMap((previous) => ({
        ...previous,
        [filePath]: previewPayload,
      }));
      setFileErrorMap((previous) => {
        if (!(filePath in previous)) {
          return previous;
        }

        const next = { ...previous };
        delete next[filePath];
        return next;
      });
      clearEditorState();
      toast.success(t("文件已保存。", "File saved."));
    } catch (error) {
      if (latestFileRequestIdsRef.current[filePath] !== requestId) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "保存文件失败，请重试。";
      setEditorErrorMessage(message);
      toast.error(translateError(message));
    } finally {
      if (latestFileRequestIdsRef.current[filePath] === requestId) {
        setIsSavingEdit(false);
      }
    }
  }

  function isDirectoryExpanded(directoryPath: string) {
    return expandedDirectoryPaths.some((path) => pathsMatch(path, directoryPath));
  }

  function handleDirectoryToggle(directoryPath: string) {
    const isExpanded = isDirectoryExpanded(directoryPath);

    if (isExpanded) {
      setExpandedDirectoryPaths((previous) =>
        previous.filter((path) => !pathsMatch(path, directoryPath)),
      );
      return;
    }

    setExpandedDirectoryPaths((previous) =>
      previous.some((path) => pathsMatch(path, directoryPath))
        ? previous
        : [...previous, directoryPath],
    );

    if (!directoryPayloadMap[directoryPath] || directoryErrorMap[directoryPath]) {
      void loadDirectory(directoryPath);
    }
  }

  function handleFileOpen(filePath: string) {
    if (isActiveFileMutationBusy) {
      return;
    }

    if (
      !pathsMatch(filePath, activeFilePath) &&
      isEditingActiveFile &&
      !confirmDiscardEditorChanges()
    ) {
      return;
    }

    if (!pathsMatch(filePath, activeFilePath) && isEditingActiveFile) {
      clearEditorState();
    }

    setEditorErrorMessage(null);
    setOpenFilePaths((previous) =>
      previous.some((path) => pathsMatch(path, filePath))
        ? previous
        : [...previous, filePath],
    );
    setActiveFilePath(filePath);

    if (
      (!filePayloadMap[filePath] || fileErrorMap[filePath]) &&
      !loadingFilePaths[filePath]
    ) {
      void loadFile(filePath, { activate: false });
    }
  }

  function handleFileTabClose(filePath: string) {
    if (isActiveFileMutationBusy) {
      return;
    }

    if (
      pathsMatch(filePath, activeFilePath) &&
      isEditingActiveFile &&
      !confirmDiscardEditorChanges()
    ) {
      return;
    }

    if (pathsMatch(filePath, activeFilePath) && isEditingActiveFile) {
      clearEditorState();
    }

    latestFileRequestIdsRef.current[filePath] =
      (latestFileRequestIdsRef.current[filePath] ?? 0) + 1;

    const closingActiveFile = pathsMatch(filePath, activeFilePath);
    const currentIndex = openFilePaths.findIndex((path) =>
      pathsMatch(path, filePath),
    );
    const nextOpenFilePaths = openFilePaths.filter(
      (path) => !pathsMatch(path, filePath),
    );

    setOpenFilePaths(nextOpenFilePaths);
    setFilePayloadMap((previous) => {
      if (!(filePath in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[filePath];
      return next;
    });
    setFileErrorMap((previous) => {
      if (!(filePath in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[filePath];
      return next;
    });
    setLoadingFilePaths((previous) => {
      if (!(filePath in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[filePath];
      return next;
    });

    if (!closingActiveFile) {
      return;
    }

    setEditorErrorMessage(null);
    const nextActiveFilePath =
      nextOpenFilePaths[currentIndex] ??
      nextOpenFilePaths[currentIndex - 1] ??
      null;
    setActiveFilePath(nextActiveFilePath);
  }

  function handleRefresh() {
    if (isActiveFileMutationBusy || isEditingActiveFile) {
      return;
    }

    setEditorErrorMessage(null);
    const directoryPathsToReload = Array.from(
      new Set([rootPath, ...expandedDirectoryPaths]),
    );

    for (const directoryPath of directoryPathsToReload) {
      void loadDirectory(directoryPath);
    }

    for (const filePath of openFilePaths) {
      void loadFile(filePath, { activate: false });
    }
  }

  function renderLoadingRow(depth: number, label: string, key: string) {
    return (
      <div
        key={key}
        className="flex items-center gap-2 px-3 py-2 text-[12px] text-slate-400"
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        <LoaderCircle className="size-3.5 animate-spin" />
        <span>{label}</span>
      </div>
    );
  }

  function renderErrorRow(depth: number, message: string, key: string) {
    return (
      <div
        key={key}
        className="px-3 py-2 text-[12px] leading-5 text-[#d89494]"
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        {message}
      </div>
    );
  }

  function renderEmptyRow(depth: number, key: string) {
    return (
      <div
        key={key}
        className="px-3 py-2 text-[12px] text-slate-500"
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        {t("空文件夹", "Empty folder")}
      </div>
    );
  }

  function renderEntries(
    entries: ProjectCodeBrowserEntry[],
    depth: number,
  ): ReactElement[] {
    return entries.flatMap((entry) => {
      if (entry.kind === "directory") {
        const isExpanded = isDirectoryExpanded(entry.path);
        const directoryPayload = directoryPayloadMap[entry.path] ?? null;
        const isLoadingDirectory = Boolean(loadingDirectoryPaths[entry.path]);
        const directoryErrorMessage = directoryErrorMap[entry.path] ?? null;
        const nodes: ReactElement[] = [
          <button
            key={entry.path}
            type="button"
            onClick={() => handleDirectoryToggle(entry.path)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/5",
              isExpanded && "bg-white/6",
            )}
            style={{ paddingLeft: `${12 + depth * 18}px` }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-slate-500 transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
              <Folder className="size-4 shrink-0 text-[#d1a24f]" />
              <span className="truncate text-slate-200">{entry.name}</span>
            </div>
            {isLoadingDirectory ? (
              <LoaderCircle className="size-3.5 shrink-0 animate-spin text-slate-500" />
            ) : null}
          </button>,
        ];

        if (isExpanded) {
          if (directoryPayload?.entries.length) {
            nodes.push(...renderEntries(directoryPayload.entries, depth + 1));
          } else if (isLoadingDirectory && !directoryPayload) {
            nodes.push(
              renderLoadingRow(
                depth + 1,
                t("正在读取目录...", "Loading directory..."),
                `${entry.path}:loading`,
              ),
            );
          } else if (directoryErrorMessage) {
            nodes.push(
              renderErrorRow(
                depth + 1,
                translateError(directoryErrorMessage),
                `${entry.path}:error`,
              ),
            );
          } else if (directoryPayload && directoryPayload.entries.length === 0) {
            nodes.push(renderEmptyRow(depth + 1, `${entry.path}:empty`));
          }
        }

        return nodes;
      }

      const isSelected = pathsMatch(entry.path, activeFilePath);

      return [
        <button
          key={entry.path}
          type="button"
          onClick={() => {
            handleFileOpen(entry.path);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-[13px] transition-colors",
            isSelected
              ? "bg-white/10 text-white"
              : "text-slate-300 hover:bg-white/5",
          )}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
        >
          <span className="block size-3.5 shrink-0" />
          <FileCode2
            className={cn(
              "size-4 shrink-0",
              isSelected ? "text-white/80" : "text-[#78a6e3]",
            )}
          />
          <span className="truncate">{entry.name}</span>
        </button>,
      ];
    });
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[24px] border border-black/8 bg-[#0f172a] shadow-[0_20px_50px_rgba(15,23,42,0.08)]",
        className,
      )}
    >
      <div className="grid min-h-[34rem] lg:grid-cols-[minmax(220px,0.44fr)_minmax(0,1.56fr)]">
        <div className="border-b border-white/10 bg-[#121a2a] lg:border-r lg:border-b-0">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold tracking-[0.18em] text-slate-500">
                  {t("代码浏览", "Explorer")}
                </div>
                <div className="mt-2 text-sm font-medium text-slate-100">
                  {rootLabel}
                </div>
                <div className="mt-1 truncate text-[12px] text-slate-400">
                  {rootPath}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 hover:text-white"
                onClick={handleRefresh}
                disabled={
                  Object.keys(loadingDirectoryPaths).length > 0 ||
                  hasLoadingFiles ||
                  isEditingActiveFile ||
                  isActiveFileMutationBusy
                }
              >
                <span className="sr-only">
                  {t("刷新代码浏览", "Refresh code browser")}
                </span>
                {Object.keys(loadingDirectoryPaths).length > 0 ||
                hasLoadingFiles ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCcw className="size-4" />
                )}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-400">
              <span>
                {t("文件夹", "Folders")} {rootDirectoryCount}
              </span>
              <span>
                {t("文件", "Files")} {rootFileCount}
              </span>
            </div>
          </div>

          <ScrollArea className="h-[28rem]">
            <div className="p-2">
              {rootDirectoryError && !rootDirectoryPayload ? (
                <div className="rounded-[16px] border border-dashed border-white/10 px-4 py-5 text-sm leading-6 text-slate-400">
                  {translateError(rootDirectoryError)}
                </div>
              ) : null}

              {!rootDirectoryPayload && loadingDirectoryPaths[rootPath] ? (
                <div className="rounded-[16px] border border-dashed border-white/10 px-4 py-5 text-sm leading-6 text-slate-400">
                  {t("正在读取项目目录...", "Loading project directory...")}
                </div>
              ) : null}

              {rootDirectoryPayload ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => handleDirectoryToggle(rootPath)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/5",
                      isDirectoryExpanded(rootPath) && "bg-white/6",
                    )}
                    style={{ paddingLeft: "12px" }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <ChevronRight
                        className={cn(
                          "size-3.5 shrink-0 text-slate-500 transition-transform",
                          isDirectoryExpanded(rootPath) && "rotate-90",
                        )}
                      />
                      <Folder className="size-4 shrink-0 text-[#d1a24f]" />
                      <span className="truncate font-medium text-slate-100">
                        {rootLabel}
                      </span>
                    </div>
                    {loadingDirectoryPaths[rootPath] ? (
                      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-slate-500" />
                    ) : null}
                  </button>

                  {isDirectoryExpanded(rootPath)
                    ? renderEntries(rootDirectoryPayload.entries, 1)
                    : null}
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </div>

        <div className="min-w-0 bg-[#0f172a] text-slate-100">
          <div className="border-b border-white/10">
            <div className="flex overflow-x-auto">
              {hasOpenFiles ? (
                openFilePaths.map((filePath) => {
                  const isActive = pathsMatch(filePath, activeFilePath);
                  const filePayload = filePayloadMap[filePath] ?? null;
                  const fileError = fileErrorMap[filePath] ?? null;
                  const isLoading = Boolean(loadingFilePaths[filePath]);

                  return (
                    <div
                      key={filePath}
                      className={cn(
                        "group flex min-w-0 max-w-[15rem] items-center gap-2 border-r border-white/10 px-2 py-2 text-[13px] transition-colors",
                        isActive
                          ? "bg-[#151d2d] text-white"
                          : "bg-[#111827] text-slate-300 hover:bg-[#151d2d]",
                      )}
                    >
                      <button
                        type="button"
                        title={filePayload?.relativePath ?? filePath}
                        onClick={() => {
                          setActiveFilePath(filePath);

                        if ((!filePayload || fileError) && !isLoading) {
                          void loadFile(filePath, { activate: false });
                        }
                      }}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left"
                      >
                        <FileCode2
                          className={cn(
                            "size-4 shrink-0",
                            isActive ? "text-[#78a6e3]" : "text-slate-500",
                          )}
                        />
                        <span className="truncate">
                          {filePayload?.relativePath
                            ? getPathLabel(filePayload.relativePath)
                            : getPathLabel(filePath)}
                        </span>
                        {isLoading ? (
                          <LoaderCircle className="ml-auto size-3.5 shrink-0 animate-spin text-slate-500" />
                        ) : fileError ? (
                          <span
                            className="ml-auto shrink-0 text-[11px] text-[#d89494]"
                          >
                            !
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-sm p-1 text-slate-500 opacity-0 transition-opacity hover:bg-white/8 hover:text-white group-hover:opacity-100 focus:opacity-100"
                        onClick={() => {
                          handleFileTabClose(filePath);
                        }}
                        title={t("关闭标签", "Close tab")}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="px-4 py-3 text-[13px] text-slate-500">
                  {t("暂无已打开文件", "No open files")}
                </div>
              )}
            </div>
          </div>

          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <FileText className="size-4" />
                  {activeFilePayload?.relativePath ||
                    (activeFilePath
                      ? getPathLabel(activeFilePath)
                      : t("选择一个文件查看代码", "Choose a file to preview"))}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-400">
                  <span>
                    {activeFilePayload
                      ? `${t("大小", "Size")} ${formatByteSize(activeFilePayload.size)}`
                      : activeFilePath
                        ? t("正在准备文件预览", "Preparing file preview")
                        : t("左侧点击文件即可预览", "Click a file on the left to preview")}
                  </span>
                  {activeTextFilePayload ? (
                    <span>
                      {t(
                        `${activeTextFilePayload.lineCount} 行`,
                        `${activeTextFilePayload.lineCount} lines`,
                      )}
                    </span>
                  ) : null}
                  {activeFilePayload ? (
                    <span>{getPreviewLabel(activeFilePayload, t)}</span>
                  ) : null}
                  {activeFilePayload?.mimeType ? (
                    <span>{activeFilePayload.mimeType}</span>
                  ) : null}
                  {activeTextFilePayload?.isTruncated ? (
                    <span>
                      {t(
                        "已截断显示，避免一次加载过大文件",
                        "Preview truncated to avoid loading an oversized file at once",
                      )}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-3 lg:items-end">
                <div className="truncate text-[12px] text-slate-400">
                  {activeFilePayload?.filePath ?? activeFilePath ?? rootPath}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {activeTextFilePayload ? (
                    isEditingActiveFile ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 rounded-lg border border-white/10 px-3 text-slate-300 hover:bg-white/5 hover:text-white"
                          onClick={handleCancelEditor}
                          disabled={isSavingEdit}
                        >
                          {t("取消", "Cancel")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 rounded-lg bg-[#78a6e3] px-3 text-slate-950 hover:bg-[#8bb5eb]"
                          onClick={() => {
                            void handleSaveEditor();
                          }}
                          disabled={
                            isSavingEdit || !hasUnsavedActiveFileChanges
                          }
                        >
                          {isSavingEdit ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : null}
                          {t("保存", "Save")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-8 rounded-lg bg-white/10 px-3 text-slate-100 hover:bg-white/15 hover:text-white"
                        onClick={() => {
                          void handleStartEditor();
                        }}
                        disabled={isActiveFileEditorBusy}
                      >
                        {isPreparingEdit ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : null}
                        {activeTextFilePayload.isTruncated
                          ? t("编辑全文", "Edit full file")
                          : t("编辑", "Edit")}
                      </Button>
                    )
                  ) : null}
                </div>
                {editorErrorMessage ? (
                  <div className="rounded-[14px] border border-[#8d4a4a]/40 bg-[#2a1515] px-3 py-2 text-[12px] leading-5 text-[#f1b0b0]">
                    {translateError(editorErrorMessage)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <ScrollArea className="h-[28rem]">
            {isActiveFileLoading && !activeFilePayload ? (
              <div className="flex h-full min-h-[16rem] items-center justify-center px-6 text-sm text-slate-400">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {t("正在读取文件内容...", "Loading file contents...")}
              </div>
            ) : activeFileError ? (
              <div className="flex h-full min-h-[16rem] items-center justify-center px-6 text-center text-sm leading-6 text-slate-400">
                {translateError(activeFileError)}
              </div>
            ) : isEditingActiveFile && activeTextFilePayload ? (
              <div className="flex min-h-full flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-3 text-[12px] text-slate-400">
                  <span>
                    {hasUnsavedActiveFileChanges
                      ? t("未保存修改", "Unsaved changes")
                      : t("内容已同步", "Content synced")}
                  </span>
                  <span>{t("Ctrl/Cmd + S 保存", "Ctrl/Cmd + S to save")}</span>
                </div>
                <Textarea
                  ref={fileEditorTextareaRef}
                  value={activeFileEditorValue}
                  disabled={isSavingEdit}
                  onChange={(event) => {
                    setEditingDraftContent(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                      event.preventDefault();
                      void handleSaveEditor();
                    }
                  }}
                  spellCheck={false}
                  wrap="off"
                  className="min-h-[24rem] flex-1 resize-none rounded-[18px] border-white/10 bg-[#111827] px-4 py-3 font-mono text-[13px] leading-6 text-slate-100 shadow-none placeholder:text-slate-500 focus-visible:ring-[#78a6e3]/20"
                />
              </div>
            ) : activeTextFilePayload ? (
              <div className="min-w-max p-4">
                <div className="min-w-full font-mono text-[13px] leading-6">
                  {codeLines.map((line, index) => (
                    <div
                      key={`${activeTextFilePayload.filePath}:${index + 1}`}
                      className="flex min-w-full"
                    >
                      <div className="sticky left-0 z-10 w-14 shrink-0 bg-[#0f172a] pr-4 text-right text-slate-500 shadow-[1px_0_0_0_rgba(255,255,255,0.05)]">
                        {index + 1}
                      </div>
                      <div className="whitespace-pre text-slate-100">
                        {line || " "}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : activeImageAssetUrl && activeFilePayload ? (
              <div className="flex h-full min-h-[16rem] items-center justify-center p-6">
                <div className="w-full rounded-[22px] border border-white/10 bg-[#111827] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                  <div className="relative h-[32rem] overflow-hidden rounded-[14px]">
                    <Image
                      src={activeImageAssetUrl}
                      alt={
                        activeFilePayload.relativePath ||
                        getPathLabel(activeFilePayload.filePath)
                      }
                      fill
                      unoptimized
                      sizes="(min-width: 1024px) 60vw, 100vw"
                      className="object-contain"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[16rem] items-center justify-center px-6 text-center text-sm leading-6 text-slate-400">
                {t(
                  "左侧选择文件后，这里会以标签页形式打开代码内容。",
                  "Choose a file on the left to open its contents here in tabs.",
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
