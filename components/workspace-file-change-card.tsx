"use client";

import { ChevronDown, LoaderCircle, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import type { WorkspaceRunItem } from "@/lib/workspace";
import { cn } from "@/lib/utils";

type FileChangeRunItem = Extract<WorkspaceRunItem, { type: "file_change" }>;

type FileChangePreview = {
  path: string;
  addedLines: number;
  removedLines: number;
  diff: string | null;
  error: string | null;
};

type FileChangePreviewPayload = {
  ok: boolean;
  error?: string;
  files?: FileChangePreview[];
};

type UndoFileChangesPayload = {
  ok: boolean;
  error?: string;
};

type ParsedDiffLine = {
  id: string;
  type: "add" | "remove" | "context";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
};

function formatFileChangeKind(
  kind: "add" | "delete" | "update",
  t: (zhText: string, enText: string) => string,
) {
  switch (kind) {
    case "add":
      return t("新增", "Added");
    case "delete":
      return t("删除", "Deleted");
    default:
      return t("更新", "Updated");
  }
}

function getHeaderTitle({
  fileCount,
  status,
  t,
}: {
  fileCount: number;
  status: "completed" | "failed" | "partial";
  t: (zhText: string, enText: string) => string;
}) {
  if (status === "failed") {
    return t(`${fileCount}个文件变更失败`, `${fileCount} file changes failed`);
  }

  if (status === "partial") {
    return t(`${fileCount}个文件已更改`, `${fileCount} files changed`);
  }

  return t(`${fileCount}个文件已更改`, `${fileCount} files changed`);
}

function getChangeAccentClassName(kind: "add" | "delete" | "update") {
  switch (kind) {
    case "add":
      return "bg-[#16a34a]";
    case "delete":
      return "bg-[#dc2626]";
    default:
      return "bg-[#3b82f6]";
  }
}

function buildPreviewMap(files: FileChangePreview[]) {
  return files.reduce<Record<string, FileChangePreview>>((result, file) => {
    result[file.path] = file;
    return result;
  }, {});
}

function parseUnifiedDiff(diff: string) {
  const lines = diff.replace(/\r\n?/g, "\n").split("\n");
  const parsedLines: ParsedDiffLine[] = [];
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let inHunk = false;

  lines.forEach((line, index) => {
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);

    if (hunkMatch) {
      oldLineNumber = Number(hunkMatch[1]);
      newLineNumber = Number(hunkMatch[2]);
      inHunk = true;
      return;
    }

    if (!inHunk || !line || line === "\\ No newline at end of file") {
      return;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      parsedLines.push({
        id: `add-${index}-${newLineNumber}`,
        type: "add",
        oldLineNumber: null,
        newLineNumber,
        content: line.slice(1),
      });
      newLineNumber += 1;
      return;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      parsedLines.push({
        id: `remove-${index}-${oldLineNumber}`,
        type: "remove",
        oldLineNumber,
        newLineNumber: null,
        content: line.slice(1),
      });
      oldLineNumber += 1;
      return;
    }

    if (line.startsWith(" ")) {
      parsedLines.push({
        id: `context-${index}-${oldLineNumber}-${newLineNumber}`,
        type: "context",
        oldLineNumber,
        newLineNumber,
        content: line.slice(1),
      });
      oldLineNumber += 1;
      newLineNumber += 1;
    }
  });

  return parsedLines;
}

const keywordTokens = new Set([
  "import",
  "from",
  "export",
  "const",
  "let",
  "var",
  "function",
  "return",
  "type",
  "interface",
  "extends",
  "implements",
  "if",
  "else",
  "switch",
  "case",
  "default",
  "new",
  "await",
  "async",
  "try",
  "catch",
  "finally",
  "throw",
  "null",
  "true",
  "false",
]);

const typeTokens = new Set([
  "string",
  "number",
  "boolean",
  "unknown",
  "any",
  "void",
  "never",
  "undefined",
]);

