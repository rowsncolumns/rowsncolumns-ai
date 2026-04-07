import { SignJWT, jwtVerify } from "jose";

export type McpTokenPermission = "view" | "edit";

export type McpShareDbAccessClaims = {
  kind: "mcp_sharedb_access";
  docId: string;
  organizationId?: string;
  permission: McpTokenPermission;
};

const normalizeOptionalString = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const DEFAULT_TTL_SECONDS = 60 * 60;
const getMcpTokenConfig = () => ({
  secret: process.env.SHAREDB_MCP_TOKEN_SECRET?.trim() || null,
  issuer: process.env.SHAREDB_MCP_TOKEN_ISSUER?.trim() || "rowsncolumns-mcp",
  audience:
    process.env.SHAREDB_MCP_TOKEN_AUDIENCE?.trim() || "sharedb",
});

const encoder = new TextEncoder();

const getSigningSecret = (): Uint8Array | null => {
  const { secret } = getMcpTokenConfig();
  if (!secret) {
    return null;
  }
  return encoder.encode(secret);
};

export const canIssueMcpShareDbToken = (): boolean => {
  return getSigningSecret() !== null;
};

export async function issueMcpShareDbAccessToken(input: {
  docId: string;
  organizationId?: string | null;
  permission?: McpTokenPermission;
  ttlSeconds?: number;
}): Promise<string | null> {
  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const permission = input.permission ?? "edit";
  const organizationId = normalizeOptionalString(input.organizationId);
  const ttlSeconds =
    typeof input.ttlSeconds === "number" && input.ttlSeconds > 0
      ? input.ttlSeconds
      : DEFAULT_TTL_SECONDS;
  const { issuer, audience } = getMcpTokenConfig();

  return new SignJWT({
    kind: "mcp_sharedb_access",
    docId: input.docId,
    ...(organizationId ? { organizationId } : {}),
    permission,
  } satisfies McpShareDbAccessClaims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

export async function verifyMcpShareDbAccessToken(
  token: string,
): Promise<McpShareDbAccessClaims | null> {
  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }
  const { issuer, audience } = getMcpTokenConfig();

  try {
    const verified = await jwtVerify(token, secret, {
      issuer,
      audience,
    });
    const payload = verified.payload as Partial<McpShareDbAccessClaims>;
    if (
      payload.kind !== "mcp_sharedb_access" ||
      typeof payload.docId !== "string" ||
      payload.docId.trim().length === 0
    ) {
      return null;
    }
    const permission: McpTokenPermission =
      payload.permission === "view" ? "view" : "edit";

    return {
      kind: "mcp_sharedb_access",
      docId: payload.docId.trim(),
      ...(typeof payload.organizationId === "string" &&
      payload.organizationId.trim().length > 0
        ? { organizationId: payload.organizationId.trim() }
        : {}),
      permission,
    };
  } catch {
    return null;
  }
}
