import { db } from "@/lib/db/postgres";
import {
  type BillingPlanTier,
  normalizeBillingPlanTier,
} from "@/lib/billing/plans";

export type BillingSubscriptionStatus =
  | "active"
  | "canceling"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused"
  | string;

export type UserBillingProfileRecord = {
  userId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planTier: BillingPlanTier;
  subscriptionStatus: BillingSubscriptionStatus | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  trialGrantIssued: boolean;
  createdAt: string;
  updatedAt: string;
};

type BillingProfileRow = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_tier: string;
  subscription_status: string | null;
  trial_ends_at: Date | string | null;
  current_period_end: Date | string | null;
  trial_grant_issued: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

let ensureBillingSchemaPromise: Promise<void> | null = null;

const ensureBillingSchemaReady = async () => {
  if (ensureBillingSchemaPromise) {
    await ensureBillingSchemaPromise;
    return;
  }

  ensureBillingSchemaPromise = (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS user_billing_profile (
        user_id TEXT PRIMARY KEY,
        stripe_customer_id TEXT UNIQUE,
        stripe_subscription_id TEXT UNIQUE,
        plan_tier TEXT NOT NULL DEFAULT 'free',
        subscription_status TEXT,
        trial_ends_at TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        trial_grant_issued BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT user_billing_profile_plan_tier_check
          CHECK (plan_tier IN ('free', 'pro', 'max'))
      )
    `;
  })();

  try {
    await ensureBillingSchemaPromise;
  } catch (error) {
    ensureBillingSchemaPromise = null;
    throw error;
  }
};

const toIsoOrNull = (value: Date | string | null) => {
  if (!value) return null;
  return new Date(value).toISOString();
};

const mapBillingProfileRow = (
  row: BillingProfileRow,
): UserBillingProfileRecord => ({
  userId: row.user_id,
  stripeCustomerId: row.stripe_customer_id,
  stripeSubscriptionId: row.stripe_subscription_id,
  planTier: normalizeBillingPlanTier(row.plan_tier),
  subscriptionStatus: row.subscription_status,
  trialEndsAt: toIsoOrNull(row.trial_ends_at),
  currentPeriodEnd: toIsoOrNull(row.current_period_end),
  trialGrantIssued: row.trial_grant_issued,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const isPaidSubscriptionStatus = (
  status: string | null | undefined,
) => status === "active" || status === "canceling";

export async function getUserBillingProfile(
  userId: string,
): Promise<UserBillingProfileRecord | null> {
  await ensureBillingSchemaReady();
  const rows = await db<BillingProfileRow[]>`
    SELECT
      user_id,
      stripe_customer_id,
      stripe_subscription_id,
      plan_tier,
      subscription_status,
      trial_ends_at,
      current_period_end,
      trial_grant_issued,
      created_at,
      updated_at
    FROM user_billing_profile
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  const row = rows[0];
  return row ? mapBillingProfileRow(row) : null;
}

export async function getUserBillingProfileByStripeCustomerId(
  stripeCustomerId: string,
): Promise<UserBillingProfileRecord | null> {
  await ensureBillingSchemaReady();
  const rows = await db<BillingProfileRow[]>`
    SELECT
      user_id,
      stripe_customer_id,
      stripe_subscription_id,
      plan_tier,
      subscription_status,
      trial_ends_at,
      current_period_end,
      trial_grant_issued,
      created_at,
      updated_at
    FROM user_billing_profile
    WHERE stripe_customer_id = ${stripeCustomerId}
    LIMIT 1
  `;

  const row = rows[0];
  return row ? mapBillingProfileRow(row) : null;
}

export async function upsertStripeCustomerForUser(input: {
  userId: string;
  stripeCustomerId: string;
}) {
  await ensureBillingSchemaReady();
  const rows = await db<BillingProfileRow[]>`
    INSERT INTO user_billing_profile (
      user_id,
      stripe_customer_id
    )
    VALUES (
      ${input.userId},
      ${input.stripeCustomerId}
    )
    ON CONFLICT (user_id) DO UPDATE
      SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        updated_at = NOW()
    RETURNING
      user_id,
      stripe_customer_id,
      stripe_subscription_id,
      plan_tier,
      subscription_status,
      trial_ends_at,
      current_period_end,
      trial_grant_issued,
      created_at,
      updated_at
  `;

  return mapBillingProfileRow(rows[0]);
}

export async function upsertUserBillingSubscriptionState(input: {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  planTier: BillingPlanTier;
  subscriptionStatus: string | null;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
}) {
  await ensureBillingSchemaReady();
  const status = input.subscriptionStatus?.trim().toLowerCase() ?? null;
  const normalizedPlan = normalizeBillingPlanTier(input.planTier);
  const entitled = isPaidSubscriptionStatus(status);
  const resolvedPlan: BillingPlanTier = entitled ? normalizedPlan : "free";

  const rows = await db<BillingProfileRow[]>`
    INSERT INTO user_billing_profile (
      user_id,
      stripe_customer_id,
      stripe_subscription_id,
      plan_tier,
      subscription_status,
      trial_ends_at,
      current_period_end
    )
    VALUES (
      ${input.userId},
      ${input.stripeCustomerId},
      ${input.stripeSubscriptionId},
      ${resolvedPlan},
      ${status},
      ${input.trialEndsAt ?? null},
      ${input.currentPeriodEnd ?? null}
    )
    ON CONFLICT (user_id) DO UPDATE
      SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        plan_tier = EXCLUDED.plan_tier,
        subscription_status = EXCLUDED.subscription_status,
        trial_ends_at = EXCLUDED.trial_ends_at,
        current_period_end = EXCLUDED.current_period_end,
        updated_at = NOW(),
        trial_grant_issued = CASE
          WHEN user_billing_profile.stripe_subscription_id IS DISTINCT FROM EXCLUDED.stripe_subscription_id
            THEN FALSE
          ELSE user_billing_profile.trial_grant_issued
        END
    RETURNING
      user_id,
      stripe_customer_id,
      stripe_subscription_id,
      plan_tier,
      subscription_status,
      trial_ends_at,
      current_period_end,
      trial_grant_issued,
      created_at,
      updated_at
  `;

  return mapBillingProfileRow(rows[0]);
}

export async function markTrialGrantIssued(input: {
  userId: string;
  issued: boolean;
}) {
  await ensureBillingSchemaReady();
  await db`
    UPDATE user_billing_profile
    SET
      trial_grant_issued = ${input.issued},
      updated_at = NOW()
    WHERE user_id = ${input.userId}
  `;
}

export async function getUserBillingEntitlement(userId: string) {
  const profile = await getUserBillingProfile(userId);
  const rawSubscriptionStatus = profile?.subscriptionStatus ?? null;
  const isLegacyTrial = rawSubscriptionStatus === "trialing";
  const subscriptionStatus =
    isLegacyTrial ? "canceled" : rawSubscriptionStatus;
  const plan = profile?.planTier ?? "free";
  const hasPaidEntitlement = isPaidSubscriptionStatus(subscriptionStatus);

  return {
    plan: hasPaidEntitlement ? plan : "free",
    subscriptionStatus,
    trialEndsAt: isLegacyTrial ? null : (profile?.trialEndsAt ?? null),
    currentPeriodEnd: isLegacyTrial ? null : (profile?.currentPeriodEnd ?? null),
    stripeCustomerId: profile?.stripeCustomerId ?? null,
    stripeSubscriptionId: profile?.stripeSubscriptionId ?? null,
    trialGrantIssued: profile?.trialGrantIssued ?? false,
  } as const;
}
