"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  File,
  Folder,
  Home,
  LoaderCircle,
  RefreshCcw,
  X,
} from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type DirectoryBrowserEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  isSymbolicLink: boolean;
};

type DirectoryBrowserPayload = {
  ok: boolean;
  error?: string;
  currentPath: string;
  parentPath: string | null;
  homePath: string;
  rootPath: string;
  breadcrumbs: Array<{
    name: string;
    path: string;
  }>;
  entries: DirectoryBrowserEntry[];
};

function normalizeComparablePath(pathname?: string | null) {
  return (pathname ?? "").replace(/[\\/]+$/g, "");
}

function pathsMatch(left?: string | null, right?: string | null) {
  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

function getDirectoryTitle(currentPath: string | undefined, fallbackLabel: string) {
  const normalizedPath = currentPath?.trim() ?? "";

  if (!normalizedPath) {
    return fallbackLabel;
  }

  const segments = normalizedPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? normalizedPath;
}

function getColumnPathChain(payload: DirectoryBrowserPayload) {
  const homeIndex = payload.breadcrumbs.findIndex((item) =>
    pathsMatch(item.path, payload.homePath),
  );
  const startIndex = homeIndex >= 0 ? homeIndex : 0;
  const chain = payload.breadcrumbs
    .slice(startIndex)
    .map((item) => item.path)
    .filter(Boolean);

  return chain.length > 0 ? chain : [payload.currentPath];
}

export function ProjectDirectoryPickerModal({
  isOpen,
  isCreatingProject,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  isCreatingProject: boolean;
  onClose: () => void;
  onConfirm: (projectPath: string) => Promise<void>;
}) {
  const { t, translateError } = useLocale();
  const [columns, setColumns] = useState<DirectoryBrowserPayload[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(false);
  const [showHiddenEntries, setShowHiddenEntries] = useState(false);
  const latestRequestIdRef = useRef(0);
  const directoryCacheRef = useRef(new Map<string, DirectoryBrowserPayload>());
  const columnsViewportRef = useRef<HTMLDivElement | null>(null);
  const showHiddenEntriesRef = useRef(false);

  const activeColumn = columns[columns.length - 1] ?? null;

  useEffect(() => {
    showHiddenEntriesRef.current = showHiddenEntries;
  }, [showHiddenEntries]);

  function getDirectoryCacheKey(
    targetPath?: string,
    options?: {
      showHiddenEntries?: boolean;
    },
  ) {
    const normalizedRequestPath = targetPath?.trim() ?? "__root__";
    const hiddenState = options?.showHiddenEntries ?? showHiddenEntriesRef.current;

    return `${hiddenState ? "show-hidden" : "hide-hidden"}:${normalizedRequestPath}`;
  }

  const fetchDirectoryPayload = useCallback(
    async (
      targetPath?: string,
      options?: {
        force?: boolean;
        showHiddenEntries?: boolean;
      },
    ) => {
      const normalizedRequestPath = targetPath?.trim() ?? "";
      const showHiddenEntries =
        options?.showHiddenEntries ?? showHiddenEntriesRef.current;
      const cacheKey = getDirectoryCacheKey(normalizedRequestPath, {
        showHiddenEntries,
      });
      const cachedPayload =
        !options?.force ? directoryCacheRef.current.get(cacheKey) : null;

      if (cachedPayload) {
        return cachedPayload;
      }

      const searchParams = new URLSearchParams();

      if (normalizedRequestPath) {
        searchParams.set("path", normalizedRequestPath);
      }

      if (showHiddenEntries) {
        searchParams.set("showHidden", "1");
      }

      const response = await fetch(
        `/api/directories${searchParams.toString() ? `?${searchParams.toString()}` : ""}`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as DirectoryBrowserPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(
          translateError(
            payload.error ??
              t(
                "读取目录内容失败，请重试。",
                "Failed to read the directory contents. Please try again.",
              ),
          ),
        );
      }

      directoryCacheRef.current.set(
        getDirectoryCacheKey(payload.currentPath, {
          showHiddenEntries,
        }),
        payload,
      );

      if (
        normalizedRequestPath &&
        !pathsMatch(normalizedRequestPath, payload.currentPath)
      ) {
        directoryCacheRef.current.set(cacheKey, payload);
      }

      return payload;
    },
    [t, translateError],
  );

  const loadBrowser = useCallback(
    async (
      targetPath?: string,
      options?: {
        force?: boolean;
        showHiddenEntries?: boolean;
      },
    ) => {
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      setIsLoadingDirectory(true);
      setErrorMessage(null);

      try {
        const targetPayload = await fetchDirectoryPayload(targetPath, options);
        const columnPaths = getColumnPathChain(targetPayload);
        const nextColumns: DirectoryBrowserPayload[] = [];

        for (const columnPath of columnPaths) {
          if (pathsMatch(columnPath, targetPayload.currentPath)) {
            nextColumns.push(targetPayload);
            continue;
          }

          nextColumns.push(await fetchDirectoryPayload(columnPath, options));
        }

        if (latestRequestIdRef.current !== requestId) {
          return;
        }

        setColumns(nextColumns);
        setPathInput(targetPayload.currentPath);
      } catch (error) {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? translateError(error.message)
            : t(
                "读取目录内容失败，请重试。",
                "Failed to read the directory contents. Please try again.",
              ),
        );
      } finally {
        if (latestRequestIdRef.current === requestId) {
          setIsLoadingDirectory(false);
        }
      }
    },
    [fetchDirectoryPayload, t, translateError],
  );

  useEffect(() => {
    if (!isOpen) {
      latestRequestIdRef.current += 1;
      directoryCacheRef.current.clear();
      setColumns([]);
      setPathInput("");
      setErrorMessage(null);
      setIsLoadingDirectory(false);
      showHiddenEntriesRef.current = false;
      setShowHiddenEntries(false);
      return;
    }

    void loadBrowser();
  }, [isOpen, loadBrowser]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isCreatingProject) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCreatingProject, isOpen, onClose]);

  useEffect(() => {
    const viewport = columnsViewportRef.current;

    if (!viewport || columns.length === 0) {
      return;
    }

    viewport.scrollTo({
      left: viewport.scrollWidth,
      behavior: "smooth",
    });
  }, [columns.length, activeColumn?.currentPath]);

  async function handlePathSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextPath = pathInput.trim();

    if (!nextPath || isLoadingDirectory) {
      return;
    }

    await loadBrowser(nextPath);
  }

  async function handleConfirm() {
    if (!activeColumn || isLoadingDirectory || isCreatingProject) {
      return;
    }

    setErrorMessage(null);

    try {
      await onConfirm(activeColumn.currentPath);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? translateError(error.message)
          : t("新增项目失败，请重试。", "Failed to add the project. Please try again."),
      );
    }
  }

  function handleToggleShowHiddenEntries() {
    const nextShowHiddenEntries = !showHiddenEntries;
    const nextTargetPath =
      !nextShowHiddenEntries && activeColumn
        ? activeColumn.breadcrumbs
            .filter((item, index) => index === 0 || !item.name.startsWith("."))
            .at(-1)?.path
        : activeColumn?.currentPath;

    setShowHiddenEntries(nextShowHiddenEntries);
    showHiddenEntriesRef.current = nextShowHiddenEntries;
    directoryCacheRef.current.clear();

    void loadBrowser(nextTargetPath, {
      force: true,
      showHiddenEntries: nextShowHiddenEntries,
    });
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label={t("关闭目录选择弹层", "Close directory picker")}
        className="absolute inset-0 bg-black/22 backdrop-blur-sm"
        onClick={() => {
          if (!isCreatingProject) {
            onClose();
          }
        }}
      />

      <Card
        role="dialog"
        aria-modal="true"
        aria-label={t("选择项目目录", "Choose project directory")}
        className="surface-shadow relative z-10 flex h-[min(88vh,840px)] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border-white/90 bg-[#f6f6f3]"
      >
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="border-b border-black/6 bg-[#f1f0ec] px-5 py-4 md:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[28px] font-semibold leading-none text-[#41413e]">
                  {t("选择目录", "Choose Directory")}
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-full text-muted-foreground hover:text-foreground"
                onClick={onClose}
                disabled={isCreatingProject}
              >
                <X className="size-5" />
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl border-black/10 bg-white/85 px-3"
                onClick={() => {
                  if (activeColumn?.parentPath) {
                    void loadBrowser(activeColumn.parentPath);
                  }
                }}
                disabled={!activeColumn?.parentPath || isLoadingDirectory}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl border-black/10 bg-white/85 px-3"
                onClick={() => void loadBrowser(activeColumn?.homePath)}
                disabled={!activeColumn?.homePath || isLoadingDirectory}
              >
                <Home className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl border-black/10 bg-white/85 px-3"
                onClick={() =>
                  void loadBrowser(activeColumn?.currentPath, { force: true })
                }
                disabled={!activeColumn?.currentPath || isLoadingDirectory}
              >
                <RefreshCcw className="size-4" />
              </Button>

              <form className="flex min-w-0 flex-1 gap-2" onSubmit={handlePathSubmit}>
                <Input
                  value={pathInput}
                  onChange={(event) => setPathInput(event.target.value)}
                  placeholder={t(
                    "输入本地目录路径，例如 /Users/next/ai",
                    "Enter a local directory path, for example /Users/next/ai",
                  )}
                  autoComplete="off"
                  className="h-10 min-w-0 rounded-xl border-black/10 bg-white text-foreground shadow-none"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="h-10 rounded-xl border-black/10 bg-white px-4"
                  disabled={isLoadingDirectory || !pathInput.trim()}
                >
                  {t("前往", "Go")}
                </Button>
              </form>
              <button
                type="button"
                aria-pressed={showHiddenEntries}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors",
                  showHiddenEntries
                    ? "border-black/12 bg-black/[0.04] text-foreground"
                    : "border-black/10 bg-white/85 text-[#4a4a48] hover:bg-white",
                )}
                onClick={handleToggleShowHiddenEntries}
                disabled={isLoadingDirectory}
              >
                <span
                  className={cn(
                    "size-2.5 rounded-full",
                    showHiddenEntries ? "bg-black/70" : "bg-black/20",
                  )}
                />
                {t("显示隐藏目录", "Show Hidden Directories")}
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col bg-[#fbfbfa]">
            <div
              ref={columnsViewportRef}
              className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
            >
              {columns.length > 0 ? (
                <div className="flex h-full min-w-full items-stretch">
                  {columns.map((column, columnIndex) => (
                    <FinderColumn
                      key={column.currentPath}
                      column={column}
                      selectedEntryPath={columns[columnIndex + 1]?.currentPath ?? null}
                      onOpenDirectory={(entryPath) => {
                        void loadBrowser(entryPath);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-6">
                  <div className="rounded-[28px] border border-dashed border-black/10 bg-white/75 px-8 py-10 text-center">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#f4f3ef] text-[#4a4a48]">
                      <LoaderCircle className="size-5 animate-spin" />
                    </div>
                    <div className="mt-4 text-sm font-medium text-foreground">
                      {t("正在准备列视图", "Preparing the column view")}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t(
                        "稍等一下，目录内容马上就会出现。",
                        "Please wait a moment. The directory contents will appear shortly.",
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-black/6 bg-white/92 px-5 py-4 md:px-6">
            {errorMessage ? (
              <p className="text-sm text-destructive">{errorMessage}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div
                title={activeColumn?.currentPath ?? ""}
                className="min-w-0 max-w-[min(100%,28rem)] truncate text-sm text-muted-foreground"
              >
                {t("已选择目录", "Selected Directory")} {activeColumn?.currentPath ?? ""}
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-xl px-5"
                  onClick={onClose}
                  disabled={isCreatingProject}
                >
                  {t("取消", "Cancel")}
                </Button>
                <Button
                  type="button"
                  className="rounded-xl px-5"
                  onClick={() => void handleConfirm()}
                  disabled={!activeColumn || isLoadingDirectory || isCreatingProject}
                >
                  {isCreatingProject ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        {t("添加中...", "Adding...")}
                      </>
                    ) : (
                      t("添加到项目", "Add to Project")
                    )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FinderColumn({
  column,
  selectedEntryPath,
  onOpenDirectory,
}: {
  column: DirectoryBrowserPayload;
  selectedEntryPath: string | null;
  onOpenDirectory: (entryPath: string) => void;
}) {
  const { t } = useLocale();
  const entryCountLabel =
    column.entries.length === 0
      ? t("空文件夹", "Empty Folder")
      : t(`${column.entries.length} 项`, `${column.entries.length} items`);

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-r border-black/6 bg-white/92">
      <div className="border-b border-black/6 px-4 py-3">
        <div className="truncate text-sm font-medium text-foreground">
          {getDirectoryTitle(column.currentPath, t("选择项目目录", "Choose Project Directory"))}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{entryCountLabel}</div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {column.entries.length > 0 ? (
            column.entries.map((entry) => (
              <FinderEntryRow
                key={entry.path}
                entry={entry}
                isSelected={pathsMatch(selectedEntryPath, entry.path)}
                onOpenDirectory={onOpenDirectory}
              />
            ))
          ) : (
            <div className="px-3 py-6 text-center">
              <div className="text-sm font-medium text-foreground">
                {t("这个文件夹是空的", "This folder is empty")}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t(
                  "可以直接把当前目录添加为项目。",
                  "You can add the current directory as a project directly.",
                )}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function FinderEntryRow({
  entry,
  isSelected,
  onOpenDirectory,
}: {
  entry: DirectoryBrowserEntry;
  isSelected: boolean;
  onOpenDirectory: (entryPath: string) => void;
}) {
  const isDirectory = entry.kind === "directory";

  if (!isDirectory) {
    return (
      <div className="flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[#4a4a48]">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#f4f3ef] text-[#85857f]">
            <File className="size-3.5" />
          </div>
          <div className="min-w-0 max-w-[176px]">
            <div
              title={entry.name}
              className="truncate text-sm font-medium text-[#4a4a48]"
            >
              {entry.name}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors",
        isSelected
          ? "bg-[#0a67d8] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
          : "text-[#3f3f3b] hover:bg-[#f2f1ed]",
      )}
      onClick={() => onOpenDirectory(entry.path)}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            isSelected ? "bg-white/18 text-white" : "bg-[#eef4fb] text-[#2075d9]",
          )}
        >
          <Folder className="size-3.5" />
        </div>
        <div className="min-w-0 max-w-[168px]">
          <div title={entry.name} className="truncate text-sm font-medium">
            {entry.name}
          </div>
        </div>
      </div>
      <ChevronRight
        className={cn("size-3.5 shrink-0", isSelected ? "text-white" : "text-[#8f8f89]")}
      />
    </button>
  );
}
