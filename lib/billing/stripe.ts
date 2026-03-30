import Stripe from "stripe";

import {
  normalizeBillingPlanTier,
  type BillingPlanTier,
} from "@/lib/billing/plans";

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
export const STRIPE_BILLING_PORTAL_CONFIGURATION_ID =
  process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID?.trim() ?? "";

const STRIPE_PRICE_LOOKUP_KEY_PRO_MONTHLY =
  process.env.STRIPE_PRICE_LOOKUP_KEY_PRO_MONTHLY?.trim() || "pro_monthly";
const STRIPE_PRICE_LOOKUP_KEY_MAX_MONTHLY =
  process.env.STRIPE_PRICE_LOOKUP_KEY_MAX_MONTHLY?.trim() || "max_monthly";
const STRIPE_PRICE_LOOKUP_KEY_TOPUP_50 =
  process.env.STRIPE_PRICE_LOOKUP_KEY_TOPUP_50?.trim() || "topup_50";

type PriceLookupKey = "pro" | "max" | "topup";

const PRICE_LOOKUP_KEYS: Record<PriceLookupKey, string> = {
  pro: STRIPE_PRICE_LOOKUP_KEY_PRO_MONTHLY,
  max: STRIPE_PRICE_LOOKUP_KEY_MAX_MONTHLY,
  topup: STRIPE_PRICE_LOOKUP_KEY_TOPUP_50,
};

const stripePriceCache = new Map<PriceLookupKey, Stripe.Price>();

let stripeClient: Stripe | null = null;

export const getStripeClient = () => {
  if (stripeClient) return stripeClient;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecretKey) {
    throw new Error(
      "Missing required config: STRIPE_SECRET_KEY. Set it in your runtime environment.",
    );
  }

  stripeClient = new Stripe(stripeSecretKey, {
    // Use latest version supported by the installed Stripe SDK.
    apiVersion: "2026-03-25.dahlia",
  });
  return stripeClient;
};

const resolveLookupKey = (key: PriceLookupKey) => PRICE_LOOKUP_KEYS[key];

export async function getStripePriceByLookupKey(
  key: PriceLookupKey,
): Promise<Stripe.Price> {
  const cached = stripePriceCache.get(key);
  if (cached) return cached;

  const lookupKey = resolveLookupKey(key);
  const response = await getStripeClient().prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });

  const price = response.data[0];
  if (!price) {
    throw new Error(`Stripe price lookup key '${lookupKey}' was not found.`);
  }

  stripePriceCache.set(key, price);
  return price;
}

export async function getStripeSubscriptionPriceIds() {
  const [proPrice, maxPrice] = await Promise.all([
    getStripePriceByLookupKey("pro"),
    getStripePriceByLookupKey("max"),
  ]);

  return {
    pro: proPrice.id,
    max: maxPrice.id,
  } as const;
}

export async function resolvePlanTierFromStripePriceId(priceId: string) {
  const ids = await getStripeSubscriptionPriceIds();
  if (priceId === ids.pro) return "pro";
  if (priceId === ids.max) return "max";
  return "free";
}

export async function resolvePlanTierFromStripeSubscription(
  subscription: Stripe.Subscription,
): Promise<BillingPlanTier> {
  const firstItem = subscription.items?.data?.[0];
  const itemPriceId = firstItem?.price?.id ?? null;
  if (!itemPriceId) {
    return normalizeBillingPlanTier(subscription.metadata?.plan_tier);
  }

  const mappedFromPrice = await resolvePlanTierFromStripePriceId(itemPriceId);
  if (mappedFromPrice !== "free") {
    return mappedFromPrice;
  }

  return normalizeBillingPlanTier(subscription.metadata?.plan_tier);
}
