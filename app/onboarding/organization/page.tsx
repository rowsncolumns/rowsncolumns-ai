import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeaderFrame } from "@/components/site-header-frame";
import { getServerSessionSafe } from "@/lib/auth/session-safe";

import { CreateOrganizationForm } from "./create-organization-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const readSingleParam = (
  value: string | string[] | undefined,
): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
};

const normalizeCallbackPath = (value: string | null): string => {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/sheets";
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Create Organization",
  description: "Create your first organization to continue.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CreateOrganizationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const callbackPath = normalizeCallbackPath(
    readSingleParam(params.callbackURL),
  );

  const session = await getServerSessionSafe();
  if (!session?.user) {
    redirect(
      `/auth/sign-in?callbackURL=${encodeURIComponent(`/onboarding/organization?callbackURL=${encodeURIComponent(callbackPath)}`)}`,
    );
  }

  const initialUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-0 top-0 h-[34rem] w-[36rem] bg-[radial-gradient(circle_at_top_left,rgba(255,109,52,0.24),transparent_64%)]" />
        <div className="absolute right-0 top-12 h-[26rem] w-[30rem] bg-[radial-gradient(circle_at_top_right,rgba(0,120,212,0.16),transparent_62%)]" />
      </div>

      <section className="px-5 pt-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <SiteHeaderFrame initialUser={initialUser} />
        </div>
      </section>

      <section className="px-5 pb-6 pt-8 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-xl rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_30px_80px_var(--card-shadow)] sm:p-8">
          <div className="mb-5 flex items-start gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg)">
              <Building2 className="h-5 w-5 text-(--accent)" />
            </div>
            <div>
              <h1 className="display-font text-2xl font-semibold text-foreground">
                Create an organization
              </h1>
              <p className="mt-1 text-sm text-(--muted-foreground)">
                Every account works inside organizations. Create your first one
                to continue.
              </p>
            </div>
          </div>

          <CreateOrganizationForm callbackPath={callbackPath} />
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
