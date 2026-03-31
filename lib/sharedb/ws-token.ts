import { SignJWT, jwtVerify } from "jose";

export type ShareDbWsTokenPermission = "view" | "edit";

export type ShareDbWsAccessClaims = {
  kind: "sharedb_ws_access";
  userId: string;
  docId: string;
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

const WS_TOKEN_SECRET =
  process.env.SHAREDB_WS_TOKEN_SECRET?.trim() ||
  process.env.SHAREDB_MCP_TOKEN_SECRET?.trim() ||
  null;
const WS_TOKEN_ISSUER =
  process.env.SHAREDB_WS_TOKEN_ISSUER?.trim() || "rowsncolumns-ws";
const WS_TOKEN_AUDIENCE =
  process.env.SHAREDB_WS_TOKEN_AUDIENCE?.trim() || "sharedb";

const encoder = new TextEncoder();

const getSigningSecret = (): Uint8Array | null => {
  if (!WS_TOKEN_SECRET) {
    return null;
  }
  return encoder.encode(WS_TOKEN_SECRET);
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

  const claims: ShareDbWsAccessClaims = {
    kind: "sharedb_ws_access",
    userId,
    docId,
    permission: input.permission === "view" ? "view" : "edit",
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    ...(normalizedName ? { name: normalizedName } : {}),
  };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(WS_TOKEN_ISSUER)
    .setAudience(WS_TOKEN_AUDIENCE)
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

  try {
    const verified = await jwtVerify(token, secret, {
      issuer: WS_TOKEN_ISSUER,
      audience: WS_TOKEN_AUDIENCE,
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
