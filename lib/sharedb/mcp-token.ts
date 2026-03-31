import { SignJWT, jwtVerify } from "jose";

export type McpTokenPermission = "view" | "edit";

export type McpShareDbAccessClaims = {
  kind: "mcp_sharedb_access";
  docId: string;
  permission: McpTokenPermission;
};

const DEFAULT_TTL_SECONDS = 60 * 60;
const MCP_TOKEN_SECRET = process.env.SHAREDB_MCP_TOKEN_SECRET?.trim() || null;
const MCP_TOKEN_ISSUER =
  process.env.SHAREDB_MCP_TOKEN_ISSUER?.trim() || "rowsncolumns-mcp";
const MCP_TOKEN_AUDIENCE =
  process.env.SHAREDB_MCP_TOKEN_AUDIENCE?.trim() || "sharedb";

const encoder = new TextEncoder();

const getSigningSecret = (): Uint8Array | null => {
  if (!MCP_TOKEN_SECRET) {
    return null;
  }
  return encoder.encode(MCP_TOKEN_SECRET);
};

export const canIssueMcpShareDbToken = (): boolean => {
  return getSigningSecret() !== null;
};

export async function issueMcpShareDbAccessToken(input: {
  docId: string;
  permission?: McpTokenPermission;
  ttlSeconds?: number;
}): Promise<string | null> {
  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const permission = input.permission ?? "edit";
  const ttlSeconds =
    typeof input.ttlSeconds === "number" && input.ttlSeconds > 0
      ? input.ttlSeconds
      : DEFAULT_TTL_SECONDS;

  return new SignJWT({
    kind: "mcp_sharedb_access",
    docId: input.docId,
    permission,
  } satisfies McpShareDbAccessClaims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(MCP_TOKEN_ISSUER)
    .setAudience(MCP_TOKEN_AUDIENCE)
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

  try {
    const verified = await jwtVerify(token, secret, {
      issuer: MCP_TOKEN_ISSUER,
      audience: MCP_TOKEN_AUDIENCE,
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
      permission,
    };
  } catch {
    return null;
  }
}
