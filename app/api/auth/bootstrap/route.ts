import { NextRequest, NextResponse } from "next/server";
import {
  bootstrapAuthUser,
  normalizeAuthPassword,
  normalizeAuthRedirectPath,
  normalizeAuthUsername,
  setAuthenticationCookie,
} from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BootstrapRequestBody = {
  username?: string;
  password?: string;
  confirmPassword?: string;
  nextPath?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as BootstrapRequestBody;
  const username = normalizeAuthUsername(body.username);
  const password = normalizeAuthPassword(body.password);
  const confirmPassword = normalizeAuthPassword(body.confirmPassword);
  const nextPath = normalizeAuthRedirectPath(body.nextPath);

  if (password !== confirmPassword) {
    return NextResponse.json(
      {
        ok: false,
        error: "两次输入的密码不一致。",
      },
      { status: 400 },
    );
  }

  try {
    const user = bootstrapAuthUser({
      username,
      password,
    });
    const response = NextResponse.json({
      ok: true,
      nextPath,
    });

    setAuthenticationCookie(response, user);

    return response;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "初始化管理员账号失败。";

    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
      },
      {
        status: errorMessage.includes("已经初始化") ? 409 : 400,
      },
    );
  }
}
