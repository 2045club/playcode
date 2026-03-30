"use client";

import Link from "next/link";
import {
  CircleDot,
  Code2,
  Folder,
  type LucideIcon,
  Settings2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type WorkspaceNavigationPage = "projects" | "sessions" | "archive";

const primaryNavItems = [
  {
    href: "/",
    label: "项目",
    page: "projects",
    icon: Folder,
  },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  page: WorkspaceNavigationPage;
  icon: LucideIcon;
}>;

function NavItem({
  href,
  label,
  icon: Icon,
  isActive,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "group/nav-item flex h-10 items-center gap-2 rounded-[10px] px-3 text-sm text-[#667898] transition-all duration-200 hover:bg-white/88 hover:text-[#21304d]",
            "lg:size-10 lg:justify-center lg:px-0",
            isActive &&
              "bg-[#070d24] text-white shadow-[0_12px_28px_rgba(7,13,36,0.2)] hover:bg-[#070d24] hover:text-white",
          )}
        >
          <Icon
            className={cn(
              "size-[1rem] shrink-0 stroke-[1.8]",
              !isActive && "transition-transform duration-200 group-hover/nav-item:scale-[1.05]",
            )}
          />
          <span className="lg:hidden">{label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function WorkspaceGlobalNav({
  currentPage,
  isConnected,
  onOpenSettings,
}: {
  currentPage: WorkspaceNavigationPage;
  isConnected: boolean;
  onOpenSettings: () => void;
}) {
  const connectionLabel = isConnected ? "已连接" : "未连接";

  return (
    <TooltipProvider>
      <aside className="border-b border-black/6 bg-[#f5f6fa] lg:border-b-0 lg:border-r lg:border-[#e4e8f0]">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:h-full lg:flex-col lg:px-3 lg:py-5">
          <div className="flex min-w-0 items-center gap-3 lg:flex-col lg:gap-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/"
                  className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-[#070d24] text-white shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-transform hover:scale-[1.02] lg:size-10"
                >
                  <Code2 className="size-[1rem] stroke-[2] lg:size-[1rem]" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">PlayCodex</TooltipContent>
            </Tooltip>

            <div className="hidden h-6 lg:block" />

            <div className="flex min-w-0 items-center gap-2 overflow-x-auto lg:flex-col lg:gap-3 lg:overflow-visible">
              {primaryNavItems.map((item) => (
                <NavItem
                  key={item.page}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  isActive={currentPage === item.page}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 lg:mt-auto lg:flex-col lg:gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  className={cn(
                    "relative flex h-10 items-center gap-2 rounded-[10px] border px-3 text-sm shadow-[0_10px_24px_rgba(15,23,42,0.05)] outline-none lg:size-10 lg:justify-center lg:px-0",
                    isConnected
                      ? "border-black/12 bg-black/[0.04] text-foreground"
                      : "border-[#d6dde8] bg-white/88 text-[#667898]",
                  )}
                  aria-label={`连接状态：${connectionLabel}`}
                >
                  <CircleDot
                    className={cn(
                      "size-[0.9rem] shrink-0 stroke-[1.8]",
                      isConnected && "animate-pulse",
                    )}
                  />
                  <span className="lg:hidden">{connectionLabel}</span>
                  {isConnected ? (
                    <span className="absolute right-1.5 top-1.5 hidden size-1.5 rounded-full bg-black/70 lg:block" />
                  ) : null}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                {`连接状态：${connectionLabel}`}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="flex h-10 items-center gap-2 rounded-[10px] px-3 text-sm text-[#667898] transition-all duration-200 hover:bg-white hover:text-[#21304d] lg:size-10 lg:justify-center lg:px-0"
                  aria-label="打开设置"
                >
                  <Settings2 className="size-[1.05rem] shrink-0 stroke-[1.8]" />
                  <span className="lg:hidden">设置</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">设置</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
