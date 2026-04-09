import { db } from "@/lib/db/postgres";
import {
  getWeeklyCheckInEmailCron,
  getWeeklyCheckInEmailLimit,
  isResendEmailConfigured,
  isWeeklyCheckInEmailEnabled,
  sendWeeklyCheckInEmailToUser,
} from "@/lib/email/user-notifications";
import { inngest } from "@/lib/inngest/client";

type WeeklyEmailUserRow = {
  id: string;
  email: string | null;
  name: string | null;
};

type WeeklyEmailUser = {
  id: string;
  email: string;
  name: string | null;
};

const normalizeOptionalString = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

async function listUsersForWeeklyEmail(
  limit: number | null,
): Promise<WeeklyEmailUser[]> {
  const rows = limit
    ? await db<WeeklyEmailUserRow[]>`
        SELECT id, email, name
        FROM public."user"
        WHERE COALESCE(NULLIF(BTRIM(email), ''), NULL) IS NOT NULL
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
      `
    : await db<WeeklyEmailUserRow[]>`
        SELECT id, email, name
        FROM public."user"
        WHERE COALESCE(NULLIF(BTRIM(email), ''), NULL) IS NOT NULL
        ORDER BY "createdAt" ASC
      `;

  return rows
    .map((row) => ({
      id: row.id,
      email: normalizeOptionalString(row.email)?.toLowerCase() ?? "",
      name: normalizeOptionalString(row.name),
    }))
    .filter((row) => row.email.length > 0);
}

export const sendWeeklyUserCheckInEmails = inngest.createFunction(
  {
    id: "emails-send-weekly-user-check-in",
    triggers: [{ cron: getWeeklyCheckInEmailCron() }],
  },
  async ({ step }) => {
    if (!isWeeklyCheckInEmailEnabled()) {
      return {
        ok: true,
        skipped: true,
        reason: "RNC_WEEKLY_EMAILS_ENABLED is false.",
      } as const;
    }

    if (!isResendEmailConfigured()) {
      return {
        ok: true,
        skipped: true,
        reason: "RESEND_API_KEY is not configured.",
      } as const;
    }

    const weeklyLimit = getWeeklyCheckInEmailLimit();
    const users = await step.run("load-users-for-weekly-check-in", async () =>
      listUsersForWeeklyEmail(weeklyLimit),
    );

    if (users.length === 0) {
      return {
        ok: true,
        skipped: true,
        reason: "No users with email found.",
      } as const;
    }

    const summary = await step.run(
      "send-weekly-check-in-emails",
      async () => {
        let sent = 0;
        let failed = 0;

        for (const user of users) {
          try {
            await sendWeeklyCheckInEmailToUser({
              email: user.email,
              name: user.name,
            });
            sent += 1;
          } catch (error) {
            failed += 1;
            console.error(
              `[email] failed weekly check-in for user ${user.id}`,
              error,
            );
          }
        }

        return {
          sent,
          failed,
        } as const;
      },
    );

    return {
      ok: true,
      processed: users.length,
      limit: weeklyLimit,
      ...summary,
    } as const;
  },
);