const codeTokenRegex =
  /(\/\/.*$|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b[A-Za-z_]\w*\b|\b\d+(?:\.\d+)?\b|[{}[\]();,.<>:=?])/g;

function getCodeTokenClassName(token: string) {
  if (token.startsWith("//")) {
    return "text-[#8a9389]";
  }

  if (
    token.startsWith('"') ||
    token.startsWith("'") ||
    token.startsWith("`")
  ) {
    return "text-[#0a8d2a]";
  }

  if (keywordTokens.has(token)) {
    return "text-[#ef4444]";
  }

  if (typeTokens.has(token)) {
    return "text-[#7c3aed]";
  }

  if (/^\d/.test(token)) {
    return "text-[#0f766e]";
  }

  if (/^[{}[\]();,.<>:=?]$/.test(token)) {
    return "text-[#64645e]";
  }

  return "text-[#b45309]";
}

function renderCodeTokens(content: string) {
  if (!content) {
    return <span>&nbsp;</span>;
  }

  const tokens: Array<{ value: string; className: string }> = [];
  let currentIndex = 0;

  for (const match of content.matchAll(codeTokenRegex)) {
    const token = match[0];
    const start = match.index ?? 0;

    if (start > currentIndex) {
      tokens.push({
        value: content.slice(currentIndex, start),
        className: "text-[#4b4b46]",
      });
    }

    tokens.push({
      value: token,
      className: getCodeTokenClassName(token),
    });

    currentIndex = start + token.length;
  }

  if (currentIndex < content.length) {
    tokens.push({
      value: content.slice(currentIndex),
      className: "text-[#4b4b46]",
    });
  }

  return tokens.map((token, index) => (
    <span key={`${token.value}-${index}`} className={token.className}>
      {token.value}
    </span>
  ));
}

