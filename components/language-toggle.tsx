"use client";

import { Languages } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

export function LanguageToggle({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { locale, localeCode, t, toggleLocale } = useLocale();

  return (
    <button
      type="button"
      onClick={toggleLocale}
      aria-label={t("切换中英文", "Switch language")}
      title={t("切换中英文", "Switch language")}
      className={cn(
        "inline-flex items-center gap-2 rounded-[10px] text-sm transition-colors",
        compact
          ? "size-10 justify-center text-[#667898] hover:bg-white/88 hover:text-[#21304d]"
          : "h-8 px-2.5 font-medium text-[#5e6775] hover:text-[#111111]",
        className,
      )}
    >
      <Languages className="size-[1rem] shrink-0 stroke-[1.8]" />
      {!compact ? (
        <span className="inline-flex items-center gap-1.5">
          <span className={cn(locale === "zh-CN" && "text-[#111111]")}>中</span>
          <span className="text-[#9aa0aa]">/</span>
          <span className={cn(locale === "en-US" && "text-[#111111]")}>EN</span>
        </span>
      ) : (
        <span className="sr-only">{localeCode}</span>
      )}
    </button>
  );
}
