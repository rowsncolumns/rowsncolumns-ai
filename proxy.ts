import { auth } from "@/lib/auth/server";
import {
  normalizeNeonAuthSetCookieHeadersInPlace,
  type NeonAuthCookieCompatibilityMode,
} from "@/lib/auth/cookie-compat";
import type { NextRequest } from "next/server";

const authMiddleware = auth.middleware({
  loginUrl: "/auth/sign-in",
});
const COOKIE_COMPAT_PARAM = "cookieCompat";
const COOKIE_COMPAT_PRESERVE_VALUE = "preserve";

function resolveCookieCompatibilityMode(
  request: NextRequest,
): NeonAuthCookieCompatibilityMode {
  if (
    request.nextUrl.searchParams.get(COOKIE_COMPAT_PARAM) ===
    COOKIE_COMPAT_PRESERVE_VALUE
  ) {
    return "preserve";
  }

  if (
    request.headers.get("x-rnc-cookie-compat") ===
    COOKIE_COMPAT_PRESERVE_VALUE
  ) {
    return "preserve";
  }

  return "normalize";
}

export default async function proxy(request: NextRequest) {
  const response = await authMiddleware(request);

  const locationHeader = response.headers.get("location");
  if (locationHeader && response.status >= 300 && response.status < 400) {
    const redirectUrl = new URL(locationHeader, request.url);
    if (
      redirectUrl.pathname === "/auth/sign-in" &&
      !redirectUrl.searchParams.has("callbackURL")
    ) {
      const callbackPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      redirectUrl.searchParams.set("callbackURL", callbackPath);
      response.headers.set("location", redirectUrl.toString());
    }
  }

  normalizeNeonAuthSetCookieHeadersInPlace(
    response.headers,
    resolveCookieCompatibilityMode(request),
  );
  return response;
}

export const config = {
  matcher: ["/doc/:path*", "/account/:path*", "/auth/callback"],
};
