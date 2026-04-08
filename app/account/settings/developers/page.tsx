import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageTitleBlock } from "@/components/page-title-block";

import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import {
  getActiveOrganizationIdFromSession,
  listOrganizationsForSession,
} from "@/lib/auth/organization";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import { getActiveUserApiKeyMetadata } from "@/lib/auth/user-api-keys";

import { AccountSettingsNav } from "../account-settings-nav";
import { AccountApiKeyForm } from "../api-key-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Developers",
  description: "Manage developer access for your RowsnColumns AI account.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AccountDevelopersSettingsPage() {
  const session = await getServerSessionSafe();
  if (!session?.user) {
    redirect("/auth/sign-in?callbackURL=/account/settings/developers");
  }

  const user = session.user;
  const organizations = await listOrganizationsForSession().catch(() => []);
  const activeOrganizationIdFromSession = getActiveOrganizationIdFromSession(
    session,
  );
  const selectedOrganizationId =
    organizations.find((item) => item.id === activeOrganizationIdFromSession)
      ?.id ??
    organizations[0]?.id ??
    null;
  const activeApiKey = selectedOrganizationId
    ? await getActiveUserApiKeyMetadata(
        user.id,
        selectedOrganizationId,
      ).catch(() => null)
    : null;

  return (
    <SiteFixedWidthPageShell
      initialUser={{
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      }}
    >
      <section className="mx-auto w-full rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
        <AccountSettingsNav activeSegment="developers" />
        <PageTitleBlock
          title="Account Settings"
          tagline="Manage developer access credentials."
        />

        <div className="pt-2">
          <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-5">
            <h2 className="display-font text-xl font-semibold text-foreground">
              API key
            </h2>
            <p className="mt-1 text-sm text-(--muted-foreground)">
              Generate an organization-scoped API key for authenticated `/api/sheets/*`
              requests.
            </p>
            <div className="mt-4">
              <AccountApiKeyForm
                organizations={organizations}
                initialOrganizationId={selectedOrganizationId}
                initialKey={activeApiKey}
              />
            </div>
          </div>
        </div>
      </section>
    </SiteFixedWidthPageShell>
  );
}
