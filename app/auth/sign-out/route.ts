import { auth } from "@/lib/auth/server";
import { copySetCookieHeaders } from "@/lib/auth/cookie-headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const signOutResponse = await auth.api.signOut({
    headers: request.headers,
    asResponse: true,
  });

  const response = NextResponse.redirect(new URL("/", request.url), {
    status: 303,
  });
  copySetCookieHeaders(signOutResponse.headers, response.headers);
  return response;
}
