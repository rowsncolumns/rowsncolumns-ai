import { sendResendEmail } from "@/lib/email/resend";

const DEFAULT_APP_BASE_URL = "https://rowsncolumns.ai";
const DEFAULT_FROM_NAME = "RowsnColumns AI";
const DEFAULT_FROM_EMAIL = "noreply@rowsncolumns.ai";
const DEFAULT_WEEKLY_EMAILS_CRON = "TZ=UTC 0 9 * * 1";

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBooleanEnv = (value: string | undefined): boolean => {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const parsePositiveIntegerEnv = (value: string | undefined): number | null => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const parseCsvEmailList = (value: string | null): string[] => {
  if (!value) {
    return [];
  }

  const deduped = new Set<string>();
  for (const entry of value.split(",")) {
    const normalized = entry.trim().toLowerCase();
    if (normalized.length > 0) {
      deduped.add(normalized);
    }
  }

  return [...deduped];
};

const resolveAppBaseUrl = (): string => {
  const configured =
    normalizeOptionalString(process.env.APP_BASE_URL) ??
    normalizeOptionalString(process.env.BETTER_AUTH_URL) ??
    DEFAULT_APP_BASE_URL;

  try {
    const parsed = new URL(configured);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_APP_BASE_URL;
  }
};

export const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const resendApiKey = normalizeOptionalString(process.env.RESEND_API_KEY);
const resendFromName =
  normalizeOptionalString(process.env.RESEND_FROM_NAME) ?? DEFAULT_FROM_NAME;
const resendFromEmail =
  normalizeOptionalString(process.env.RESEND_FROM_EMAIL) ??
  normalizeOptionalString(process.env.EMAIL_FROM) ??
  DEFAULT_FROM_EMAIL;

const resendFrom = resendFromEmail.includes("<")
  ? resendFromEmail
  : `${resendFromName} <${resendFromEmail}>`;

const adminNotificationRecipients = parseCsvEmailList(
  normalizeOptionalString(process.env.RNC_ADMIN_NOTIFICATION_EMAILS) ??
    normalizeOptionalString(process.env.RNC_ADMIN_EMAILS),
);

const appBaseUrl = resolveAppBaseUrl();

const weeklyEmailsEnabled = parseBooleanEnv(process.env.RNC_WEEKLY_EMAILS_ENABLED);
const weeklyEmailsCron =
  normalizeOptionalString(process.env.RNC_WEEKLY_EMAILS_CRON) ??
  DEFAULT_WEEKLY_EMAILS_CRON;
const weeklyEmailsLimit = parsePositiveIntegerEnv(
  process.env.RNC_WEEKLY_EMAILS_LIMIT,
);

export type EmailRecipient = {
  email: string | null | undefined;
  name?: string | null | undefined;
};

type AdminNotificationInput = EmailRecipient & {
  id: string | null | undefined;
  createdAt?: string | Date | number | null | undefined;
};

export const getResendApiKey = () => resendApiKey;
export const getResendFrom = () => resendFrom;
export const getAppBaseUrl = () => appBaseUrl;
export const getAdminNotificationRecipients = () => adminNotificationRecipients;
export const isResendEmailConfigured = () => !!resendApiKey;
export const isWeeklyCheckInEmailEnabled = () => weeklyEmailsEnabled;
export const getWeeklyCheckInEmailCron = () => weeklyEmailsCron;
export const getWeeklyCheckInEmailLimit = () => weeklyEmailsLimit;

const resolveRecipientEmail = (
  recipient: Pick<EmailRecipient, "email">,
): string | null =>
  normalizeOptionalString(recipient.email)?.toLowerCase() ?? null;

const resolveRecipientName = (name: string | null | undefined) =>
  normalizeOptionalString(name);

const formatNameForGreeting = (name: string | null | undefined) => {
  const normalized = resolveRecipientName(name);
  if (!normalized) {
    return "there";
  }
  return normalized.split(/\s+/)[0] || "there";
};

export async function sendWelcomeEmailToUser(
  recipient: EmailRecipient,
): Promise<void> {
  if (!resendApiKey) {
    return;
  }

  const to = resolveRecipientEmail(recipient);
  if (!to) {
    return;
  }

  const greetingName = formatNameForGreeting(recipient.name);
  const sheetsUrl = `${appBaseUrl}/sheets`;
  const pricingUrl = `${appBaseUrl}/pricing`;
  const subject = "Welcome to RowsnColumns AI";
  const text = [
    `Hi ${greetingName},`,
    "",
    "Welcome to RowsnColumns AI.",
    "You can start creating spreadsheets instantly and collaborate with your team in real time.",
    "",
    `Open your workspace: ${sheetsUrl}`,
    `Explore plans: ${pricingUrl}`,
    "",
    "Reply to this email if you need help getting started.",
  ].join("\n");
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">',
    `<p>Hi ${escapeHtml(greetingName)},</p>`,
    "<p>Welcome to <strong>RowsnColumns AI</strong>.</p>",
    "<p>You can start creating spreadsheets instantly and collaborate with your team in real time.</p>",
    `<p><a href="${sheetsUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#ff6d34;color:#ffffff;text-decoration:none;font-weight:600">Open workspace</a></p>`,
    `<p>Need pricing details? <a href="${pricingUrl}">View plans</a>.</p>`,
    "<p>Reply to this email if you need help getting started.</p>",
    "</div>",
  ].join("");

  await sendResendEmail({
    apiKey: resendApiKey,
    from: resendFrom,
    to,
    subject,
    html,
    text,
  });
}

