"use client";

import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace-shell";

export function WorkspaceRouteShell({
  children,
}: {
  children: ReactNode;
}) {
  void children;

  return <WorkspaceShell currentPage="projects" />;
}
