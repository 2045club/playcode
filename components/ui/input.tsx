import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex h-11 w-full rounded-2xl border bg-background px-4 py-2 text-base shadow-sm transition-shadow outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
