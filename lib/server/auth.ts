import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  createAuthUser,
  getAuthJwtSecret,
  getAuthUserById,
  getAuthUserCredentialsByUsername,
  hasAuthUsers,
  type AuthUser,
} from "@/lib/db";

const AUTH_COOKIE_NAME = "playcode_auth";
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 20;
const AUTH_COOKIE_EXPIRES_AT = new Date("2099-12-31T23:59:59.000Z");

type AuthTokenPayload = {
  sub: string;
  username: string;
  type: "session";
  iat: number;
};

type ApiAuthSuccess = {
  ok: true;
  user: AuthUser;
};

type ApiAuthFailure = {
  ok: false;
  response: NextResponse;
};

function encodeBase64Url(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const normalizedValue = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = normalizedValue.length % 4;
  const paddedValue =
    paddingLength === 0
      ? normalizedValue
      : `${normalizedValue}${"=".repeat(4 - paddingLength)}`;

  return Buffer.from(paddedValue, "base64");
}

function createTokenSignature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest();
}

function signAuthToken(payload: AuthTokenPayload) {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = encodeBase64Url(
    createTokenSignature(`${header}.${body}`, getAuthJwtSecret()),
  );

  return `${header}.${body}.${signature}`;
}

function verifyAuthToken(token: string) {
  const segments = token.split(".");

  if (segments.length !== 3) {
    return null;
  }

  const [headerSegment, bodySegment, signatureSegment] = segments;

  try {
    const expectedSignature = createTokenSignature(
      `${headerSegment}.${bodySegment}`,
      getAuthJwtSecret(),
    );
    const providedSignature = decodeBase64Url(signatureSegment);

    if (
      providedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(providedSignature, expectedSignature)
    ) {
      return null;
    }

    const payload = JSON.parse(
      decodeBase64Url(bodySegment).toString("utf8"),
    ) as Partial<AuthTokenPayload>;

    if (
      payload.type !== "session" ||
      typeof payload.sub !== "string" ||
      typeof payload.username !== "string" ||
      typeof payload.iat !== "number"
    ) {
      return null;
    }

    return payload as AuthTokenPayload;
  } catch {
    return null;
  }
}

function getAuthCookieValueFromHeader(cookieHeader: string | null) {
  if (!cookieHeader) {
    return null;
  }

  const cookieKey = `${AUTH_COOKIE_NAME}=`;

  for (const entry of cookieHeader.split(/;\s*/)) {
    if (!entry.startsWith(cookieKey)) {
      continue;
    }

    return decodeURIComponent(entry.slice(cookieKey.length));
  }

  return null;
}

function resolveAuthenticatedUserFromToken(token: string | null) {
  const normalizedToken = token?.trim() ?? "";

  if (!normalizedToken) {
    return null;
  }

  const payload = verifyAuthToken(normalizedToken);

  if (!payload) {
    return null;
  }

  const userId = Number.parseInt(payload.sub, 10);

  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  const user = getAuthUserById(userId);

  if (!user || user.username !== payload.username) {
    return null;
  }

  return user;
}

function buildUnauthorizedResponse(options?: { setupRequired?: boolean }) {
  const setupRequired = options?.setupRequired ?? false;

  return NextResponse.json(
    {
      ok: false,
      code: setupRequired ? "AUTH_SETUP_REQUIRED" : "AUTH_REQUIRED",
      error: setupRequired
        ? "请先初始化管理员账号。"
        : "登录已失效，请重新登录。",
      loginPath: buildLoginPath({
        setup: setupRequired,
      }),
    },
    { status: 401 },
  );
}

