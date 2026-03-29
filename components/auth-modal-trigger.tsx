"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Github, User, X } from "lucide-react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { withCookieCompatCallbackURL } from "@/lib/auth/cookie-compat-client";

type AuthModalTriggerProps = {
  triggerText: string;
  mobileTriggerText?: string;
  authenticatedTriggerText?: string;
  mobileAuthenticatedTriggerText?: string;
  initialIsAuthenticated?: boolean;
  triggerVariant?: "ghost" | "hero";
  redirectTo?: string;
  className?: string;
  showIconOnMobile?: boolean;
};
type SocialProvider = "google" | "github";

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

export function AuthModalTrigger({
  triggerText,
  mobileTriggerText,
  authenticatedTriggerText,
  mobileAuthenticatedTriggerText,
  initialIsAuthenticated = false,
  triggerVariant = "ghost",
  redirectTo = "/doc",
  className = "",
  showIconOnMobile = false,
}: AuthModalTriggerProps) {
  const { data: sessionData, isPending: isSessionPending } =
    authClient.useSession();
  const isAuthenticated =
    Boolean(sessionData?.user) || (isSessionPending && initialIsAuthenticated);

  const resolvedTriggerText =
    isAuthenticated && authenticatedTriggerText
      ? authenticatedTriggerText
      : triggerText;
  const resolvedMobileTriggerText =
    isAuthenticated && mobileAuthenticatedTriggerText
      ? mobileAuthenticatedTriggerText
      : (mobileTriggerText ?? resolvedTriggerText);
  const [open, setOpen] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const callbackURL = useMemo(() => {
    return withCookieCompatCallbackURL(
      `/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
    );
  }, [redirectTo]);

  const handleSocialSignIn = useCallback(
    async (provider: SocialProvider) => {
      try {
        setError(null);
        setLoadingProvider(provider);
        await authClient.signIn.social({
          provider,
          callbackURL,
        });
      } catch (err) {
        setLoadingProvider(null);
        setError(
          err instanceof Error
            ? err.message
            : `Unable to continue with ${provider}.`,
        );
      }
    },
    [callbackURL],
  );

  const handleTriggerClick = useCallback(async () => {
    if (isAuthenticated) {
      window.location.assign(redirectTo);
      return;
    }

    const { data } = await authClient.getSession();
    if (data?.user) {
      window.location.assign(redirectTo);
      return;
    }

    setOpen(true);
  }, [isAuthenticated, redirectTo]);

  const modal = open ? (
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/45 px-4 py-8"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-117.5 rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-6 py-20 shadow-[0_30px_100px_rgba(0,0,0,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-(--muted-foreground) transition hover:bg-black/5 hover:text-foreground"
          aria-label="Close sign in dialog"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="text-center">
          <h2 className="display-font text-2xl font-semibold text-foreground">
            Welcome to RowsnColumns AI
          </h2>
          <p className="mt-2 text-lg text-(--muted-foreground)">
            Sign in to continue
          </p>
        </div>

        <div className="mt-6">
          <button
            type="button"
            disabled={!!loadingProvider}
            onClick={() => handleSocialSignIn("google")}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-(--card-border) bg-(--card-bg-solid) text-base font-semibold text-foreground shadow-[0_2px_4px_var(--card-shadow)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GoogleBadge />
            {loadingProvider === "google"
              ? "Signing in..."
              : "Sign in with Google"}
          </button>

          <button
            type="button"
            disabled={!!loadingProvider}
            onClick={() => handleSocialSignIn("github")}
            className="mt-3 flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-(--card-border) bg-(--card-bg-solid) text-base font-semibold text-foreground shadow-[0_2px_4px_var(--card-shadow)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Github className="h-5 w-5" />
            {loadingProvider === "github"
              ? "Signing in..."
              : "Sign in with GitHub"}
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      {triggerVariant === "ghost" ? (
        <Button
          variant="ghost"
          className={`rounded-lg ${className}`}
          type="button"
          onClick={handleTriggerClick}
        >
          {showIconOnMobile ? (
            <>
              <User className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">{resolvedTriggerText}</span>
            </>
          ) : (
            resolvedTriggerText
          )}
        </Button>
      ) : (
        <button
          type="button"
          onClick={handleTriggerClick}
          className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-(--accent) px-6 text-base font-semibold text-(--accent-foreground) shadow-[0_18px_40px_rgba(255,109,52,0.22)] transition-all duration-200 hover:bg-(--accent-strong) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
        >
          <span className="sm:hidden">{resolvedMobileTriggerText}</span>
          <span className="hidden sm:inline">{resolvedTriggerText}</span>
        </button>
      )}

      {typeof document !== "undefined"
        ? createPortal(modal, document.body)
        : null}
    </>
  );
}
