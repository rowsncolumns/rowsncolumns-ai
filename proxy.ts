import { auth } from "@/lib/auth/server";
import { normalizeNeonAuthSetCookieHeadersInPlace } from "@/lib/auth/cookie-compat";
import type { NextRequest } from "next/server";

const authMiddleware = auth.middleware({
  loginUrl: "/auth/sign-in",
});

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

  normalizeNeonAuthSetCookieHeadersInPlace(response.headers);
  return response;
}

export const config = {
  matcher: ["/doc/:path*", "/account/:path*", "/auth/callback"],
};
