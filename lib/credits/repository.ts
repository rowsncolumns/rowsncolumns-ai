import { getUserBillingEntitlement } from "@/lib/billing/repository";
import { db } from "@/lib/db/postgres";
import {
  chargeFromBuckets,
  getAvailableCredits,
  resolveDailyFreeBucketForDay,
  type CreditBuckets,
} from "@/lib/credits/buckets";
import { INITIAL_CREDITS, MIN_CREDITS_PER_RUN } from "@/lib/credits/pricing";

export type UserCreditsRecord = {
  userId: string;
  balance: number;
  availableCredits: number;
  dailyFreeRemaining: number;
  paidBalance: number;
  creditDay: string;
  createdAt: string;
  updatedAt: string;
};

type UserCreditsRow = {
  user_id: string;
  balance: number;
  daily_free_remaining: number;
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

export type BillingGrantReason =
  | "subscription_trial_grant"
  | "subscription_cycle_grant"
  | "topup_purchase_grant";

type GrantCreditsFromBillingInput = {
  userId: string;
  amount: number;
  reason: BillingGrantReason;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

type GrantCreditsFromBillingResult = {
  applied: boolean;
  amount: number;
  nextBalance: number;
  nextAvailableCredits: number;
};

const CHAT_RUN_REASON = "chat_run";
const ADMIN_REFILL_SET_REASON = "admin_refill_set";
const ADMIN_REFILL_ADD_REASON = "admin_refill_add";
let ensureCreditSchemaPromise: Promise<void> | null = null;

const getCurrentUtcCreditDay = () => new Date().toISOString().slice(0, 10);

const toDateOnly = (value: Date | string) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
};

const clampRequestedCredits = (value: number) => {
  if (!Number.isFinite(value)) return MIN_CREDITS_PER_RUN;
  return Math.max(MIN_CREDITS_PER_RUN, Math.floor(value));
};

const clampNonNegativeInteger = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

const ensureCreditSchemaReady = async () => {
  if (ensureCreditSchemaPromise) {
    await ensureCreditSchemaPromise;
    return;
  }

  ensureCreditSchemaPromise = (async () => {
    await db`
      ALTER TABLE public.user_credits
      ADD COLUMN IF NOT EXISTS daily_free_remaining INTEGER
    `;

    await db`
      UPDATE public.user_credits
      SET
        daily_free_remaining = LEAST(balance, ${INITIAL_CREDITS}),
        balance = GREATEST(balance - LEAST(balance, ${INITIAL_CREDITS}), 0)
      WHERE daily_free_remaining IS NULL
    `;

    await db`
      ALTER TABLE public.user_credits
      ALTER COLUMN balance SET DEFAULT 0
    `;

    await db.unsafe(
      `ALTER TABLE public.user_credits ALTER COLUMN daily_free_remaining SET DEFAULT ${INITIAL_CREDITS}`,
    );

    await db`
      UPDATE public.user_credits
      SET daily_free_remaining = ${INITIAL_CREDITS}
      WHERE daily_free_remaining IS NULL
    `;

    await db`
      ALTER TABLE public.user_credits
      ALTER COLUMN daily_free_remaining SET NOT NULL
    `;
  })();

  try {
    await ensureCreditSchemaPromise;
  } catch (error) {
    ensureCreditSchemaPromise = null;
    throw error;
  }
};

const toBuckets = (row: Pick<UserCreditsRow, "balance" | "daily_free_remaining">): CreditBuckets => ({
  dailyFreeRemaining: clampNonNegativeInteger(row.daily_free_remaining),
  paidBalance: clampNonNegativeInteger(row.balance),
});

const resolveBucketsForCurrentDay = (input: {
  row: Pick<UserCreditsRow, "balance" | "daily_free_remaining" | "credit_day">;
  currentCreditDay: string;
  usesDailyFreeBucket: boolean;
}): CreditBuckets => {
  const base = toBuckets(input.row);
  const sameDay = toDateOnly(input.row.credit_day) === input.currentCreditDay;

  return {
    dailyFreeRemaining: resolveDailyFreeBucketForDay({
      usesDailyFreeBucket: input.usesDailyFreeBucket,
      isSameCreditDay: sameDay,
      currentDailyFreeRemaining: base.dailyFreeRemaining,
      freeDailyResetAmount: INITIAL_CREDITS,
    }),
    paidBalance: base.paidBalance,
  };
};

const mapCreditsRow = (
  row: UserCreditsRow,
  usesDailyFreeBucket: boolean,
): UserCreditsRecord => {
  const dailyFreeRemaining = usesDailyFreeBucket
    ? clampNonNegativeInteger(row.daily_free_remaining)
    : 0;
  const paidBalance = clampNonNegativeInteger(row.balance);
  const availableCredits = dailyFreeRemaining + paidBalance;

  return {
    userId: row.user_id,
    balance: availableCredits,
    availableCredits,
    dailyFreeRemaining,
    paidBalance,
    creditDay: toDateOnly(row.credit_day),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
};

export async function ensureUserCredits(userId: string): Promise<void> {
  await ensureCreditSchemaReady();
  const currentCreditDay = getCurrentUtcCreditDay();

  await db`
    INSERT INTO public.user_credits (user_id, balance, daily_free_remaining, credit_day)
    VALUES (${userId}, 0, ${INITIAL_CREDITS}, ${currentCreditDay}::date)
    ON CONFLICT (user_id) DO NOTHING
  `;
}

export async function getUserCredits(userId: string): Promise<UserCreditsRecord> {
  await ensureUserCredits(userId);
  const currentCreditDay = getCurrentUtcCreditDay();
  const entitlement = await getUserBillingEntitlement(userId);
  const usesDailyFreeBucket = entitlement.plan === "free";

  const rows = await db<UserCreditsRow[]>`
    UPDATE public.user_credits
    SET
      daily_free_remaining = CASE
        WHEN ${usesDailyFreeBucket} = FALSE THEN 0
        WHEN credit_day IS DISTINCT FROM ${currentCreditDay}::date
          THEN ${INITIAL_CREDITS}
        ELSE daily_free_remaining
      END,
      credit_day = ${currentCreditDay}::date,
      updated_at = CASE
        WHEN ${usesDailyFreeBucket} = FALSE AND daily_free_remaining <> 0
          THEN NOW()
        WHEN ${usesDailyFreeBucket} = TRUE
          AND credit_day IS DISTINCT FROM ${currentCreditDay}::date
          THEN NOW()
        ELSE updated_at
      END
    WHERE user_id = ${userId}
    RETURNING
      user_id,
      balance,
      daily_free_remaining,
      credit_day,
      created_at,
      updated_at
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to load user credits.");
  }

  return mapCreditsRow(row, usesDailyFreeBucket);
}

export async function chargeUserCreditsForRun({
  userId,
  runId,
  requestedCredits,
  metadata = {},
}: ChargeUserCreditsForRunInput): Promise<ChargedCreditsResult> {
  await ensureCreditSchemaReady();
  const requested = clampRequestedCredits(requestedCredits);
  const currentCreditDay = getCurrentUtcCreditDay();
  const entitlement = await getUserBillingEntitlement(userId);
  const usesDailyFreeBucket = entitlement.plan === "free";

  return db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;

    await tx`
      INSERT INTO public.user_credits (user_id, balance, daily_free_remaining, credit_day)
      VALUES (${userId}, 0, ${INITIAL_CREDITS}, ${currentCreditDay}::date)
      ON CONFLICT (user_id) DO NOTHING
    `;

    const existingRows = await tx<
      { delta: number; balance_after: number }[]
    >`
      SELECT
        delta,
        balance_after
      FROM public.credit_ledger
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

    const creditsRows = await tx<UserCreditsRow[]>`
      SELECT
        user_id,
        balance,
        daily_free_remaining,
        credit_day,
        created_at,
        updated_at
      FROM public.user_credits
      WHERE user_id = ${userId}
      FOR UPDATE
    `;

    const creditRow = creditsRows[0];
    if (!creditRow) {
      throw new Error("Failed to lock user credits row.");
    }

    const buckets = resolveBucketsForCurrentDay({
      row: creditRow,
      currentCreditDay,
      usesDailyFreeBucket,
    });

    const charged = chargeFromBuckets({
      requestedCredits: requested,
      buckets,
      useDailyFreeBucket: usesDailyFreeBucket,
    });

    const remainingCredits = getAvailableCredits(charged.buckets);

    await tx`
      UPDATE public.user_credits
      SET
        balance = ${charged.buckets.paidBalance},
        daily_free_remaining = ${charged.buckets.dailyFreeRemaining},
        credit_day = ${currentCreditDay}::date,
        updated_at = NOW()
      WHERE user_id = ${userId}
    `;

    await tx`
      INSERT INTO public.credit_ledger (
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
        ${-charged.chargedCredits},
        ${CHAT_RUN_REASON},
        ${JSON.stringify({
          ...metadata,
          chargedFromDailyFree: charged.chargedFromDailyFree,
          chargedFromPaid: charged.chargedFromPaid,
          requestedCredits: requested,
          billingPlan: entitlement.plan,
        })}::jsonb,
        ${remainingCredits}
      )
    `;

    return {
      chargedCredits: charged.chargedCredits,
      remainingCredits,
      alreadyCharged: false,
    };
  });
}

