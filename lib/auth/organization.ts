import { headers as nextHeaders } from "next/headers";

import { auth } from "@/lib/auth/server";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeOrganizationList = (value: unknown): OrganizationSummary[] => {
  const rawOrganizations = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { data?: unknown }).data)
      ? ((value as { data: unknown[] }).data ?? [])
      : [];

  const organizations: OrganizationSummary[] = [];
  for (const entry of rawOrganizations) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const id = toNonEmptyString((entry as { id?: unknown }).id);
    const name =
      toNonEmptyString((entry as { name?: unknown }).name) ?? "Organization";
    const slug =
      toNonEmptyString((entry as { slug?: unknown }).slug) ??
      name.toLowerCase().replace(/\s+/g, "-");

    if (!id) {
      continue;
    }

    organizations.push({ id, name, slug });
  }

  return organizations;
};

export const getActiveOrganizationIdFromSession = (
  session: unknown,
): string | null => {
  if (!session || typeof session !== "object") {
    return null;
  }

  const activeOrganizationId = toNonEmptyString(
    (
      session as {
        session?: { activeOrganizationId?: unknown } | null;
      }
    ).session?.activeOrganizationId,
  );

  return activeOrganizationId;
};

const listOrganizationsForCurrentRequest = async (): Promise<
  OrganizationSummary[]
> => {
  const requestHeaders = await nextHeaders();
  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });
  return normalizeOrganizationList(organizations);
};

export async function resolveActiveOrganizationIdForSession(
  session: unknown,
): Promise<string | null> {
  const existingActiveOrganizationId =
    getActiveOrganizationIdFromSession(session);
  if (existingActiveOrganizationId) {
    return existingActiveOrganizationId;
  }

  const organizations = await listOrganizationsForCurrentRequest();
  const fallbackOrganizationId = organizations[0]?.id ?? null;
  if (!fallbackOrganizationId) {
    return null;
  }

  const requestHeaders = await nextHeaders();
  try {
    await auth.api.setActiveOrganization({
      headers: requestHeaders,
      body: {
        organizationId: fallbackOrganizationId,
      },
    });
  } catch {
    // In Server Components, cookie mutation may be blocked. Fall back to using
    // the resolved org id for this request without persisting it in session.
  }

  return fallbackOrganizationId;
}

export async function listOrganizationsForSession(): Promise<
  OrganizationSummary[]
> {
  return listOrganizationsForCurrentRequest();
}

export async function resolveOrganizationForSessionById(
  organizationId: string | null | undefined,
): Promise<OrganizationSummary | null> {
  const normalizedOrganizationId = toNonEmptyString(organizationId);
  if (!normalizedOrganizationId) {
    return null;
  }

  const organizations = await listOrganizationsForCurrentRequest();
  return (
    organizations.find(
      (organization) => organization.id === normalizedOrganizationId,
    ) ?? null
  );
}

export function buildOrganizationSheetsBasePath(
  organizationId: string,
): string {
  return `/org/${encodeURIComponent(organizationId)}/sheets`;
}

export function buildOrganizationSheetPath({
  organizationId,
  documentId,
}: {
  organizationId: string;
  documentId: string;
}): string {
  return `${buildOrganizationSheetsBasePath(organizationId)}/${encodeURIComponent(documentId)}`;
}

export function buildOrganizationBillingPath(organizationId: string): string {
  return `/org/${encodeURIComponent(organizationId)}/billing`;
}

export function buildOrganizationPeoplePath(organizationId: string): string {
  return `/org/${encodeURIComponent(organizationId)}/people`;
}

export function buildOrganizationSettingsPath(organizationId: string): string {
  return `/org/${encodeURIComponent(organizationId)}/settings`;
}

export function buildOrganizationSkillsPath(organizationId: string): string {
  return `/org/${encodeURIComponent(organizationId)}/skills`;
}