export function normalizeAuthUsername(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

export function normalizeAuthPassword(input: unknown) {
  return typeof input === "string" ? input : "";
}

export function normalizeAuthRedirectPath(input: unknown) {
  const rawValue = Array.isArray(input) ? input[0] : input;
  const trimmedValue = typeof rawValue === "string" ? rawValue.trim() : "";

  if (
    !trimmedValue ||
    !trimmedValue.startsWith("/") ||
    trimmedValue.startsWith("//") ||
    trimmedValue.startsWith("/api/") ||
    trimmedValue === "/login"
  ) {
    return "/";
  }

  return trimmedValue;
}

export function buildLoginPath(options?: {
  nextPath?: string;
  setup?: boolean;
}) {
  const searchParams = new URLSearchParams();
  const nextPath = normalizeAuthRedirectPath(options?.nextPath);

  if (options?.setup) {
    searchParams.set("setup", "1");
  }

  if (nextPath !== "/") {
    searchParams.set("next", nextPath);
  }

  const query = searchParams.toString();

  return query ? `/login?${query}` : "/login";
}

export function validateAuthUsername(username: string) {
  if (!username) {
    return "请输入用户名。";
  }

  if (username.length < 3) {
    return "用户名至少需要 3 个字符。";
  }

  if (username.length > 32) {
    return "用户名不能超过 32 个字符。";
  }

  if (/\s/.test(username)) {
    return "用户名不能包含空白字符。";
  }

  return null;
}

export function validateAuthPassword(password: string) {
  if (!password) {
    return "请输入密码。";
  }

  if (password.length < 8) {
    return "密码至少需要 8 个字符。";
  }

  if (password.length > 128) {
    return "密码不能超过 128 个字符。";
  }

  return null;
}

export function createPasswordHashRecord(password: string) {
  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, salt, 64).toString("hex");

  return {
    passwordHash,
    passwordSalt: salt,
  };
}

export function verifyUserPassword(options: {
  password: string;
  passwordHash: string;
  passwordSalt: string;
}) {
  const expectedHash = Buffer.from(options.passwordHash, "hex");
  const candidateHash = Buffer.from(
    scryptSync(options.password, options.passwordSalt, 64).toString("hex"),
    "hex",
  );

  return (
    expectedHash.length === candidateHash.length &&
    timingSafeEqual(expectedHash, candidateHash)
  );
}

export function setAuthenticationCookie(
  response: NextResponse,
  user: Pick<AuthUser, "id" | "username">,
) {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: signAuthToken({
      sub: String(user.id),
      username: user.username,
      type: "session",
      iat: Math.floor(Date.now() / 1000),
    }),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    expires: AUTH_COOKIE_EXPIRES_AT,
  });
}

export function clearAuthenticationCookie(response: NextResponse) {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function getCurrentAuthenticatedUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;

  return resolveAuthenticatedUserFromToken(token);
}

export async function getLoginPageState() {
  const user = await getCurrentAuthenticatedUser();

  return {
    hasUsers: hasAuthUsers(),
    user,
  };
}

export async function ensureAuthenticatedPage(nextPath: string) {
  const user = await getCurrentAuthenticatedUser();

  if (user) {
    return user;
  }

  redirect(
    buildLoginPath({
      nextPath,
      setup: !hasAuthUsers(),
    }),
  );
}

export async function ensureAuthenticatedRequest(
  request: Request,
): Promise<ApiAuthSuccess | ApiAuthFailure> {
  const hasUsers = hasAuthUsers();

  if (!hasUsers) {
    return {
      ok: false,
      response: buildUnauthorizedResponse({
        setupRequired: true,
      }),
    };
  }

  const user = resolveAuthenticatedUserFromToken(
    getAuthCookieValueFromHeader(request.headers.get("cookie")),
  );

  if (!user) {
    return {
      ok: false,
      response: buildUnauthorizedResponse(),
    };
  }

  return {
    ok: true,
    user,
  };
}

export function authenticateByPassword(options: {
  username: string;
  password: string;
}) {
  const user = getAuthUserCredentialsByUsername(options.username);

  if (!user) {
    return null;
  }

  const isValid = verifyUserPassword({
    password: options.password,
    passwordHash: user.passwordHash,
    passwordSalt: user.passwordSalt,
  });

  return isValid ? user : null;
}

export function bootstrapAuthUser(options: {
  username: string;
  password: string;
}) {
  const username = normalizeAuthUsername(options.username);
  const password = normalizeAuthPassword(options.password);
  const usernameError = validateAuthUsername(username);

  if (usernameError) {
    throw new Error(usernameError);
  }

  const passwordError = validateAuthPassword(password);

  if (passwordError) {
    throw new Error(passwordError);
  }

  if (hasAuthUsers()) {
    throw new Error("管理员账号已经初始化，请直接登录。");
  }

  const passwordRecord = createPasswordHashRecord(password);
  const user = createAuthUser({
    username,
    passwordHash: passwordRecord.passwordHash,
    passwordSalt: passwordRecord.passwordSalt,
  });

  if (!user) {
    throw new Error("初始化管理员账号失败。");
  }

  return user;
}