export async function sendAdminNewUserRegistrationEmail(
  input: AdminNotificationInput,
): Promise<void> {
  if (!resendApiKey || adminNotificationRecipients.length === 0) {
    return;
  }

  const email = resolveRecipientEmail(input);
  if (!email) {
    return;
  }

  const normalizedName = resolveRecipientName(input.name);
  const displayName = normalizedName || email;
  const createdAt =
    input.createdAt instanceof Date
      ? input.createdAt
      : input.createdAt
        ? new Date(input.createdAt)
        : new Date();
  const createdAtIso = Number.isNaN(createdAt.getTime())
    ? new Date().toISOString()
    : createdAt.toISOString();
  const usersSettingsUrl = `${appBaseUrl}/account/settings`;
  const subject = `New user registration: ${displayName}`;
  const text = [
    "A new user has registered.",
    "",
    `Name: ${displayName}`,
    `Email: ${email}`,
    `User ID: ${input.id ?? "unknown"}`,
    `Created at: ${createdAtIso}`,
    "",
    `Open app: ${usersSettingsUrl}`,
  ].join("\n");
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">',
    "<p>A new user has registered.</p>",
    `<p><strong>Name:</strong> ${escapeHtml(displayName)}<br/>`,
    `<strong>Email:</strong> ${escapeHtml(email)}<br/>`,
    `<strong>User ID:</strong> ${escapeHtml(input.id ?? "unknown")}<br/>`,
    `<strong>Created at:</strong> ${escapeHtml(createdAtIso)}</p>`,
    `<p><a href="${usersSettingsUrl}">Open app</a></p>`,
    "</div>",
  ].join("");

  await sendResendEmail({
    apiKey: resendApiKey,
    from: resendFrom,
    to: adminNotificationRecipients,
    subject,
    html,
    text,
  });
}

export async function sendWeeklyCheckInEmailToUser(
  recipient: EmailRecipient,
): Promise<void> {
  if (!resendApiKey) {
    return;
  }

  const to = resolveRecipientEmail(recipient);
  if (!to) {
    return;
  }

  const greetingName = formatNameForGreeting(recipient.name);
  const workspaceUrl = `${appBaseUrl}/sheets`;
  const templatesUrl = `${appBaseUrl}/templates`;
  const subject = "Your weekly RowsnColumns AI check-in";
  const text = [
    `Hi ${greetingName},`,
    "",
    "Here is your weekly reminder to keep momentum on your spreadsheets.",
    "",
    `Continue where you left off: ${workspaceUrl}`,
    `Explore templates: ${templatesUrl}`,
    "",
    "If you no longer want these emails, disable weekly sends in your deployment config.",
  ].join("\n");
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">',
    `<p>Hi ${escapeHtml(greetingName)},</p>`,
    "<p>Here is your weekly reminder to keep momentum on your spreadsheets.</p>",
    `<p><a href="${workspaceUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#ff6d34;color:#ffffff;text-decoration:none;font-weight:600">Continue in workspace</a></p>`,
    `<p>Need a fast starting point? <a href="${templatesUrl}">Browse templates</a>.</p>`,
    "<p style=\"font-size:12px;color:#6b7280\">If you no longer want these emails, disable weekly sends in your deployment config.</p>",
    "</div>",
  ].join("");

  await sendResendEmail({
    apiKey: resendApiKey,
    from: resendFrom,
    to,
    subject,
    html,
    text,
  });
}