export async function grantUserCreditsFromBillingEvent(
  input: GrantCreditsFromBillingInput,
): Promise<GrantCreditsFromBillingResult> {
  await ensureCreditSchemaReady();
  const currentCreditDay = getCurrentUtcCreditDay();
  const amount = clampNonNegativeInteger(input.amount);
  if (amount < 1) {
    throw new Error("Grant amount must be at least 1.");
  }
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotencyKey is required.");
  }

  const entitlement = await getUserBillingEntitlement(input.userId);
  const usesDailyFreeBucket = entitlement.plan === "free";

  return db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;

    await tx`
      INSERT INTO public.user_credits (user_id, balance, daily_free_remaining, credit_day)
      VALUES (${input.userId}, 0, ${INITIAL_CREDITS}, ${currentCreditDay}::date)
      ON CONFLICT (user_id) DO NOTHING
    `;

    const existingRows = await tx<{ balance_after: number }[]>`
      SELECT
        balance_after
      FROM public.credit_ledger
      WHERE user_id = ${input.userId}
        AND run_id = ${input.idempotencyKey}
        AND reason = ${input.reason}
      LIMIT 1
    `;

    const existingRow = existingRows[0];
    if (existingRow) {
      const currentRows = await tx<UserCreditsRow[]>`
        SELECT
          user_id,
          balance,
          daily_free_remaining,
          credit_day,
          created_at,
          updated_at
        FROM public.user_credits
        WHERE user_id = ${input.userId}
        LIMIT 1
      `;
      const current = currentRows[0];
      const normalizedBuckets = current
        ? resolveBucketsForCurrentDay({
            row: current,
            currentCreditDay,
            usesDailyFreeBucket,
          })
        : { dailyFreeRemaining: 0, paidBalance: existingRow.balance_after };

      return {
        applied: false,
        amount,
        nextBalance: normalizedBuckets.paidBalance,
        nextAvailableCredits: getAvailableCredits(normalizedBuckets),
      };
    }

    const creditsRows = await tx<UserCreditsRow[]>`
      SELECT
        user_id,
        balance,
        daily_free_remaining,
        credit_day,
        created_at,
        updated_at
      FROM public.user_credits
      WHERE user_id = ${input.userId}
      FOR UPDATE
    `;
    const row = creditsRows[0];
    if (!row) {
      throw new Error("Failed to lock user credits row.");
    }

    const buckets = resolveBucketsForCurrentDay({
      row,
      currentCreditDay,
      usesDailyFreeBucket,
    });

    const nextBuckets: CreditBuckets = {
      dailyFreeRemaining: buckets.dailyFreeRemaining,
      paidBalance: buckets.paidBalance + amount,
    };
    const nextAvailableCredits = getAvailableCredits(nextBuckets);

    await tx`
      UPDATE public.user_credits
      SET
        balance = ${nextBuckets.paidBalance},
        daily_free_remaining = ${nextBuckets.dailyFreeRemaining},
        credit_day = ${currentCreditDay}::date,
        updated_at = NOW()
      WHERE user_id = ${input.userId}
    `;

    await tx`
      INSERT INTO public.credit_ledger (
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
        ${input.userId},
        ${input.idempotencyKey},
        ${amount},
        ${input.reason},
        ${JSON.stringify(input.metadata ?? {})}::jsonb,
        ${nextAvailableCredits}
      )
    `;

    return {
      applied: true,
      amount,
      nextBalance: nextBuckets.paidBalance,
      nextAvailableCredits,
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
  await ensureCreditSchemaReady();
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

  const entitlement = await getUserBillingEntitlement(userId);
  const usesDailyFreeBucket = entitlement.plan === "free";

  return db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;

    await tx`
      INSERT INTO public.user_credits (user_id, balance, daily_free_remaining, credit_day)
      VALUES (${userId}, 0, ${INITIAL_CREDITS}, ${currentCreditDay}::date)
      ON CONFLICT (user_id) DO NOTHING
    `;

    const creditsRows = await tx<UserCreditsRow[]>`
      SELECT
        user_id,
        balance,
        daily_free_remaining,
        credit_day,
        created_at,
        updated_at
      FROM public.user_credits
      WHERE user_id = ${userId}
      FOR UPDATE
    `;

    const creditRow = creditsRows[0];
    if (!creditRow) {
      throw new Error("Failed to lock user credits row.");
    }

    const currentBuckets = resolveBucketsForCurrentDay({
      row: creditRow,
      currentCreditDay,
      usesDailyFreeBucket,
    });
    const previousBalance = currentBuckets.paidBalance;
    const nextBalance =
      mode === "set"
        ? normalizedAmount
        : Math.max(0, previousBalance + normalizedAmount);
    const delta = nextBalance - previousBalance;
    const nextBuckets: CreditBuckets = {
      dailyFreeRemaining: currentBuckets.dailyFreeRemaining,
      paidBalance: nextBalance,
    };
    const nextAvailableCredits = getAvailableCredits(nextBuckets);

    const updatedRows = await tx<{ updated_at: Date | string }[]>`
      UPDATE public.user_credits
      SET
        balance = ${nextBuckets.paidBalance},
        daily_free_remaining = ${nextBuckets.dailyFreeRemaining},
        credit_day = ${currentCreditDay}::date,
        updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING updated_at
    `;

    await tx`
      INSERT INTO public.credit_ledger (
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
          previousDailyFreeRemaining: currentBuckets.dailyFreeRemaining,
        })}::jsonb,
        ${nextAvailableCredits}
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
