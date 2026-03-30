import { NextRequest, NextResponse } from "next/server";
import { hasAuthUsers } from "@/lib/db";
import {
  authenticateByPassword,
  normalizeAuthPassword,
  normalizeAuthRedirectPath,
  normalizeAuthUsername,
  setAuthenticationCookie,
  validateAuthUsername,
} from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoginRequestBody = {
  username?: string;
  password?: string;
  nextPath?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as LoginRequestBody;
  const username = normalizeAuthUsername(body.username);
  const password = normalizeAuthPassword(body.password);
  const nextPath = normalizeAuthRedirectPath(body.nextPath);

  if (!hasAuthUsers()) {
    return NextResponse.json(
      {
        ok: false,
        error: "当前还没有管理员账号，请先完成初始化。",
      },
      { status: 409 },
    );
  }

  const usernameError = validateAuthUsername(username);

  if (usernameError) {
    return NextResponse.json(
      {
        ok: false,
        error: usernameError,
      },
      { status: 400 },
    );
  }

  if (!password) {
    return NextResponse.json(
      {
        ok: false,
        error: "请输入密码。",
      },
      { status: 400 },
    );
  }

  const user = authenticateByPassword({
    username,
    password,
  });

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: "用户名或密码错误。",
      },
      { status: 401 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    nextPath,
  });

  setAuthenticationCookie(response, user);

  return response;
}
