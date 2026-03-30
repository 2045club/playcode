"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, LoaderCircle, X } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getFileLinkDisplayPath,
  parseFileLink,
} from "@/lib/file-links";
import type { ProjectCodeBrowserFilePayload } from "@/lib/project-code-browser";
import {
  buildProjectCodeAssetUrl,
  isImageProjectCodeBrowserFile,
  isTextProjectCodeBrowserFile,
} from "@/lib/project-code-browser";
import { cn } from "@/lib/utils";

type ProjectCodeBrowserErrorPayload = {
  ok: false;
  error?: string;
};

type ProjectCodeBrowserFileResponse = {
  ok: true;
  mode: "file";
} & ProjectCodeBrowserFilePayload;

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
  const segments = pathname.replace(/[\\/]+$/g, "").split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? pathname;
}

async function parseApiResponse(
  response: Response,
): Promise<ProjectCodeBrowserFileResponse> {
  const payload = (await response.json()) as
    | ProjectCodeBrowserFileResponse
    | ProjectCodeBrowserErrorPayload;

  if (!response.ok || ("ok" in payload && payload.ok === false)) {
    throw new Error(
      "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "读取文件失败，请重试。",
    );
  }

  return payload as ProjectCodeBrowserFileResponse;
}

function formatLocationLabel(
  line: number | null,
  column: number | null,
  t: (zhText: string, enText: string) => string,
) {
  if (!line) {
    return null;
  }

  if (column) {
    return t(
      `定位到第 ${line} 行，第 ${column} 列`,
      `Jump to line ${line}, column ${column}`,
    );
  }

  return t(`定位到第 ${line} 行`, `Jump to line ${line}`);
}

