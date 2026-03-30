"use client";

import { useEffect, useState } from "react";
import { GitBranch, GitFork, LoaderCircle } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { ProjectGitInfo } from "@/lib/project-git";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type ProjectGitInfoResponse = {
  ok: boolean;
  error?: string;
  git?: ProjectGitInfo;
};

export function ProjectGitInfoCard({ projectId }: { projectId: number }) {
  const { t, translateError } = useLocale();
  const [gitInfo, setGitInfo] = useState<ProjectGitInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadProjectGitInfo() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch(`/api/project-git?projectId=${projectId}`, {
          signal: abortController.signal,
        });
        const payload =
          (await response.json().catch(() => ({}))) as ProjectGitInfoResponse;

        if (!response.ok || !payload.ok || !payload.git) {
          throw new Error(
            translateError(
              payload.error ||
                t("读取 Git 信息失败。", "Failed to load Git information."),
            ),
          );
        }

        if (abortController.signal.aborted) {
          return;
        }

        setGitInfo(payload.git);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setGitInfo(null);
        setErrorMessage(
          error instanceof Error
            ? translateError(error.message)
            : t("读取 Git 信息失败。", "Failed to load Git information."),
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadProjectGitInfo();

    return () => {
      abortController.abort();
    };
  }, [projectId, t, translateError]);

  const statusMessage = isLoading
    ? t("正在读取...", "Loading...")
    : errorMessage
      ? errorMessage
      : gitInfo?.isRepository
        ? null
        : t(
            "当前项目目录不是 Git 仓库。",
            "The current project directory is not a Git repository.",
          );
  const resolvedGitInfo = statusMessage ? null : gitInfo;

  return (
    <>
      <GitInfoMiniCard
        title={t("远端地址", "Remote URL")}
        icon={<GitFork className="size-3.5" />}
        contentClassName="break-all font-mono text-[12px] leading-6 text-foreground"
      >
        {statusMessage ? (
          <GitInfoStatusMessage isLoading={isLoading} message={statusMessage} />
        ) : (
          <>
            <div>
              {resolvedGitInfo?.primaryRemote?.url ||
                t("未配置远端仓库地址", "No remote repository URL configured")}
            </div>
            {resolvedGitInfo?.primaryRemote?.name ? (
              <div className="mt-2 text-[11px] leading-5 text-[#8b8b85]">
                {t("远端名：", "Remote name:")}
                {resolvedGitInfo.primaryRemote.name}
              </div>
            ) : null}
          </>
        )}
      </GitInfoMiniCard>

      <GitInfoMiniCard
        title={t("当前分支", "Current Branch")}
        icon={<GitBranch className="size-3.5" />}
      >
        {statusMessage ? (
          <GitInfoStatusMessage isLoading={isLoading} message={statusMessage} />
        ) : (
          <div className="space-y-2">
            <Badge
              variant="outline"
              className="rounded-full bg-white/90 px-3 py-1"
            >
              <GitBranch className="mr-1 size-3.5" />
              {resolvedGitInfo?.isDetachedHead
                ? "Detached HEAD"
                : resolvedGitInfo?.currentBranch ?? t("未知分支", "Unknown Branch")}
            </Badge>
            {resolvedGitInfo?.head ? (
              <div className="font-mono text-[12px] leading-5 text-[#7d7d77]">
                HEAD: {resolvedGitInfo.head}
              </div>
            ) : null}
          </div>
        )}
      </GitInfoMiniCard>

      <GitInfoMiniCard
        title={t("本地分支列表", "Local Branches")}
        metaText={
          statusMessage ? null : String(resolvedGitInfo?.localBranches.length ?? 0)
        }
      >
        {statusMessage ? (
          <GitInfoStatusMessage isLoading={isLoading} message={statusMessage} />
        ) : (resolvedGitInfo?.localBranches.length ?? 0) > 0 ? (
          <ScrollArea className="max-h-28 pr-2">
            <div className="flex flex-wrap gap-2">
              {resolvedGitInfo?.localBranches.map((branch) => (
                <Badge
                  key={branch.name}
                  variant="outline"
                  className={cn(
                    "rounded-full bg-white/90 px-3 py-1 font-mono text-[11px]",
                    branch.isCurrent && "border-black/20 bg-black text-white",
                  )}
                >
                  {branch.name}
                </Badge>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-sm leading-6 text-muted-foreground">
            {t(
              "当前仓库没有读取到本地分支。",
              "No local branches were found in the current repository.",
            )}
          </div>
        )}
      </GitInfoMiniCard>
    </>
  );
}

function GitInfoMiniCard({
  title,
  icon,
  metaText,
  contentClassName,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  metaText?: string | null;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="surface-shadow rounded-[20px] border-black/8 bg-white/96">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.14em] text-[#8b8b85]">
              {icon}
              <span>{title}</span>
            </div>
          </div>
          {metaText ? (
            <div className="shrink-0 text-[11px] leading-5 text-[#8b8b85]">
              {metaText}
            </div>
          ) : null}
        </div>
        <div className={cn("mt-3 text-sm leading-6 text-foreground", contentClassName)}>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function GitInfoStatusMessage({
  isLoading,
  message,
}: {
  isLoading: boolean;
  message: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm leading-6 text-muted-foreground">
      {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : null}
      <span>{message}</span>
    </div>
  );
}
