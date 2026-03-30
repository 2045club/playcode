import { NextResponse } from "next/server";
import { getWorkspacePayload } from "@/lib/db";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const payload = getWorkspacePayload();
  return NextResponse.json(payload);
}
