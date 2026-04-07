import { notFound, redirect } from "next/navigation";

import {
  buildOrganizationBillingPath,
  buildOrganizationPeoplePath,
  buildOrganizationSettingsPath,
  getActiveOrganizationIdFromSession,
  listOrganizationsForSession,
  type OrganizationSummary,
} from "@/lib/auth/organization";
import {
  getOrganizationRoleForUser,
  isOrganizationAdminRole,
  type OrganizationRole,
} from "@/lib/auth/organization-membership";
import { getServerSessionSafe } from "@/lib/auth/session-safe";

export type OrganizationAdminPageContext = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
  organization: OrganizationSummary;
  role: OrganizationRole;
  sessionActiveOrganizationId: string | null;
};

export const resolveOrganizationAdminPageContext = async ({
  orgId,
  callbackPath,
}: {
  orgId: string;
  callbackPath: string;
}): Promise<OrganizationAdminPageContext> => {
  const session = await getServerSessionSafe();
  if (!session?.user) {
    redirect(`/auth/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`);
  }

  const organizations = await listOrganizationsForSession();
  const organization = organizations.find((item) => item.id === orgId) ?? null;
  if (!organization) {
    notFound();
  }

  const role = await getOrganizationRoleForUser({
    userId: session.user.id,
    organizationId: organization.id,
  });
  if (!role) {
    notFound();
  }
  if (!isOrganizationAdminRole(role)) {
    redirect("/sheets");
  }

  return {
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      image: session.user.image ?? null,
    },
    organization,
    role,
    sessionActiveOrganizationId: getActiveOrganizationIdFromSession(session),
  };
};

export const buildOrganizationAdminTabs = (
  orgId: string,
  active: "billing" | "people" | "settings",
) => [
  {
    href: buildOrganizationBillingPath(orgId),
    label: "Billing",
    isActive: active === "billing",
  },
  {
    href: buildOrganizationPeoplePath(orgId),
    label: "People",
    isActive: active === "people",
  },
  {
    href: buildOrganizationSettingsPath(orgId),
    label: "Settings",
    isActive: active === "settings",
  },
];
