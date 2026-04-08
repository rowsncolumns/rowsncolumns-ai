import { createHash, randomBytes, randomUUID } from "node:crypto";

import { db } from "@/lib/db/postgres";

const API_KEY_PREFIX = "sc-";
const API_KEY_VISIBLE_PREFIX_LENGTH = 12;
const API_KEY_MIN_LENGTH = 24;
const API_KEY_MAX_LENGTH = 200;
const API_KEY_SECRET_BYTES = 32;

type UserApiKeyRow = {
  id: string;
  user_id: string;
  organization_id: string | null;
  key_prefix: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
};

export type UserApiKeyMetadata = {
  id: string;
  userId: string;
  organizationId: string | null;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type UserApiKeyAuthResult = {
  keyId: string;
  userId: string;
  organizationId: string | null;
};

let ensureTablesPromise: Promise<void> | null = null;

const mapRowToMetadata = (row: UserApiKeyRow): UserApiKeyMetadata => ({
  id: row.id,
  userId: row.user_id,
  organizationId: row.organization_id,
  keyPrefix: row.key_prefix,
  createdAt: new Date(row.created_at).toISOString(),
  lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
});

const ensureTables = async () => {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS public.user_api_keys (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          organization_id TEXT,
          key_prefix TEXT NOT NULL,
          key_hash TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ
        )
      `;
      await db`
        ALTER TABLE public.user_api_keys
        ADD COLUMN IF NOT EXISTS organization_id TEXT
      `;
      await db`
        DROP INDEX IF EXISTS user_api_keys_user_active_idx
      `;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS user_api_keys_user_org_active_idx
        ON public.user_api_keys (user_id, organization_id)
        WHERE revoked_at IS NULL
          AND organization_id IS NOT NULL
      `;
      await db`
        CREATE INDEX IF NOT EXISTS user_api_keys_user_org_created_idx
        ON public.user_api_keys (user_id, organization_id, created_at DESC)
      `;
      await db`
        CREATE INDEX IF NOT EXISTS user_api_keys_org_created_idx
        ON public.user_api_keys (organization_id, created_at DESC)
      `;
    })().catch((error) => {
      ensureTablesPromise = null;
      throw error;
    });
  }

  await ensureTablesPromise;
};

const normalizeUserId = (userId: string): string => userId.trim();
const normalizeOrganizationId = (organizationId: string): string =>
  organizationId.trim();

const normalizeApiKey = (value: string): string => value.trim();

const isPlausibleApiKey = (value: string): boolean =>
  value.startsWith(API_KEY_PREFIX) &&
  value.length >= API_KEY_MIN_LENGTH &&
  value.length <= API_KEY_MAX_LENGTH;

const hashApiKey = (apiKey: string): string =>
  createHash("sha256").update(apiKey).digest("hex");

const generateApiKey = (): { apiKey: string; keyPrefix: string; keyHash: string } => {
  const token = randomBytes(API_KEY_SECRET_BYTES).toString("base64url");
  const apiKey = `${API_KEY_PREFIX}${token}`;
  return {
    apiKey,
    keyPrefix: apiKey.slice(0, API_KEY_VISIBLE_PREFIX_LENGTH),
    keyHash: hashApiKey(apiKey),
  };
};

export const parseBearerToken = (
  authorizationHeader: string | null | undefined,
): string | null => {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim();
  return token || null;
};

export async function getActiveUserApiKeyMetadata(
  userId: string,
  organizationId: string,
): Promise<UserApiKeyMetadata | null> {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!normalizedUserId) {
    return null;
  }
  if (!normalizedOrganizationId) {
    return null;
  }

  await ensureTables();
  const rows = await db<UserApiKeyRow[]>`
    SELECT id, user_id, organization_id, key_prefix, created_at, last_used_at
    FROM public.user_api_keys
    WHERE user_id = ${normalizedUserId}
      AND organization_id = ${normalizedOrganizationId}
      AND revoked_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const row = rows[0];
  return row ? mapRowToMetadata(row) : null;
}

export async function createOrRotateUserApiKey(
  userId: string,
  organizationId: string,
): Promise<{ apiKey: string; key: UserApiKeyMetadata }> {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!normalizedUserId) {
    throw new Error("userId is required.");
  }
  if (!normalizedOrganizationId) {
    throw new Error("organizationId is required.");
  }

  await ensureTables();
  const generated = generateApiKey();
  const keyId = randomUUID();

  const row = await db.begin(async (tx) => {
    await tx.unsafe(
      `
        UPDATE public.user_api_keys
        SET revoked_at = NOW()
        WHERE user_id = $1
          AND organization_id = $2
          AND revoked_at IS NULL
      `,
      [normalizedUserId, normalizedOrganizationId],
    );

    const inserted = await tx.unsafe<UserApiKeyRow[]>(
      `
        INSERT INTO public.user_api_keys (
          id,
          user_id,
          organization_id,
          key_prefix,
          key_hash
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5
        )
        RETURNING id, user_id, organization_id, key_prefix, created_at, last_used_at
      `,
      [
        keyId,
        normalizedUserId,
        normalizedOrganizationId,
        generated.keyPrefix,
        generated.keyHash,
      ],
    );
    return inserted[0] ?? null;
  });

  if (!row) {
    throw new Error("Failed to create API key.");
  }

  return {
    apiKey: generated.apiKey,
    key: mapRowToMetadata(row),
  };
}

export async function revokeActiveUserApiKey(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!normalizedUserId) {
    return false;
  }
  if (!normalizedOrganizationId) {
    return false;
  }

  await ensureTables();
  const rows = await db<{ id: string }[]>`
    UPDATE public.user_api_keys
    SET revoked_at = NOW()
    WHERE user_id = ${normalizedUserId}
      AND organization_id = ${normalizedOrganizationId}
      AND revoked_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

export async function authenticateUserApiKey(
  rawApiKey: string,
): Promise<UserApiKeyAuthResult | null> {
  const apiKey = normalizeApiKey(rawApiKey);
  if (!isPlausibleApiKey(apiKey)) {
    return null;
  }

  await ensureTables();
  const keyHash = hashApiKey(apiKey);
  const rows = await db<UserApiKeyRow[]>`
    SELECT id, user_id, organization_id, key_prefix, created_at, last_used_at
    FROM public.user_api_keys
    WHERE key_hash = ${keyHash}
      AND revoked_at IS NULL
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  await db`
    UPDATE public.user_api_keys
    SET last_used_at = NOW()
    WHERE id = ${row.id}
  `;

  return {
    keyId: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
  };
}

export async function authenticateUserApiKeyFromRequest(
  request: Request,
): Promise<UserApiKeyAuthResult | null> {
  const bearerToken = parseBearerToken(request.headers.get("authorization"));
  if (!bearerToken) {
    return null;
  }
  return authenticateUserApiKey(bearerToken);
}

export async function resolveFirstOrganizationIdForUser(
  userId: string,
): Promise<string | null> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return null;
  }

  const rows = await db<{ organization_id: string }[]>`
    SELECT m."organizationId" AS organization_id
    FROM public.member AS m
    WHERE m."userId" = ${normalizedUserId}
    ORDER BY m."createdAt" ASC
    LIMIT 1
  `;

  return rows[0]?.organization_id ?? null;
}
