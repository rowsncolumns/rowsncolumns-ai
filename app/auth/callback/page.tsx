import { auth } from "@/lib/auth/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function normalizeRedirectPath(value: string | null): string {
  if (value && value.startsWith("/")) return value;
  return "/doc";
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Signing In",
  description: "Completing your RowsnColumns AI sign-in.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [{ data: session }, params] = await Promise.all([
    auth.getSession(),
    searchParams,
  ]);

  if (!session?.user) {
    redirect("/auth/sign-in?error=Unable%20to%20complete%20sign-in");
  }

  const redirectTo = normalizeRedirectPath(readSingleParam(params.redirectTo));
  redirect(redirectTo);
}
