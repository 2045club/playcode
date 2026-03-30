"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { LanguageToggle } from "@/components/language-toggle";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AuthMutationPayload = {
  ok: boolean;
  error?: string;
  nextPath?: string;
};

type LoginFormProps = {
  mode: "login" | "setup";
  nextPath: string;
};

export function LoginForm({ mode, nextPath }: LoginFormProps) {
  const router = useRouter();
  const { t, translateError } = useLocale();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSetupMode = mode === "setup";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setError(null);

    if (isSetupMode && password !== confirmPassword) {
      setError(t("两次输入的密码不一致。", "The two passwords do not match."));
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        isSetupMode ? "/api/auth/bootstrap" : "/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username,
            password,
            confirmPassword,
            nextPath,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({
        ok: false,
      }))) as AuthMutationPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(
          translateError(
            payload.error || t("登录失败，请稍后重试。", "Login failed. Please try again later."),
          ),
        );
      }

      const resolvedNextPath =
        typeof payload.nextPath === "string" && payload.nextPath.startsWith("/")
          ? payload.nextPath
          : nextPath;

      startTransition(() => {
        router.replace(resolvedNextPath);
        router.refresh();
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? translateError(submitError.message)
          : t("登录失败，请稍后重试。", "Login failed. Please try again later."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f6f1e8]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.92),rgba(246,241,232,0.82)_34%,rgba(228,219,203,0.65))]" />
      <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(23,23,23,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(23,23,23,0.035)_1px,transparent_1px)] [background-size:22px_22px]" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-10">
        <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="hidden rounded-[32px] border border-black/8 bg-[linear-gradient(135deg,rgba(18,18,18,0.95),rgba(52,48,43,0.94))] p-10 text-[#f9f5ef] shadow-[0_36px_120px_rgba(40,32,20,0.22)] lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-6">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs tracking-[0.18em] text-white/75 uppercase">
                <ShieldCheck className="size-3.5" />
                {t("工作区访问", "Workspace Access")}
              </div>
              <div className="space-y-4">
                <h1 className="max-w-xl text-4xl font-semibold tracking-[-0.04em]">
                  {isSetupMode
                    ? t("先创建管理员账号，再进入 Playcode。", "Create the admin account before entering Playcode.")
                    : t("完成登录后再进入你的工作台。", "Finish signing in before entering your workspace.")}
                </h1>
                <p className="max-w-lg text-[15px] leading-7 text-white/72">
                  {t(
                    "当前项目已经接入 JWT 鉴权。登录成功后会写入长期有效的安全 Cookie，默认保持登录状态，后续直接进入工作区。",
                    "This project uses JWT authentication. After a successful login, a long-lived secure cookie is written so you stay signed in and can enter the workspace directly later.",
                  )}
                </p>
              </div>
            </div>

            <div className="grid gap-3 text-sm text-white/70">
              <div className="rounded-[20px] border border-white/12 bg-white/6 px-4 py-3">
                {isSetupMode
                  ? t(
                      "首次使用时请先创建一个管理员账号，后续登录都会使用这个账号。",
                      "Create an admin account the first time you use the app. The same account is used for all later sign-ins.",
                    )
                  : t(
                      "如果清除了浏览器 Cookie，或者服务端密钥发生变化，需要重新登录。",
                      "If browser cookies are cleared or the server secret changes, you need to sign in again.",
                    )}
              </div>
              <div className="rounded-[20px] border border-white/12 bg-white/6 px-4 py-3">
                {t(
                  "默认使用服务端签发的 JWT，并通过 HttpOnly Cookie 保存，避免客户端直接接触凭据。",
                  "A server-issued JWT is stored in an HttpOnly cookie by default so credentials stay out of the client runtime.",
                )}
              </div>
            </div>
          </section>

          <section className="flex items-center">
            <Card className="w-full rounded-[28px] border-black/8 bg-white/88 shadow-[0_32px_90px_rgba(85,64,31,0.18)] backdrop-blur-xl">
              <CardHeader className="space-y-3 pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-[#111111] text-white shadow-[0_16px_36px_rgba(17,17,17,0.24)]">
                    <ShieldCheck className="size-5" />
                  </div>
                  <LanguageToggle />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-2xl tracking-[-0.03em] text-[#171717]">
                    {isSetupMode
                      ? t("初始化管理员账号", "Initialize Admin Account")
                      : t("登录 Playcode", "Sign In to Playcode")}
                  </CardTitle>
                  <CardDescription className="text-sm leading-6 text-[#6b6257]">
                    {isSetupMode
                      ? t(
                          "首次进入需要先创建管理员账号。创建成功后会直接保持登录。",
                          "Create the admin account the first time you enter. You stay signed in immediately after it is created.",
                        )
                      : t(
                          "请输入管理员账号信息。登录成功后会长期保持登录状态。",
                          "Enter the admin account credentials. After a successful login, the session stays active for a long time.",
                        )}
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="pt-4">
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <label
                      htmlFor="username"
                      className="text-sm font-medium text-[#3e352c]"
                    >
                      {t("用户名", "Username")}
                    </label>
                    <Input
                      id="username"
                      name="username"
                      autoComplete="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder={t("例如：admin", "For example: admin")}
                      className="h-11 rounded-2xl border-black/10 bg-[#fcfaf7]"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="password"
                      className="text-sm font-medium text-[#3e352c]"
                    >
                      {t("密码", "Password")}
                    </label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete={isSetupMode ? "new-password" : "current-password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={
                        isSetupMode
                          ? t("至少 8 位", "At least 8 characters")
                          : t("输入管理员密码", "Enter the admin password")
                      }
                      className="h-11 rounded-2xl border-black/10 bg-[#fcfaf7]"
                      disabled={isSubmitting}
                    />
                  </div>

                  {isSetupMode ? (
                    <div className="space-y-2">
                      <label
                        htmlFor="confirm-password"
                        className="text-sm font-medium text-[#3e352c]"
                      >
                        {t("确认密码", "Confirm Password")}
                      </label>
                      <Input
                        id="confirm-password"
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder={t("再次输入密码", "Enter the password again")}
                        className="h-11 rounded-2xl border-black/10 bg-[#fcfaf7]"
                        disabled={isSubmitting}
                      />
                    </div>
                  ) : null}

                  {error ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    className="h-11 w-full rounded-2xl bg-[#171717] text-white hover:bg-[#2a2a2a]"
                    disabled={isSubmitting}
                  >
                    {isSubmitting
                      ? isSetupMode
                        ? t("正在创建...", "Creating...")
                        : t("正在登录...", "Signing in...")
                      : isSetupMode
                        ? t("创建账号并进入工作台", "Create Account and Enter Workspace")
                        : t("登录并进入工作台", "Sign In and Enter Workspace")}
                  </Button>

                  <p className="text-xs leading-6 text-[#7b7064]">
                    {t(
                      "登录状态会通过长期有效的 HttpOnly Cookie 保存；如需退出，可在工作区侧栏手动退出登录。",
                      "The sign-in state is stored in a long-lived HttpOnly cookie. To sign out, use the action in the workspace sidebar.",
                    )}
                  </p>
                </form>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}
