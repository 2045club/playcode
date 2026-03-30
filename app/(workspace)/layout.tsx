import type { ReactNode } from "react";
import { WorkspaceRouteShell } from "@/components/workspace-route-shell";
import { ensureAuthenticatedPage } from "@/lib/server/auth";

type WorkspaceLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function WorkspaceLayout({
  children,
}: WorkspaceLayoutProps) {
  await ensureAuthenticatedPage("/");

  return <WorkspaceRouteShell>{children}</WorkspaceRouteShell>;
}
