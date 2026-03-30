import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import {
  getLoginPageState,
  normalizeAuthRedirectPath,
} from "@/lib/server/auth";

type LoginPageSearchParams =
  | Promise<{
      next?: string | string[];
    }>
  | {
      next?: string | string[];
    };

type LoginPageProps = {
  searchParams?: LoginPageSearchParams;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const nextPath = normalizeAuthRedirectPath(resolvedSearchParams?.next);
  const authState = await getLoginPageState();

  if (authState.user) {
    redirect(nextPath);
  }

  return (
    <LoginForm
      mode={authState.hasUsers ? "login" : "setup"}
      nextPath={nextPath}
    />
  );
}
