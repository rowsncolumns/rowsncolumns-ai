import { auth } from "@/lib/auth/server";
import { NextResponse, type NextRequest } from "next/server";

export default async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  if (!session) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    const callbackPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    signInUrl.searchParams.set("callbackURL", callbackPath);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/doc/:path*", "/account/:path*"],
};
