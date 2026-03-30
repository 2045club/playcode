import { NextResponse } from "next/server";
import { clearAuthenticationCookie } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({
    ok: true,
  });

  clearAuthenticationCookie(response);

  return response;
}
