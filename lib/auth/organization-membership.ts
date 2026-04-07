import { db } from "@/lib/db/postgres";

export type OrganizationRole = "owner" | "admin" | "member" | string;
export type OrganizationInvitationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "canceled"
  | string;

export type OrganizationMemberRecord = {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  name: string | null;
  email: string | null;
  image: string | null;
  createdAt: string;
};

export type OrganizationInvitationRecord = {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  status: OrganizationInvitationStatus;
  inviterId: string;
  inviterName: string | null;
  inviterEmail: string | null;
  expiresAt: string;
  createdAt: string;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const isOrganizationAdminRole = (
  role: string | null | undefined,
): boolean => role === "owner" || role === "admin";

export async function getOrganizationRoleForUser({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<OrganizationRole | null> {
  const normalizedUserId = toNonEmptyString(userId);
  const normalizedOrganizationId = toNonEmptyString(organizationId);
  if (!normalizedUserId || !normalizedOrganizationId) {
    return null;
  }

  const rows = await db<{ role: string }[]>`
    SELECT m."role" AS role
    FROM public.member AS m
    WHERE m."userId" = ${normalizedUserId}
      AND m."organizationId" = ${normalizedOrganizationId}
    LIMIT 1
  `;

  return rows[0]?.role ?? null;
}

export async function listOrganizationMembers({
  organizationId,
}: {
  organizationId: string;
}): Promise<OrganizationMemberRecord[]> {
  const normalizedOrganizationId = toNonEmptyString(organizationId);
  if (!normalizedOrganizationId) {
    return [];
  }

  const rows = await db<
    {
      id: string;
      organization_id: string;
      user_id: string;
      role: string;
      name: string | null;
      email: string | null;
      image: string | null;
      created_at: Date | string;
    }[]
  >`
    SELECT
      m.id,
      m."organizationId" AS organization_id,
      m."userId" AS user_id,
      m."role" AS role,
      u.name,
      u.email,
      u.image,
      m."createdAt" AS created_at
    FROM public.member AS m
    LEFT JOIN public."user" AS u
      ON u.id = m."userId"
    WHERE m."organizationId" = ${normalizedOrganizationId}
    ORDER BY
      CASE
        WHEN m."role" = 'owner' THEN 0
        WHEN m."role" = 'admin' THEN 1
        ELSE 2
      END ASC,
      COALESCE(NULLIF(BTRIM(u.name), ''), u.email, m."userId") ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    name: row.name,
    email: row.email,
    image: row.image,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  }));
}

export async function listOrganizationInvitations({
  organizationId,
  status,
}: {
  organizationId: string;
  status?: OrganizationInvitationStatus | null;
}): Promise<OrganizationInvitationRecord[]> {
  const normalizedOrganizationId = toNonEmptyString(organizationId);
  const normalizedStatus = toNonEmptyString(status);
  if (!normalizedOrganizationId) {
    return [];
  }

  const rows = normalizedStatus
    ? await db<
        {
          id: string;
          organization_id: string;
          email: string;
          role: string;
          status: string;
          inviter_id: string;
          inviter_name: string | null;
          inviter_email: string | null;
          expires_at: Date | string;
          created_at: Date | string;
        }[]
      >`
        SELECT
          i.id,
          i."organizationId" AS organization_id,
          i.email,
          i."role" AS role,
          i.status,
          i."inviterId" AS inviter_id,
          inviter.name AS inviter_name,
          inviter.email AS inviter_email,
          i."expiresAt" AS expires_at,
          i."createdAt" AS created_at
        FROM public.invitation AS i
        LEFT JOIN public."user" AS inviter
          ON inviter.id = i."inviterId"
        WHERE i."organizationId" = ${normalizedOrganizationId}
          AND i.status = ${normalizedStatus}
        ORDER BY i."createdAt" DESC
      `
    : await db<
        {
          id: string;
          organization_id: string;
          email: string;
          role: string;
          status: string;
          inviter_id: string;
          inviter_name: string | null;
          inviter_email: string | null;
          expires_at: Date | string;
          created_at: Date | string;
        }[]
      >`
        SELECT
          i.id,
          i."organizationId" AS organization_id,
          i.email,
          i."role" AS role,
          i.status,
          i."inviterId" AS inviter_id,
          inviter.name AS inviter_name,
          inviter.email AS inviter_email,
          i."expiresAt" AS expires_at,
          i."createdAt" AS created_at
        FROM public.invitation AS i
        LEFT JOIN public."user" AS inviter
          ON inviter.id = i."inviterId"
        WHERE i."organizationId" = ${normalizedOrganizationId}
        ORDER BY i."createdAt" DESC
      `;

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    status: row.status,
    inviterId: row.inviter_id,
    inviterName: row.inviter_name,
    inviterEmail: row.inviter_email,
    expiresAt:
      row.expires_at instanceof Date
        ? row.expires_at.toISOString()
        : new Date(row.expires_at).toISOString(),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  }));
}

export async function getOrganizationInvitationById({
  organizationId,
  invitationId,
}: {
  organizationId: string;
  invitationId: string;
}): Promise<OrganizationInvitationRecord | null> {
  const normalizedOrganizationId = toNonEmptyString(organizationId);
  const normalizedInvitationId = toNonEmptyString(invitationId);
  if (!normalizedOrganizationId || !normalizedInvitationId) {
    return null;
  }

  const rows = await db<
    {
      id: string;
      organization_id: string;
      email: string;
      role: string;
      status: string;
      inviter_id: string;
      inviter_name: string | null;
      inviter_email: string | null;
      expires_at: Date | string;
      created_at: Date | string;
    }[]
  >`
    SELECT
      i.id,
      i."organizationId" AS organization_id,
      i.email,
      i."role" AS role,
      i.status,
      i."inviterId" AS inviter_id,
      inviter.name AS inviter_name,
      inviter.email AS inviter_email,
      i."expiresAt" AS expires_at,
      i."createdAt" AS created_at
    FROM public.invitation AS i
    LEFT JOIN public."user" AS inviter
      ON inviter.id = i."inviterId"
    WHERE i.id = ${normalizedInvitationId}
      AND i."organizationId" = ${normalizedOrganizationId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    status: row.status,
    inviterId: row.inviter_id,
    inviterName: row.inviter_name,
    inviterEmail: row.inviter_email,
    expiresAt:
      row.expires_at instanceof Date
        ? row.expires_at.toISOString()
        : new Date(row.expires_at).toISOString(),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  };
}
