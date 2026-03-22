import { db } from "@/lib/db/postgres";
import { INITIAL_CREDITS, MIN_CREDITS_PER_RUN } from "@/lib/credits/pricing";

export type UserCreditsRecord = {
  userId: string;
  balance: number;
  creditDay: string;
  createdAt: string;
  updatedAt: string;
};

type UserCreditsRow = {
  user_id: string;
  balance: number;
  credit_day: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type ChargeUserCreditsForRunInput = {
  userId: string;
  runId: string;
  requestedCredits: number;
  metadata?: Record<string, unknown>;
};

type ChargedCreditsResult = {
  chargedCredits: number;
  remainingCredits: number;
  alreadyCharged: boolean;
};

type RefillMode = "set" | "add";

type AdminRefillUserCreditsInput = {
  targetUserId: string;
  adminUserId: string;
  amount: number;
  mode: RefillMode;
  note?: string;
};

type AdminRefillUserCreditsResult = {
  userId: string;
  previousBalance: number;
  nextBalance: number;
  delta: number;
  creditDay: string;
  updatedAt: string;
};

const CHAT_RUN_REASON = "chat_run";
const ADMIN_REFILL_SET_REASON = "admin_refill_set";
const ADMIN_REFILL_ADD_REASON = "admin_refill_add";

const getCurrentUtcCreditDay = () => new Date().toISOString().slice(0, 10);

const toDateOnly = (value: Date | string) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
};