function getPreviewLabel(
  filePayload: ProjectCodeBrowserFilePayload | null,
  t: (zhText: string, enText: string) => string,
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

export function WorkspaceFilePreviewDrawer({
  rootPath,
  href,
  isOpen,
  onClose,
}: {
  rootPath: string;
  href: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t, translateError } = useLocale();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const latestRequestIdRef = useRef(0);
  const [filePayload, setFilePayload] = useState<ProjectCodeBrowserFilePayload | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const parsedLink = useMemo(() => (href ? parseFileLink(href) : null), [href]);
  const filePath = parsedLink?.filePath ?? null;
  const highlightedLine = parsedLink?.line ?? null;
  const highlightedColumn = parsedLink?.column ?? null;
  const textFilePayload = isTextProjectCodeBrowserFile(filePayload) ? filePayload : null;
  const imageAssetUrl = isImageProjectCodeBrowserFile(filePayload)
    ? buildProjectCodeAssetUrl(filePayload.rootPath, filePayload.filePath)
    : null;
  const codeLines = useMemo(
    () => textFilePayload?.content.split("\n") ?? [],
    [textFilePayload],
  );
  const locationLabel = textFilePayload
    ? formatLocationLabel(highlightedLine, highlightedColumn, t)
    : null;
  const drawerTitle =
    filePayload?.relativePath ||
    (filePath ? getPathLabel(filePath) : t("文件预览", "File Preview"));
  const drawerPath = filePayload?.filePath ?? filePath ?? "";

  useEffect(() => {
    if (!isOpen || !rootPath || !filePath) {
      setFilePayload(null);
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    setFilePayload((currentPayload) =>
      currentPayload?.filePath === filePath ? currentPayload : null,
    );
    setErrorMessage(null);
    setIsLoading(true);

    void (async () => {
      try {
        const searchParams = new URLSearchParams({
          root: rootPath,
          file: filePath,
        });
        const response = await fetch(`/api/project-code?${searchParams.toString()}`, {
          cache: "no-store",
        });
        const payload = await parseApiResponse(response);

        if (latestRequestIdRef.current !== requestId) {
          return;
        }

        setFilePayload(payload);
      } catch (error) {
        if (latestRequestIdRef.current !== requestId) {
          return;
        }

        setFilePayload(null);
        setErrorMessage(
          error instanceof Error
            ? translateError(error.message)
            : t("读取文件失败，请重试。", "Failed to read the file. Please try again."),
        );
      } finally {
        if (latestRequestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    })();
  }, [filePath, isOpen, rootPath, t, translateError]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !highlightedLine || !textFilePayload) {
      return;
    }

    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    window.requestAnimationFrame(() => {
      const target = viewport.querySelector<HTMLElement>(
        `[data-file-preview-line="${highlightedLine}"]`,
      );

      if (!target) {
        return;
      }

      target.scrollIntoView({
        block: "center",
        inline: "nearest",
      });
    });
  }, [highlightedLine, isOpen, textFilePayload]);

  if (!isOpen || !parsedLink) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label={t("关闭文件预览抽屉", "Close file preview drawer")}
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${t("文件预览", "File Preview")}: ${getFileLinkDisplayPath(parsedLink.originalHref)}`}
        className="absolute inset-y-0 right-0 flex w-full max-w-[44rem] flex-col overflow-hidden border-l border-white/10 bg-[#0f172a] text-slate-100 shadow-[0_24px_60px_rgba(15,23,42,0.3)]"
      >
        <div className="border-b border-white/10 px-4 py-4 md:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-[0.18em] text-slate-500">
                FILE PREVIEW
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm font-medium text-white">
                <FileCode2 className="size-4 shrink-0 text-[#78a6e3]" />
                <span className="truncate">{drawerTitle}</span>
              </div>
              <div className="mt-1 break-all text-[12px] text-slate-400">
                {drawerPath}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-400">
                <span>
                  {filePayload
                    ? `${t("大小", "Size")} ${formatByteSize(filePayload.size)}`
                    : isLoading
                      ? t("正在准备文件预览", "Preparing file preview")
                      : t("等待加载文件内容", "Waiting to load file contents")}
                </span>
                {textFilePayload ? (
                  <span>{t(`${textFilePayload.lineCount} 行`, `${textFilePayload.lineCount} lines`)}</span>
                ) : null}
                {filePayload ? <span>{getPreviewLabel(filePayload, t)}</span> : null}
                {filePayload?.mimeType ? <span>{filePayload.mimeType}</span> : null}
                {locationLabel ? <span>{locationLabel}</span> : null}
                {textFilePayload?.isTruncated ? (
                  <span>
                    {t(
                      "已截断显示，避免一次加载过大文件",
                      "Preview truncated to avoid loading an oversized file at once",
                    )}
                  </span>
                ) : null}
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-full border border-white/10 text-slate-300 hover:bg-white/5 hover:text-white"
              onClick={onClose}
            >
              <span className="sr-only">
                {t("关闭文件预览抽屉", "Close file preview drawer")}
              </span>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
          {isLoading && !filePayload ? (
            <div className="flex min-h-full items-center justify-center px-6 text-sm text-slate-400">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {t("正在读取文件内容...", "Loading file contents...")}
            </div>
          ) : errorMessage ? (
            <div className="flex min-h-full items-center justify-center px-6 text-center text-sm leading-6 text-slate-400">
              {errorMessage}
            </div>
          ) : textFilePayload ? (
            <div className="min-w-max p-4">
              <div className="min-w-full font-mono text-[13px] leading-6">
                {codeLines.map((line, index) => {
                  const lineNumber = index + 1;
                  const isHighlighted = highlightedLine === lineNumber;

                  return (
                    <div
                      key={`${textFilePayload.filePath}:${lineNumber}`}
                      className="flex min-w-full"
                    >
                      <div
                        className={cn(
                          "sticky left-0 z-10 w-14 shrink-0 pr-4 text-right shadow-[1px_0_0_0_rgba(255,255,255,0.05)]",
                          isHighlighted
                            ? "bg-[#172033] text-[#f7cc68]"
                            : "bg-[#0f172a] text-slate-500",
                        )}
                      >
                        {lineNumber}
                      </div>
                      <div
                        data-file-preview-line={lineNumber}
                        className={cn(
                          "whitespace-pre text-slate-100",
                          isHighlighted &&
                            "rounded-[6px] bg-[#172033] px-2 shadow-[inset_0_0_0_1px_rgba(247,204,104,0.28)]",
                        )}
                      >
                        {line || " "}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : imageAssetUrl && filePayload ? (
            <div className="flex min-h-full items-center justify-center p-6">
              <div className="w-full rounded-[22px] border border-white/10 bg-[#111827] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                <div className="relative h-[36rem] overflow-hidden rounded-[14px]">
                  <Image
                    src={imageAssetUrl}
                    alt={filePayload.relativePath || getPathLabel(filePayload.filePath)}
                    fill
                    unoptimized
                    sizes="min(44rem, 100vw)"
                    className="object-contain"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center px-6 text-center text-sm leading-6 text-slate-400">
              {t(
                "点击会话中的文件链接后，这里会展示对应的代码内容。",
                "After you click a file link in the session, the related code will be shown here.",
              )}
            </div>
          )}
        </ScrollArea>
      </aside>
    </div>
  );
}
