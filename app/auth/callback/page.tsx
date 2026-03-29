import type { Metadata } from "next";
import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function normalizeRedirectPath(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/sheets/new";
}

function buildSignInErrorRedirect({
  callbackPath,
  error,
}: {
  callbackPath: string;
  error: string;
}) {
  return `/auth/sign-in?callbackURL=${encodeURIComponent(
    callbackPath,
  )}&error=${encodeURIComponent(error)}`;
}

function normalizeOAuthErrorMessage(rawError: string, description?: string) {
  const lowered = rawError.trim().toLowerCase();
  if (lowered === "access_denied") {
    return "Sign-in was canceled.";
  }

  if (description?.trim()) {
    return description.trim();
  }

  return "Unable to complete sign-in. Please try again.";
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Signing In",
  description: "Completing your RowsnColumns AI sign-in.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const redirectTo = normalizeRedirectPath(readSingleParam(params.redirectTo));
  const oauthError = readSingleParam(params.error);
  const oauthErrorDescription =
    readSingleParam(params.error_description) ??
    readSingleParam(params.message) ??
    undefined;

  if (oauthError) {
    redirect(
      buildSignInErrorRedirect({
        callbackPath: redirectTo,
        error: normalizeOAuthErrorMessage(oauthError, oauthErrorDescription),
      }),
    );
  }

  redirect(redirectTo);
}
