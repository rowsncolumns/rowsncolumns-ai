import { Card } from "@/components/ui/card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
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
  return "/sheets/new";
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

  // Check if user is already logged in and redirect them
  // Wrapped in try-catch to handle cookie mutation errors that can occur
  // when the auth library tries to refresh session tokens in Server Components
  try {
    const session = await getServerSessionSafe();
    if (session?.user) {
      redirect(callbackURL);
    }
  } catch {
    // If session check fails, show sign-in form (safe fallback)
  }

  const error = readSingleParam(params.error);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(circle_at_top,rgba(255,109,52,0.22),transparent_42%)]" />

      <section className="px-5 pt-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="hero-grid overflow-hidden bg-(--card-bg)">
            <div className="p-4 sm:p-6">
              <SiteHeader />
            </div>
          </Card>
        </div>
      </section>

      <section className="flex flex-1 items-center px-5 pb-12 pt-8 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mx-auto w-full max-w-117.5 rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-6 py-10 shadow-[0_30px_100px_rgba(0,0,0,0.28)]">
            <div className="text-center">
              <h2 className="display-font text-2xl font-semibold text-foreground">
                Welcome to RowsnColumns AI
              </h2>
              <p className="mt-2 text-lg text-(--muted-foreground)">
                Sign in to continue
              </p>
            </div>

            <div className="mt-6">
              <SignInSubmitButton
                provider="google"
                callbackPath={callbackURL}
              />
            </div>
            <div className="mt-3">
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
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
