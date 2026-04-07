import { SignJWT, jwtVerify } from "jose";

export type ShareDbWsTokenPermission = "view" | "edit";

export type ShareDbWsAccessClaims = {
  kind: "sharedb_ws_access";
  userId: string;
  docId: string;
  organizationId?: string;
  permission: ShareDbWsTokenPermission;
  email?: string | null;
  name?: string | null;
};

const DEFAULT_TTL_SECONDS = (() => {
  const parsed = Number.parseInt(
    process.env.SHAREDB_WS_TOKEN_TTL_SECONDS ?? "60",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
})();

const getWsTokenConfig = () => ({
  secret:
    process.env.SHAREDB_WS_TOKEN_SECRET?.trim() ||
    process.env.SHAREDB_MCP_TOKEN_SECRET?.trim() ||
    null,
  issuer: process.env.SHAREDB_WS_TOKEN_ISSUER?.trim() || "rowsncolumns-ws",
  audience: process.env.SHAREDB_WS_TOKEN_AUDIENCE?.trim() || "sharedb",
});

const encoder = new TextEncoder();

const getSigningSecret = (): Uint8Array | null => {
  const { secret } = getWsTokenConfig();
  if (!secret) {
    return null;
  }
  return encoder.encode(secret);
};

export const canIssueShareDbWsAccessToken = (): boolean => {
  return getSigningSecret() !== null;
};

const normalizeOptionalString = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export async function issueShareDbWsAccessToken(input: {
  userId: string;
  docId: string;
  organizationId?: string | null;
  permission: ShareDbWsTokenPermission;
  email?: string | null;
  name?: string | null;
  ttlSeconds?: number;
}): Promise<string | null> {
  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const userId = input.userId.trim();
  const docId = input.docId.trim();
  if (!userId || !docId) {
    return null;
  }

  const ttlSeconds =
    typeof input.ttlSeconds === "number" && input.ttlSeconds > 0
      ? input.ttlSeconds
      : DEFAULT_TTL_SECONDS;
  const normalizedEmail = normalizeOptionalString(input.email);
  const normalizedName = normalizeOptionalString(input.name);
  const normalizedOrganizationId = normalizeOptionalString(input.organizationId);
  const { issuer, audience } = getWsTokenConfig();

  const claims: ShareDbWsAccessClaims = {
    kind: "sharedb_ws_access",
    userId,
    docId,
    permission: input.permission === "view" ? "view" : "edit",
    ...(normalizedOrganizationId
      ? { organizationId: normalizedOrganizationId }
      : {}),
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    ...(normalizedName ? { name: normalizedName } : {}),
  };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

export async function verifyShareDbWsAccessToken(
  token: string,
): Promise<ShareDbWsAccessClaims | null> {
  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }
  const { issuer, audience } = getWsTokenConfig();

  try {
    const verified = await jwtVerify(token, secret, {
      issuer,
      audience,
    });
    const payload = verified.payload as Partial<ShareDbWsAccessClaims>;
    if (
      payload.kind !== "sharedb_ws_access" ||
      typeof payload.userId !== "string" ||
      payload.userId.trim().length === 0 ||
      typeof payload.docId !== "string" ||
      payload.docId.trim().length === 0
    ) {
      return null;
    }

    const permission: ShareDbWsTokenPermission =
      payload.permission === "view" ? "view" : "edit";

    return {
      kind: "sharedb_ws_access",
      userId: payload.userId.trim(),
      docId: payload.docId.trim(),
      permission,
      ...(typeof payload.organizationId === "string" &&
      payload.organizationId.trim().length > 0
        ? { organizationId: payload.organizationId.trim() }
        : {}),
      ...(typeof payload.email === "string" && payload.email.trim().length > 0
        ? { email: payload.email.trim() }
        : {}),
      ...(typeof payload.name === "string" && payload.name.trim().length > 0
        ? { name: payload.name.trim() }
        : {}),
    };
  } catch {
    return null;
  }
}
