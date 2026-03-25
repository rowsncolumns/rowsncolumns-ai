import { createNeonAuth } from "@neondatabase/auth/next/server";

const baseUrl = process.env.NEON_AUTH_BASE_URL;
if (!baseUrl) {
  throw new Error(
    "Missing required config: NEON_AUTH_BASE_URL. Set it in external/rnc.ai/.env.local.",
  );
}

const isProduction = process.env.NODE_ENV === "production";
const cookieSecret =
  process.env.NEON_AUTH_COOKIE_SECRET ||
  (isProduction
    ? undefined
    : "dev-neon-auth-cookie-secret-please-change-this-32-plus-chars");

if (!cookieSecret) {
  throw new Error(
    "Missing required config: NEON_AUTH_COOKIE_SECRET. Set it in external/rnc.ai/.env.local.",
  );
}

const cookieDomain = process.env.NEON_AUTH_COOKIE_DOMAIN; // e.g., '.rowsncolumns.ai'

export const auth = createNeonAuth({
  baseUrl,
  cookies: {
    secret: cookieSecret,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
});
