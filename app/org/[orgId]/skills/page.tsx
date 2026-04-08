import type { Metadata } from "next";

import { ActiveOrganizationSync } from "@/components/active-organization-sync";
import { OrganizationNav } from "@/components/organization-nav";
import { PageTitleBlock } from "@/components/page-title-block";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { buildOrganizationSkillsPath } from "@/lib/auth/organization";
import {
  listAssistantSkills,
  type AssistantSkillRecord,
} from "@/lib/skills/repository";

import {
  buildOrganizationAdminTabs,
  resolveOrganizationAdminPageContext,
} from "../_lib";
import { OrganizationSkillsSettings } from "./organization-skills-settings";

type RouteParams = Promise<{ orgId: string }>;

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Organization Skills",
  description: "Manage organization-level skills.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function OrganizationSkillsPage({
  params,
}: {
  params: RouteParams;
}) {
  const { orgId: rawOrgId } = await params;
  const orgId = rawOrgId.trim();
  const callbackPath = buildOrganizationSkillsPath(orgId);
  const { user, organization, sessionActiveOrganizationId } =
    await resolveOrganizationAdminPageContext({
      orgId,
      callbackPath,
    });

  let initialSkills: AssistantSkillRecord[] = [];
  let initialSkillsError: string | null = null;
  try {
    initialSkills = await listAssistantSkills({
      userId: user.id,
      organizationId: organization.id,
      organizationName: organization.name,
    });
  } catch (error) {
    initialSkillsError =
      error instanceof Error ? error.message : "Failed to load skills.";
  }

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
          tabs={buildOrganizationAdminTabs(organization.id, "skills")}
        />
        <PageTitleBlock
          title={`${organization.name} Skills`}
          tagline="Manage reusable organization skills shared across members."
        />
        <OrganizationSkillsSettings
          organizationId={organization.id}
          initialSkills={initialSkills}
          initialError={initialSkillsError}
        />
      </section>
    </SiteFixedWidthPageShell>
  );
}
