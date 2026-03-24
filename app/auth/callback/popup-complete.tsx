"use client";

import { useEffect } from "react";

const OAUTH_POPUP_MESSAGE_TYPE = "neon-auth:oauth-complete";
const NEON_AUTH_SESSION_VERIFIER_PARAM_NAME = "neon_auth_session_verifier";
const NEON_AUTH_POPUP_CALLBACK_PARAM_NAME = "neon_popup_callback";
const OAUTH_ERROR_PARAM_NAME = "error";
const OAUTH_ERROR_DESCRIPTION_PARAM_NAME = "error_description";

function readParamFromSearchOrHash(params: URLSearchParams, key: string) {
  const direct = params.get(key)?.trim();
  if (direct) return direct;
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) return null;
  const hashParams = new URLSearchParams(hash);
  const fromHash = hashParams.get(key)?.trim();
  return fromHash || null;
}

export function PopupComplete() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifier = readParamFromSearchOrHash(
      params,
      NEON_AUTH_SESSION_VERIFIER_PARAM_NAME,
    );
    const originalCallback = readParamFromSearchOrHash(
      params,
      NEON_AUTH_POPUP_CALLBACK_PARAM_NAME,
    );
    const oauthError = readParamFromSearchOrHash(params, OAUTH_ERROR_PARAM_NAME);
    const oauthErrorDescription = readParamFromSearchOrHash(
      params,
      OAUTH_ERROR_DESCRIPTION_PARAM_NAME,
    );
    const payload = {
      type: OAUTH_POPUP_MESSAGE_TYPE,
      verifier,
      originalCallback,
      ...(oauthError ? { error: oauthError } : {}),
      ...(oauthErrorDescription ? { errorDescription: oauthErrorDescription } : {}),
    };

    try {
      if (
        typeof Office !== "undefined" &&
        Office.context?.ui &&
        typeof Office.context.ui.messageParent === "function"
      ) {
        Office.context.ui.messageParent(JSON.stringify(payload));
        window.close();
        return;
      }
    } catch {
      // Ignore Office messaging failures and fall back to opener messaging.
    }

    if (window.opener && window.opener !== window) {
      window.opener.postMessage(
        payload,
        "*",
      );
      window.close();
      return;
    }

    // Fallback when popup opener is unavailable: return to callback target.
    const fallbackUrl =
      originalCallback && originalCallback.startsWith("/")
        ? originalCallback
        : "/excel-addin";
    if (verifier) {
      const fallback = new URL(fallbackUrl, window.location.origin);
      fallback.searchParams.set(NEON_AUTH_SESSION_VERIFIER_PARAM_NAME, verifier);
      window.location.replace(`${fallback.pathname}${fallback.search}${fallback.hash}`);
      return;
    }
    window.location.replace(fallbackUrl);
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 text-sm text-(--muted-foreground)">
      Completing sign-in...
    </main>
  );
}
