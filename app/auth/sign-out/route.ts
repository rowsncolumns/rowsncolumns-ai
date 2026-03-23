import { auth } from "@/lib/auth/server";
import {
  cloneResponseWithNormalizedNeonAuthCookies,
  copySetCookieHeaders,
} from "@/lib/auth/cookie-compat";
import { NextResponse } from "next/server";

const authHandler = auth.handler();

export async function POST(request: Request) {
  const signOutResponse = await authHandler.POST(request, {
    params: Promise.resolve({ path: ["sign-out"] }),
  });
  const normalizedSignOutResponse =
    cloneResponseWithNormalizedNeonAuthCookies(signOutResponse);

  const response = NextResponse.redirect(new URL("/", request.url), {
    status: 303,
  });
  copySetCookieHeaders(normalizedSignOutResponse.headers, response.headers);
  return response;
}
