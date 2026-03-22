import { auth } from "@/lib/auth/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  await auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
