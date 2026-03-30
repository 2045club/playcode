import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ConfirmDialogProvider } from "@/components/confirm-dialog-provider";
import { LocaleProvider } from "@/components/locale-provider";
import { Toaster } from "@/components/ui/sonner";
import {
  APP_LOCALE_COOKIE_NAME,
  normalizeAppLocale,
} from "@/lib/locale";
import "./globals.css";

export const metadata: Metadata = {
  title: "Playcode Workspace",
  description: "A monochrome project workspace built with Next.js, shadcn/ui, and SQLite.",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function RootLayout({ children }: RootLayoutProps) {
  const cookieStore = await cookies();
  const initialLocale = normalizeAppLocale(
    cookieStore.get(APP_LOCALE_COOKIE_NAME)?.value,
  );

  return (
    <html lang={initialLocale}>
      <body>
        <LocaleProvider initialLocale={initialLocale}>
          <ConfirmDialogProvider>
            {children}
            <Toaster />
          </ConfirmDialogProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
