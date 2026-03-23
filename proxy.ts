import { auth } from "@/lib/auth/server";
import { normalizeNeonAuthSetCookieHeadersInPlace } from "@/lib/auth/cookie-compat";
import type { NextRequest } from "next/server";

const authMiddleware = auth.middleware({
  loginUrl: "/auth/sign-in",
});

export default async function proxy(request: NextRequest) {
  const response = await authMiddleware(request);
  normalizeNeonAuthSetCookieHeadersInPlace(response.headers);
  return response;
}

export const config = {
  matcher: ["/doc/:path*", "/account/:path*", "/auth/callback"],
};
