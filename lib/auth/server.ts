import { headers as nextHeaders } from "next/headers";
import { betterAuth } from "better-auth";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "Missing required config: DATABASE_URL. Set it in .env.local.",
  );
}

const baseURL = process.env.BETTER_AUTH_URL?.trim();
if (!baseURL) {
  throw new Error(
    "Missing required config: BETTER_AUTH_URL. Set it in .env.local.",
  );
}

const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
if (!authSecret) {
  throw new Error(
    "Missing required config: BETTER_AUTH_SECRET. Set it in .env.local.",
  );
}

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

const socialProviders: Record<
  string,
  {
    clientId: string;
    clientSecret: string;
  }
> = {};

if (googleClientId && googleClientSecret) {
  socialProviders.google = {
    clientId: googleClientId,
    clientSecret: googleClientSecret,
  };
}

if (githubClientId && githubClientSecret) {
  socialProviders.github = {
    clientId: githubClientId,
    clientSecret: githubClientSecret,
  };
}

type PgPool = Pool;
declare global {
  var __rncAuthPgPool__: PgPool | undefined;
}

const globalForAuth = globalThis as typeof globalThis & {
  __rncAuthPgPool__?: PgPool;
};

const disableSsl = process.env.DATABASE_SSL_DISABLE?.trim() === "true";

const authPool =
  globalForAuth.__rncAuthPgPool__ ??
  new Pool({
    connectionString: databaseUrl,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  globalForAuth.__rncAuthPgPool__ = authPool;
}

const authInstance = betterAuth({
  baseURL,
  secret: authSecret,
  database: authPool,
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
      domain: "rowsncolumns.ai",
    },
  },
  ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
});

type AuthSessionPayload = Awaited<
  ReturnType<typeof authInstance.api.getSession>
>;

export const auth = Object.assign(authInstance, {
  async getSession(): Promise<{ data: AuthSessionPayload }> {
    const session = await authInstance.api.getSession({
      headers: await nextHeaders(),
    });
    return { data: session };
  },
});
