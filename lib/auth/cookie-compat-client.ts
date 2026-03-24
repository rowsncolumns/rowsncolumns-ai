"use client";

const COOKIE_COMPAT_PARAM = "cookieCompat";
const COOKIE_COMPAT_PRESERVE_VALUE = "preserve";

function isLikelyThirdPartyIframeContext(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (window.self === window.top) {
      return false;
    }
  } catch {
    return true;
  }

  try {
    const topWindow = window.top;
    if (!topWindow) {
      return true;
    }

    return topWindow.location.origin !== window.location.origin;
  } catch {
    return true;
  }
}

export function withCookieCompatCallbackURL(callbackURL: string): string {
  if (!isLikelyThirdPartyIframeContext()) {
    return callbackURL;
  }

  const url = new URL(callbackURL, window.location.origin);
  url.searchParams.set(COOKIE_COMPAT_PARAM, COOKIE_COMPAT_PRESERVE_VALUE);
  return `${url.pathname}${url.search}${url.hash}`;
}
