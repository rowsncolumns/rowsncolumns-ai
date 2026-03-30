export type BillingPlanTier = "free" | "pro" | "max";

export const BILLING_PLAN_TIERS: BillingPlanTier[] = ["free", "pro", "max"];

export const FREE_DAILY_CREDITS = 20;
export const PRO_MONTHLY_PRICE_USD = 35;
export const PRO_MONTHLY_CREDITS = 500;
export const MAX_MONTHLY_PRICE_USD = 200;
export const MAX_MONTHLY_CREDITS = 3500;
export const TOPUP_PRICE_USD = 50;
export const TOPUP_CREDITS = 800;

export const PLAN_MONTHLY_CREDITS: Record<Exclude<BillingPlanTier, "free">, number> = {
  pro: PRO_MONTHLY_CREDITS,
  max: MAX_MONTHLY_CREDITS,
};

const PLAN_MONTHLY_PRICE_USD: Record<Exclude<BillingPlanTier, "free">, number> = {
  pro: PRO_MONTHLY_PRICE_USD,
  max: MAX_MONTHLY_PRICE_USD,
};

export const resolvePlanMonthlyCredits = (tier: BillingPlanTier) => {
  if (tier === "free") return 0;
  return PLAN_MONTHLY_CREDITS[tier];
};

export const resolvePlanMonthlyPriceUsd = (tier: BillingPlanTier) => {
  if (tier === "free") return 0;
  return PLAN_MONTHLY_PRICE_USD[tier];
};

export const normalizeBillingPlanTier = (
  value: string | undefined | null,
): BillingPlanTier => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "pro" || normalized === "max") {
    return normalized;
  }
  return "free";
};
