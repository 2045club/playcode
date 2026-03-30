"use client";

import { Toaster as Sonner, toast, type ToasterProps } from "sonner";
import { cn } from "@/lib/utils";

function Toaster({ className, toastOptions, ...props }: ToasterProps) {
  return (
    <Sonner
      position="top-center"
      closeButton={false}
      duration={3000}
      className={cn("toaster group", className)}
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast: cn(
            "group rounded-2xl border border-black/10 bg-white text-foreground shadow-[0_18px_40px_-24px_rgba(0,0,0,0.35)]",
            toastOptions?.classNames?.toast,
          ),
          title: cn("text-sm font-medium", toastOptions?.classNames?.title),
          description: cn(
            toastOptions?.classNames?.description,
            "hidden",
          ),
          actionButton: cn(
            "!bg-black !text-white",
            toastOptions?.classNames?.actionButton,
          ),
          cancelButton: cn(
            "!bg-secondary !text-secondary-foreground",
            toastOptions?.classNames?.cancelButton,
          ),
          closeButton: cn(
            "!border-black/10 !bg-white !text-foreground",
            toastOptions?.classNames?.closeButton,
          ),
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
