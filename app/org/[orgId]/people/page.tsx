import type { Metadata } from "next";

import { ActiveOrganizationSync } from "@/components/active-organization-sync";
import { OrganizationNav } from "@/components/organization-nav";
import { PageTitleBlock } from "@/components/page-title-block";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { buildOrganizationPeoplePath } from "@/lib/auth/organization";
import {
  listOrganizationInvitations,
  listOrganizationMembers,
} from "@/lib/auth/organization-membership";

import {
  buildOrganizationAdminTabs,
  resolveOrganizationAdminPageContext,
} from "../_lib";
import { CancelInvitationButton } from "./cancel-invitation-button";
import { InviteOrganizationMember } from "./invite-organization-member";
import { RemoveMemberButton } from "./remove-member-button";
import { ResendInvitationButton } from "./resend-invitation-button";

type RouteParams = Promise<{ orgId: string }>;

const formatRoleLabel = (role: string) => {
  if (role === "owner") return "Admin";
  if (role === "admin") return "Admin";
  if (role === "member") return "Member";
  return role;
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Organization People",
  description: "View organization members and roles.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function OrganizationPeoplePage({
  params,
}: {
  params: RouteParams;
}) {
  const { orgId: rawOrgId } = await params;
  const orgId = rawOrgId.trim();
  const callbackPath = buildOrganizationPeoplePath(orgId);
  const { user, organization, sessionActiveOrganizationId } =
    await resolveOrganizationAdminPageContext({
      orgId,
      callbackPath,
    });

  const [members, pendingInvitations] = await Promise.all([
    listOrganizationMembers({
      organizationId: organization.id,
    }),
    listOrganizationInvitations({
      organizationId: organization.id,
      status: "pending",
    }),
  ]);

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
          tabs={buildOrganizationAdminTabs(organization.id, "people")}
        />
        <div className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
          <PageTitleBlock
            className="pb-0"
            title={`${organization.name} People`}
            tagline="Invite new members and manage current organization access."
          />
          <InviteOrganizationMember organizationId={organization.id} />
        </div>

        <div className="mt-4 rounded-xl border border-(--card-border) bg-(--card-bg) p-5">
          <h2 className="display-font text-xl font-semibold text-foreground">
            Members
          </h2>
          <p className="mt-2 text-sm text-(--muted-foreground)">
            Admins and members currently in this organization.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-(--card-border)">
            <table className="min-w-full divide-y divide-(--card-border)">
              <thead>
                <tr className="bg-(--assistant-chip-bg)">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Joined (UTC)
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--card-border)">
                {members.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-sm text-(--muted-foreground)"
                    >
                      No members found.
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr key={member.id} className="hover:bg-(--assistant-chip-bg)">
                      <td className="px-4 py-3 text-sm text-foreground">
                        {member.name?.trim() || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {member.email?.trim() || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {formatRoleLabel(member.role)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {formatDateTime(member.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {member.userId === user.id || member.role === "owner" ? (
                          <span className="text-xs text-(--muted-foreground)">
                            -
                          </span>
                        ) : (
                          <RemoveMemberButton
                            organizationId={organization.id}
                            memberId={member.id}
                            memberName={member.name}
                            memberEmail={member.email}
                          />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-(--card-border) bg-(--card-bg) p-5">
          <h2 className="display-font text-xl font-semibold text-foreground">
            Pending Invites
          </h2>
          <p className="mt-2 text-sm text-(--muted-foreground)">
            Invitations that have been sent but not accepted yet.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-(--card-border)">
            <table className="min-w-full divide-y divide-(--card-border)">
              <thead>
                <tr className="bg-(--assistant-chip-bg)">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Invited By
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Expires (UTC)
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--card-border)">
                {pendingInvitations.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-sm text-(--muted-foreground)"
                    >
                      There are no pending invites at the moment.
                    </td>
                  </tr>
                ) : (
                  pendingInvitations.map((invitation) => (
                    <tr
                      key={invitation.id}
                      className="hover:bg-(--assistant-chip-bg)"
                    >
                      <td className="px-4 py-3 text-sm text-foreground">
                        {invitation.email}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {formatRoleLabel(invitation.role)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {invitation.inviterEmail?.trim() ||
                          invitation.inviterName?.trim() ||
                          "N/A"}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {formatDateTime(invitation.expiresAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <ResendInvitationButton
                            organizationId={organization.id}
                            invitationId={invitation.id}
                            email={invitation.email}
                          />
                          <CancelInvitationButton
                            organizationId={organization.id}
                            invitationId={invitation.id}
                            email={invitation.email}
                          />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </SiteFixedWidthPageShell>
  );
}