const mapCreditsRow = (row: UserCreditsRow): UserCreditsRecord => ({
  userId: row.user_id,
  balance: row.balance,
  creditDay: toDateOnly(row.credit_day),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const clampRequestedCredits = (value: number) => {
  if (!Number.isFinite(value)) return MIN_CREDITS_PER_RUN;
  return Math.max(MIN_CREDITS_PER_RUN, Math.floor(value));
};

const clampNonNegativeInteger = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

export async function ensureUserCredits(userId: string): Promise<void> {
  const currentCreditDay = getCurrentUtcCreditDay();

  await db`
    INSERT INTO user_credits (user_id, balance, credit_day)
    VALUES (${userId}, ${INITIAL_CREDITS}, ${currentCreditDay}::date)
    ON CONFLICT (user_id) DO NOTHING
  `;
}

export async function getUserCredits(userId: string): Promise<UserCreditsRecord> {
  await ensureUserCredits(userId);
  const currentCreditDay = getCurrentUtcCreditDay();

  const rows = await db<UserCreditsRow[]>`
    UPDATE user_credits
    SET
      balance = CASE
        WHEN credit_day IS DISTINCT FROM ${currentCreditDay}::date
          THEN ${INITIAL_CREDITS}
        ELSE balance
      END,
      credit_day = CASE
        WHEN credit_day IS DISTINCT FROM ${currentCreditDay}::date
          THEN ${currentCreditDay}::date
        ELSE credit_day
      END,
      updated_at = CASE
        WHEN credit_day IS DISTINCT FROM ${currentCreditDay}::date
          THEN NOW()
        ELSE updated_at
      END
    WHERE user_id = ${userId}
    RETURNING
      user_id,
      balance,
      credit_day,
      created_at,
      updated_at
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to load user credits.");
  }

  return mapCreditsRow(row);
}

export async function chargeUserCreditsForRun({
  userId,
  runId,
  requestedCredits,
  metadata = {},
}: ChargeUserCreditsForRunInput): Promise<ChargedCreditsResult> {
  const requested = clampRequestedCredits(requestedCredits);
  const metadataJson = JSON.stringify(metadata);
  const currentCreditDay = getCurrentUtcCreditDay();

  return db.begin(async (transaction) => {
    // `postgres` v3.4.x exposes a non-callable `TransactionSql` type, but the runtime
    // value is still the tagged-template sql client.
    const tx = transaction as unknown as typeof db;

    await tx`
      INSERT INTO user_credits (user_id, balance, credit_day)
      VALUES (${userId}, ${INITIAL_CREDITS}, ${currentCreditDay}::date)
      ON CONFLICT (user_id) DO NOTHING
    `;

    const existingRows = await tx<
      { delta: number; balance_after: number }[]
    >`
      SELECT
        delta,
        balance_after
      FROM credit_ledger
      WHERE user_id = ${userId}
        AND run_id = ${runId}
        AND reason = ${CHAT_RUN_REASON}
      LIMIT 1
    `;

    const existingRow = existingRows[0];
    if (existingRow) {
      return {
        chargedCredits: Math.max(0, -existingRow.delta),
        remainingCredits: existingRow.balance_after,
        alreadyCharged: true,
      };
    }

    const creditsRows = await tx<{ balance: number; credit_day: Date | string }[]>`
      SELECT
        balance,
        credit_day
      FROM user_credits
      WHERE user_id = ${userId}
      FOR UPDATE
    `;

    const creditRow = creditsRows[0];
    const shouldResetCredits =
      !creditRow || toDateOnly(creditRow.credit_day) !== currentCreditDay;
    const currentBalance = shouldResetCredits
      ? INITIAL_CREDITS
      : creditRow.balance;
    const chargedCredits = Math.min(currentBalance, requested);
    const remainingCredits = Math.max(0, currentBalance - chargedCredits);

    await tx`
      UPDATE user_credits
      SET
        balance = ${remainingCredits},
        credit_day = ${currentCreditDay}::date,
        updated_at = NOW()
      WHERE user_id = ${userId}
    `;

    await tx`
      INSERT INTO credit_ledger (
        id,
        user_id,
        run_id,
        delta,
        reason,
        metadata,
        balance_after
      )
      VALUES (
        ${crypto.randomUUID()},
        ${userId},
        ${runId},
        ${-chargedCredits},
        ${CHAT_RUN_REASON},
        ${metadataJson}::jsonb,
        ${remainingCredits}
      )
    `;

    return {
      chargedCredits,
      remainingCredits,
      alreadyCharged: false,
    };
  });
}

export async function adminRefillUserCredits({
  targetUserId,
  adminUserId,
  amount,
  mode,
  note,
}: AdminRefillUserCreditsInput): Promise<AdminRefillUserCreditsResult> {
  const userId = targetUserId.trim();
  if (!userId) {
    throw new Error("targetUserId is required.");
  }

  const normalizedAmount = clampNonNegativeInteger(amount);
  if (mode === "add" && normalizedAmount < 1) {
    throw new Error("amount must be at least 1 for add mode.");
  }

  const currentCreditDay = getCurrentUtcCreditDay();
  const reason = mode === "set" ? ADMIN_REFILL_SET_REASON : ADMIN_REFILL_ADD_REASON;
  const normalizedNote = note?.trim();

  return db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;

    await tx`
      INSERT INTO user_credits (user_id, balance, credit_day)
      VALUES (${userId}, ${INITIAL_CREDITS}, ${currentCreditDay}::date)
      ON CONFLICT (user_id) DO NOTHING
    `;

    const creditsRows = await tx<
      { balance: number; credit_day: Date | string }[]
    >`
      SELECT
        balance,
        credit_day
      FROM user_credits
      WHERE user_id = ${userId}
      FOR UPDATE
    `;

    const creditRow = creditsRows[0];
    const shouldResetCredits =
      !creditRow || toDateOnly(creditRow.credit_day) !== currentCreditDay;
    const previousBalance = shouldResetCredits ? INITIAL_CREDITS : creditRow.balance;

    const nextBalance =
      mode === "set"
        ? normalizedAmount
        : Math.max(0, previousBalance + normalizedAmount);
    const delta = nextBalance - previousBalance;

    const updatedRows = await tx<{ updated_at: Date | string }[]>`
      UPDATE user_credits
      SET
        balance = ${nextBalance},
        credit_day = ${currentCreditDay}::date,
        updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING updated_at
    `;

    await tx`
      INSERT INTO credit_ledger (
        id,
        user_id,
        delta,
        reason,
        metadata,
        balance_after
      )
      VALUES (
        ${crypto.randomUUID()},
        ${userId},
        ${delta},
        ${reason},
        ${JSON.stringify({
          adminUserId,
          mode,
          requestedAmount: normalizedAmount,
          note: normalizedNote || null,
          previousBalance,
        })}::jsonb,
        ${nextBalance}
      )
    `;

    return {
      userId,
      previousBalance,
      nextBalance,
      delta,
      creditDay: currentCreditDay,
      updatedAt: new Date(updatedRows[0]?.updated_at ?? new Date()).toISOString(),
    };
  });
}
