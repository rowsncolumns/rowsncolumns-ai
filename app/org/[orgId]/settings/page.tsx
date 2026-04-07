import type { Metadata } from "next";

import { ActiveOrganizationSync } from "@/components/active-organization-sync";
import { OrganizationNav } from "@/components/organization-nav";
import { PageTitleBlock } from "@/components/page-title-block";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { buildOrganizationSettingsPath } from "@/lib/auth/organization";

import {
  buildOrganizationAdminTabs,
  resolveOrganizationAdminPageContext,
} from "../_lib";
import { OrganizationSettingsForm } from "./organization-settings-form";

type RouteParams = Promise<{ orgId: string }>;

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Organization Settings",
  description: "Manage organization profile settings.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function OrganizationSettingsPage({
  params,
}: {
  params: RouteParams;
}) {
  const { orgId: rawOrgId } = await params;
  const orgId = rawOrgId.trim();
  const callbackPath = buildOrganizationSettingsPath(orgId);
  const { user, organization, role, sessionActiveOrganizationId } =
    await resolveOrganizationAdminPageContext({
      orgId,
      callbackPath,
    });

  return (
    <SiteFixedWidthPageShell
      initialUser={{
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      }}
    >
      <ActiveOrganizationSync
        organizationId={organization.id}
        sessionActiveOrganizationId={sessionActiveOrganizationId}
      />
      <section className="mx-auto w-full rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
        <OrganizationNav
          tabs={buildOrganizationAdminTabs(organization.id, "settings")}
        />
        <PageTitleBlock
          title={`${organization.name} Settings`}
          tagline="Update organization profile details and access metadata."
        />

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-5">
            <OrganizationSettingsForm
              organizationId={organization.id}
              initialName={organization.name}
              initialSlug={organization.slug}
            />
          </div>

          <aside className="rounded-xl border border-(--card-border) bg-(--card-bg) p-5 text-sm text-(--muted-foreground)">
            <h3 className="display-font text-lg font-semibold text-foreground">
              Organization Info
            </h3>
            <div className="mt-3 space-y-2">
              <p>
                <span className="font-medium text-foreground">ID:</span>{" "}
                {organization.id}
              </p>
              <p>
                <span className="font-medium text-foreground">Slug:</span>{" "}
                {organization.slug}
              </p>
              <p>
                <span className="font-medium text-foreground">Your role:</span>{" "}
                {role}
              </p>
            </div>
          </aside>
        </div>
      </section>
    </SiteFixedWidthPageShell>
  );
}