function DiffCodePreview({
  diff,
}: {
  diff: string;
}) {
  const parsedLines = useMemo(() => parseUnifiedDiff(diff), [diff]);

  if (parsedLines.length === 0) {
    return (
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-[#edf3ea] px-4 py-3 font-mono text-[13px] leading-6 text-[#2f2f2b]">
        {diff}
      </pre>
    );
  }

  return (
    <div className="max-h-[32rem] overflow-auto rounded-[8px] border border-[#dce7d8] bg-[#eef5eb]">
      {parsedLines.map((line) => {
        const isAdd = line.type === "add";
        const isRemove = line.type === "remove";

        return (
          <div
            key={line.id}
            className={cn(
              "grid min-w-full grid-cols-[56px_minmax(0,1fr)]",
              isAdd && "bg-[#eef7ea]",
              isRemove && "bg-[#fdf0ee]",
              line.type === "context" && "bg-[#f5f7f2]",
            )}
          >
            <div
              className={cn(
                "border-r border-white/80 px-3 py-0.5 text-right font-mono text-[13px] leading-8 select-none",
                isAdd && "text-[#16a34a]",
                isRemove && "text-[#dc2626]",
                line.type === "context" && "text-[#8c9389]",
              )}
            >
              {line.newLineNumber ?? line.oldLineNumber ?? ""}
            </div>
            <div className="relative overflow-hidden pl-5 pr-4">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-0 left-0 w-[3px]",
                  isAdd && "bg-[#00b341]",
                  isRemove && "bg-[#f87171]",
                  line.type === "context" && "bg-transparent",
                )}
              />
              <code className="block whitespace-pre-wrap break-words font-mono text-[13px] leading-8">
                {renderCodeTokens(line.content)}
              </code>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WorkspaceFileChangeCard({
  items,
  projectId,
  showUndoAction = false,
}: {
  items: FileChangeRunItem[];
  projectId: number | null;
  showUndoAction?: boolean;
}) {
  const { t, translateError } = useLocale();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, FileChangePreview>>({});
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [undoErrorMessage, setUndoErrorMessage] = useState<string | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const mergedItem = useMemo(() => {
    const changesByPath = new Map<
      string,
      FileChangeRunItem["changes"][number]
    >();

    items.forEach((item) => {
      item.changes.forEach((change) => {
        changesByPath.delete(change.path);
        changesByPath.set(change.path, change);
      });
    });

    const hasCompleted = items.some((item) => item.status === "completed");
    const hasFailed = items.some((item) => item.status === "failed");
    const status: "completed" | "failed" | "partial" =
      hasFailed && hasCompleted
        ? "partial"
        : hasFailed
          ? "failed"
          : "completed";

    return {
      id: items.map((item) => item.id).join("-"),
      changes: Array.from(changesByPath.values()),
      status,
    };
  }, [items]);
  const filePathsKey = useMemo(
    () => mergedItem.changes.map((change) => change.path).join("\n"),
    [mergedItem.changes],
  );
  const totals = useMemo(
    () =>
      mergedItem.changes.reduce(
        (result, change) => {
          const preview = previews[change.path];

          if (!preview) {
            return result;
          }

          result.addedLines += preview.addedLines;
          result.removedLines += preview.removedLines;
          return result;
        },
        {
          addedLines: 0,
          removedLines: 0,
        },
      ),
    [mergedItem.changes, previews],
  );
  const canUndo = projectId !== null && mergedItem.changes.length > 0 && !isUndoing;

  useEffect(() => {
    if (projectId === null || mergedItem.changes.length === 0) {
      setPreviews({});
      setLoading(false);
      setErrorMessage(
        projectId === null
          ? t(
              "当前消息没有关联项目，暂时无法读取 diff。",
              "The current message is not linked to a project, so the diff cannot be loaded yet.",
            )
          : null,
      );
      return;
    }

    const abortController = new AbortController();

    async function loadFileChangePreviews() {
      setLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch("/api/file-changes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId,
            paths: mergedItem.changes.map((change) => change.path),
          }),
          signal: abortController.signal,
        });

        const payload =
          (await response.json().catch(() => ({}))) as FileChangePreviewPayload;

        if (!response.ok || !payload.ok || !payload.files) {
          throw new Error(
            translateError(
              payload.error || t("读取文件变更失败。", "Failed to read file changes."),
            ),
          );
        }

        if (abortController.signal.aborted) {
          return;
        }

        setPreviews(buildPreviewMap(payload.files));
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setPreviews({});
        setErrorMessage(
          error instanceof Error
            ? translateError(error.message)
            : t("读取文件变更失败。", "Failed to read file changes."),
        );
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadFileChangePreviews();

    return () => {
      abortController.abort();
    };
  }, [filePathsKey, mergedItem.changes, projectId, t, translateError]);

  async function handleUndo() {
    if (!canUndo) {
      return;
    }

    setIsUndoing(true);
    setUndoErrorMessage(null);

    try {
      const response = await fetch("/api/file-changes/undo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          paths: mergedItem.changes.map((change) => change.path),
        }),
      });
      const payload =
        (await response.json().catch(() => ({}))) as UndoFileChangesPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(
          translateError(
            payload.error || t("撤销文件变更失败。", "Failed to undo file changes."),
          ),
        );
      }

      window.location.reload();
    } catch (error) {
      setUndoErrorMessage(
        error instanceof Error
          ? translateError(error.message)
          : t("撤销文件变更失败。", "Failed to undo file changes."),
      );
      setIsUndoing(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-[8px] border border-black/5 bg-[#ededeb] shadow-[0_1px_0_rgba(255,255,255,0.75)_inset]">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#f5f5f4] px-5 py-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-[#191917]">
          <span className="font-medium tracking-[-0.01em]">
            {getHeaderTitle({
              fileCount: mergedItem.changes.length,
              status: mergedItem.status,
              t,
            })}
          </span>
          {(totals.addedLines > 0 || totals.removedLines > 0) && (
            <span className="inline-flex items-center gap-2 font-medium">
              <span className="text-[#16a34a]">+{totals.addedLines}</span>
              <span className="text-[#dc2626]">-{totals.removedLines}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[13px] leading-5 text-[#7a7a73]">
          <div className="flex items-center gap-2">
            {loading && !isUndoing ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : null}
            {undoErrorMessage ? (
              <span className="text-[#dc2626]">{undoErrorMessage}</span>
            ) : mergedItem.status === "partial" ? (
              <span className="text-[#dc2626]">{t("部分失败", "Partially Failed")}</span>
            ) : mergedItem.status === "failed" ? (
              <span className="text-[#dc2626]">{t("失败", "Failed")}</span>
            ) : null}
          </div>
          {showUndoAction ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-[#191917] transition-colors hover:bg-black/[0.05] disabled:cursor-not-allowed disabled:text-[#a3a39d] disabled:hover:bg-transparent"
              disabled={!canUndo}
              onClick={() => void handleUndo()}
              title={
                projectId === null
                  ? t(
                      "当前消息没有关联项目，无法撤销",
                      "The current message is not linked to a project, so undo is unavailable.",
                    )
                  : undefined
              }
            >
              <span>{t("撤销", "Undo")}</span>
              {isUndoing ? (
                <LoaderCircle className="size-3.5 animate-spin text-[#8f8f89]" />
              ) : (
                <Undo2 className="size-3.5 text-[#8f8f89]" />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div className="border-t border-black/5 bg-[#ececeb]">
        {mergedItem.changes.map((change, index) => {
          const itemKey = `${change.path}-${change.kind}-${index}`;
          const isExpanded = expandedKey === itemKey;
          const preview = previews[change.path];
          const showCounts =
            preview && (preview.addedLines > 0 || preview.removedLines > 0);

          return (
            <div
              key={`${mergedItem.id}-${itemKey}`}
              className={cn(index > 0 && "border-t border-black/6")}
            >
              <button
                type="button"
                aria-expanded={isExpanded}
                className="flex w-full items-center gap-4 px-5 py-1.5 text-left transition-colors hover:bg-black/[0.02]"
                onClick={() =>
                  setExpandedKey((current) => (current === itemKey ? null : itemKey))
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="break-all text-[13px] leading-5 text-[#191917]">
                      {change.path}
                    </span>
                    {showCounts ? (
                      <div className="inline-flex items-center gap-2 text-[13px] font-medium leading-5">
                        <span className="text-[#16a34a]">
                          +{preview.addedLines}
                        </span>
                        <span className="text-[#dc2626]">
                          -{preview.removedLines}
                        </span>
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-2 rounded-full",
                            getChangeAccentClassName(change.kind),
                          )}
                        />
                      </div>
                    ) : (
                      <span className="rounded-full bg-white/75 px-2 py-0.5 text-[13px] leading-5 font-medium text-[#6c6c66]">
                        {formatFileChangeKind(change.kind, t)}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-[#8f8f89] transition-transform",
                    !isExpanded && "-rotate-90",
                  )}
                />
              </button>

              {isExpanded ? (
                <div className="border-t border-black/5 bg-[#eef1eb] px-0 py-0">
                  {loading && !preview ? (
                    <div className="flex items-center gap-2 px-5 py-4 text-[13px] leading-5 text-[#6c6c66]">
                      <LoaderCircle className="size-3.5 animate-spin" />
                      <span>
                        {t("正在读取当前代码 diff...", "Loading the current code diff...")}
                      </span>
                    </div>
                  ) : preview?.diff ? (
                    <DiffCodePreview diff={preview.diff} />
                  ) : (
                    <p className="px-5 py-4 text-[13px] leading-5 text-[#6c6c66]">
                      {preview?.error ??
                        errorMessage ??
                        t("当前没有可展示的 diff。", "There is no diff to display right now.")}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
