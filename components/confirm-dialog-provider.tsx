"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocale } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

type ConfirmDialogOptions = {
  title: string;
  description?: ReactNode;
  cancelText?: string;
  confirmText?: string;
  variant?: "default" | "destructive";
};

type PendingConfirmDialog = {
  title: string;
  description?: ReactNode;
  cancelText: string;
  confirmText: string;
  variant: "default" | "destructive";
};

type ConfirmDialogContextValue = {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
};

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export function ConfirmDialogProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { t } = useLocale();
  const [dialog, setDialog] = useState<PendingConfirmDialog | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const resolveDialog = useCallback((result: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolver?.(result);
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    resolverRef.current?.(false);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        title: options.title,
        description: options.description,
        cancelText: options.cancelText ?? t("取消", "Cancel"),
        confirmText: options.confirmText ?? t("确认", "Confirm"),
        variant: options.variant ?? "default",
      });
    });
  }, [t]);

  useEffect(() => {
    return () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      confirm,
    }),
    [confirm],
  );

  return (
    <ConfirmDialogContext.Provider value={contextValue}>
      {children}
      <AlertDialog
        open={dialog !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            resolveDialog(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle
              className={cn(
                dialog?.variant === "destructive" && "text-destructive",
              )}
            >
              {dialog?.title}
            </AlertDialogTitle>
            {dialog?.description ? (
              <AlertDialogDescription>{dialog.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveDialog(false)}>
              {dialog?.cancelText}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resolveDialog(true)}
              className={cn(
                dialog?.variant === "destructive" &&
                  "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20",
              )}
            >
              {dialog?.confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const context = useContext(ConfirmDialogContext);

  if (!context) {
    throw new Error("useConfirmDialog must be used within ConfirmDialogProvider.");
  }

  return context;
}
