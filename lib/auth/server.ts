import { headers as nextHeaders } from "next/headers";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { Pool } from "pg";

import { sendResendEmail } from "@/lib/email/resend";
import {
  escapeHtml,
  getResendApiKey,
  getResendFrom,
  sendAdminNewUserRegistrationEmail,
  sendWelcomeEmailToUser,
} from "@/lib/email/user-notifications";

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

let baseUrlHostname: string | null = null;
try {
  baseUrlHostname = new URL(baseURL).hostname.toLowerCase();
} catch {
  throw new Error(
    "Invalid BETTER_AUTH_URL. Set a valid absolute URL in .env.local.",
  );
}

const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
if (!authSecret) {
  throw new Error(
    "Missing required config: BETTER_AUTH_SECRET. Set it in .env.local.",
  );
}

const resendApiKey = getResendApiKey();
const resendFrom = getResendFrom();

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID?.trim();
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
const microsoftTenantId = process.env.MICROSOFT_TENANT_ID?.trim();

const socialProviders: Record<
  string,
  {
    clientId: string;
    clientSecret: string;
    tenantId?: string;
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

if (microsoftClientId && microsoftClientSecret) {
  socialProviders.microsoft = {
    clientId: microsoftClientId,
    clientSecret: microsoftClientSecret,
    ...(microsoftTenantId ? { tenantId: microsoftTenantId } : {}),
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
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await sendWelcomeEmailToUser({
              email: user.email,
              name: user.name,
            });
          } catch (error) {
            console.error("Failed to send welcome email.", error);
          }

          try {
            await sendAdminNewUserRegistrationEmail({
              id: user.id,
              email: user.email,
              name: user.name,
              createdAt: user.createdAt,
            });
          } catch (error) {
            console.error(
              "Failed to send admin new-user notification email.",
              error,
            );
          }
        },
      },
    },
  },
  plugins: [
    organization({
      sendInvitationEmail: async (data) => {
        if (!resendApiKey) {
          console.warn(
            "RESEND_API_KEY is not configured; skipping organization invitation email.",
          );
          return;
        }

        try {
          const invitationUrl = new URL(
            `/organization/accept-invitation?id=${encodeURIComponent(data.id)}`,
            baseURL,
          ).toString();
          const organizationName =
            data.organization?.name?.trim() || "your organization";
          const organizationNameHtml = escapeHtml(organizationName);
          const inviterName =
            data.inviter?.user?.name?.trim() ||
            data.inviter?.user?.email?.trim() ||
            "A team admin";
          const roleLabel = data.role === "admin" ? "Admin" : "Member";

          const subject = `${inviterName} invited you to join ${organizationName}`;
          const text = [
            `You were invited to join ${organizationName} as ${roleLabel}.`,
            "",
            `Accept invitation: ${invitationUrl}`,
            "",
            "If you did not expect this invitation, you can ignore this email.",
          ].join("\n");
          const html = [
            '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">',
            `<p>You were invited to join <strong>${organizationNameHtml}</strong> as <strong>${roleLabel}</strong>.</p>`,
            `<p><a href="${invitationUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#ff6d34;color:#ffffff;text-decoration:none;font-weight:600">Accept invitation</a></p>`,
            `<p style="word-break:break-all">If the button doesn't work, use this link:<br/><a href="${invitationUrl}">${invitationUrl}</a></p>`,
            "<p>If you did not expect this invitation, you can ignore this email.</p>",
            "</div>",
          ].join("");

          await sendResendEmail({
            apiKey: resendApiKey,
            from: resendFrom,
            to: data.email,
            subject,
            html,
            text,
          });
        } catch (error) {
          console.error(
            "Failed to send organization invitation email via Resend.",
            error,
          );
        }
      },
    }),
  ],
  account: {
    accountLinking: {
      trustedProviders: ["google", "github", "microsoft"],
    },
  },
  advanced:
    baseUrlHostname === "rowsncolumns.ai" ||
    baseUrlHostname.endsWith(".rowsncolumns.ai")
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: ".rowsncolumns.ai",
          },
        }
      : undefined,
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
