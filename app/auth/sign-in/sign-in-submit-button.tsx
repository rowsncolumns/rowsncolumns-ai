"use client";

import { useCallback, useState } from "react";
import { Github, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { withCookieCompatCallbackURL } from "@/lib/auth/cookie-compat-client";

type Provider = "google" | "github";

function GoogleBadge() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function callbackURLFromPath(path: string): string {
  return withCookieCompatCallbackURL(
    `/auth/callback?redirectTo=${encodeURIComponent(path)}`,
  );
}

export function SignInSubmitButton({
  provider,
  callbackPath,
}: {
  provider: Provider;
  callbackPath: string;
}) {
  const [pending, setPending] = useState(false);
  const isGoogle = provider === "google";
  const providerLabel = isGoogle ? "Google" : "GitHub";

  const handleClick = useCallback(async () => {
    try {
      setPending(true);
      const callbackURL = callbackURLFromPath(callbackPath);
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL,
      });

      if (error) {
        throw new Error(
          error.message ?? `Failed to start ${providerLabel} sign-in`,
        );
      }
    } catch (err) {
      setPending(false);
      const message =
        err instanceof Error
          ? err.message
          : `Failed to start ${providerLabel} sign-in`;
      const errorURL = `/auth/sign-in?callbackURL=${encodeURIComponent(
        callbackPath,
      )}&error=${encodeURIComponent(message)}`;
      window.location.assign(errorURL);
    }
  }, [callbackPath, provider, providerLabel]);

  return (
    <button
      type="button"
      className="group flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-(--panel-border) bg-(--card-bg-solid) px-4 text-base font-semibold text-foreground shadow-[0_8px_24px_var(--card-shadow)] transition duration-200 hover:-translate-y-0.5 hover:border-(--panel-border-strong) hover:bg-(--assistant-chip-bg) hover:shadow-[0_14px_30px_var(--card-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        void handleClick();
      }}
    >
      {pending ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin" />
          Redirecting...
        </>
      ) : (
        <>
          {isGoogle ? <GoogleBadge /> : <Github className="h-5 w-5" />}
          {isGoogle ? "Continue with Google" : "Continue with GitHub"}
        </>
      )}
    </button>
  );
}
