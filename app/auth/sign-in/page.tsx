import { getServerSessionSafe } from "@/lib/auth/session-safe";
import { ArrowLeft, ShieldCheck, Sparkles, Table2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInSubmitButton } from "./sign-in-submit-button";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function normalizeCallbackPath(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/sheets";
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign In",
  description:
    "Sign in to RowsnColumns AI with Google or GitHub to access your spreadsheet workspace.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const callbackURL = normalizeCallbackPath(
    readSingleParam(params.callbackURL),
  );

  // Check if user is already logged in.
  // Keep redirect outside try/catch because Next.js redirect() throws.
  let session: Awaited<ReturnType<typeof getServerSessionSafe>> | null = null;
  try {
    session = await getServerSessionSafe();
  } catch {
    // If session check fails, show sign-in form (safe fallback)
  }
  if (session?.user) {
    redirect("/sheets");
  }

  const error = readSingleParam(params.error);

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-0 top-0 h-[35rem] w-[36rem] bg-[radial-gradient(circle_at_top_left,rgba(255,109,52,0.28),transparent_64%)]" />
        <div className="absolute right-0 top-10 h-[26rem] w-[28rem] bg-[radial-gradient(circle_at_top_right,rgba(142,47,106,0.16),transparent_62%)]" />
      </div>

      <section className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-12">
        <header className="hero-grid rounded-2xl border border-(--card-border) bg-(--card-bg) p-3 sm:p-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-(--panel-border) bg-(--card-bg-solid) px-3 py-2.5 sm:px-4 sm:py-3">
            <Link href="/" className="flex min-w-0 items-center gap-3">
              <Image
                src="/logo-square.png"
                alt="RowsnColumns AI logo"
                width={50}
                height={39}
                className="rounded-sm max-w-10 sm:max-w-12.5"
              />
              <div className="min-w-0">
                <p className="display-font truncate text-sm font-semibold sm:text-lg">
                  RowsnColumns AI
                </p>
                <p className="hidden text-xs text-(--muted-foreground) sm:block">
                  Agentic AI for Spreadsheets
                </p>
              </div>
            </Link>

            <Link
              href="/"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 py-2 text-sm font-medium text-foreground transition hover:bg-(--assistant-chip-hover)"
            >
              <ArrowLeft className="h-4 w-4" />
              Back Home
            </Link>
          </div>
        </header>

        <section className="mt-5 flex-1 pb-6 sm:mt-6 sm:pb-8">
          <div className="hero-grid relative h-full min-h-[540px] overflow-hidden rounded-3xl border border-(--card-border) bg-(--card-bg) p-5 shadow-[0_30px_80px_var(--card-shadow)] sm:p-7 lg:p-9">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(255,109,52,0.12),transparent_48%)]" />

            <div className="relative grid h-full gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-10">
              <div className="rise-in flex flex-col justify-between space-y-8">
                <div className="space-y-5">
                  <span className="inline-flex items-center rounded-full border border-(--panel-border) bg-(--assistant-chip-bg) px-3 py-1 text-xs font-semibold tracking-[0.03em] text-(--muted-foreground)">
                    Secure workspace access
                  </span>
                  <h1 className="display-font max-w-3xl text-3xl leading-tight font-semibold text-foreground sm:text-4xl lg:text-[3.1rem]">
                    Sign in and pick up exactly where you left off.
                  </h1>
                  <p className="max-w-2xl text-base text-(--muted-foreground) sm:text-lg">
                    Use Google or GitHub to continue to your spreadsheet
                    workspace, open templates, and run AI actions with your
                    existing context.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-(--card-border) bg-(--card-bg-solid) p-4">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg)">
                      <Sparkles className="h-4 w-4 text-(--accent)" />
                    </span>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      AI-assisted formulas
                    </p>
                  </div>
                  <div className="rounded-xl border border-(--card-border) bg-(--card-bg-solid) p-4">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg)">
                      <Table2 className="h-4 w-4 text-(--accent)" />
                    </span>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      Template workflows
                    </p>
                  </div>
                  <div className="rounded-xl border border-(--card-border) bg-(--card-bg-solid) p-4">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg)">
                      <ShieldCheck className="h-4 w-4 text-(--accent)" />
                    </span>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      Protected sessions
                    </p>
                  </div>
                </div>
              </div>

              <div className="rise-in-delayed self-center">
                <div className="relative overflow-hidden rounded-3xl border border-(--card-border) bg-[linear-gradient(165deg,var(--card-bg-solid),color-mix(in_srgb,var(--card-bg)_74%,white))] p-6 shadow-[0_28px_70px_var(--card-shadow)] sm:p-8">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(255,109,52,0.16),transparent_70%)]" />
                  <div className="relative">
                    <p className="text-sm font-medium tracking-[0.02em] text-(--muted-foreground)">
                      Continue to RowsnColumns AI
                    </p>
                    <h2 className="display-font mt-1 text-2xl font-semibold text-foreground sm:text-[2rem]">
                      Sign in
                    </h2>
                    <p className="mt-2 text-sm text-(--muted-foreground) sm:text-base">
                      Choose a trusted provider to continue.
                    </p>
                  </div>

                  <div className="mt-7 space-y-3">
                    <SignInSubmitButton
                      provider="google"
                      callbackPath={callbackURL}
                    />
                    <SignInSubmitButton
                      provider="github"
                      callbackPath={callbackURL}
                    />
                  </div>

                  {error ? (
                    <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </p>
                  ) : null}

                  <p className="mt-6 text-center text-xs text-(--muted-foreground)">
                    By continuing, you agree to our{" "}
                    <Link
                      href="/terms"
                      className="text-foreground hover:underline"
                    >
                      Terms
                    </Link>{" "}
                    and{" "}
                    <Link
                      href="/privacy"
                      className="text-foreground hover:underline"
                    >
                      Privacy Policy
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
