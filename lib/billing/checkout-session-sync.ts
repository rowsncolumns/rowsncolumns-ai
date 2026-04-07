import type Stripe from "stripe";

import {
  getOrganizationBillingEntitlement,
  getOrganizationBillingProfileByStripeCustomerId,
  upsertOrganizationBillingSubscriptionState,
  upsertStripeCustomerForOrganization,
} from "@/lib/billing/repository";
import { TOPUP_CREDITS } from "@/lib/billing/plans";
import {
  getStripeClient,
  resolvePlanTierFromStripeSubscription,
} from "@/lib/billing/stripe";
import { grantOrganizationCreditsFromBillingEvent } from "@/lib/credits/repository";

type SyncCheckoutSessionInput = {
  userId: string;
  orgId: string;
  checkoutSessionId: string;
};

const unixToIsoOrNull = (value: number | null | undefined) => {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
};

const resolveSubscriptionCurrentPeriodEnd = (
  subscription: Stripe.Subscription,
) => {
  const firstItem = subscription.items.data[0];
  if (!firstItem || !Number.isFinite(firstItem.current_period_end)) {
    return null;
  }
  return new Date(firstItem.current_period_end * 1000).toISOString();
};

const resolveEffectiveSubscriptionState = async (
  subscription: Stripe.Subscription,
) => {
  const mappedTier = await resolvePlanTierFromStripeSubscription(subscription);
  const isTrialing = subscription.status === "trialing";
  const hasScheduledCancelAt =
    typeof subscription.cancel_at === "number" &&
    subscription.cancel_at > 0 &&
    !subscription.canceled_at;
  const isCancelingAtPeriodEnd =
    subscription.status === "active" &&
    (subscription.cancel_at_period_end || hasScheduledCancelAt);

  if (isTrialing) {
    return {
      planTier: "free" as const,
      subscriptionStatus: "canceled",
      trialEndsAt: null,
      currentPeriodEnd: null,
    };
  }

  if (isCancelingAtPeriodEnd) {
    return {
      planTier: mappedTier,
      subscriptionStatus: "canceling",
      trialEndsAt: null,
      currentPeriodEnd: resolveSubscriptionCurrentPeriodEnd(subscription),
    };
  }

  return {
    planTier: mappedTier,
    subscriptionStatus: subscription.status,
    trialEndsAt: unixToIsoOrNull(subscription.trial_end),
    currentPeriodEnd: resolveSubscriptionCurrentPeriodEnd(subscription),
  };
};

const parseStripeCustomerId = (
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null,
) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id;
};

const resolveSessionUserId = (session: Stripe.Checkout.Session) =>
  session.client_reference_id?.trim() ||
  session.metadata?.user_id?.trim() ||
  null;

const resolveSessionOrgId = (session: Stripe.Checkout.Session) =>
  session.metadata?.org_id?.trim() || null;

const syncSubscriptionStateForOrganization = async (input: {
  orgId: string;
  ownerUserId: string;
  stripeCustomerId: string;
  subscription: Stripe.Subscription;
}) => {
  const effective = await resolveEffectiveSubscriptionState(input.subscription);
  await upsertOrganizationBillingSubscriptionState({
    organizationId: input.orgId,
    ownerUserId: input.ownerUserId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.subscription.id,
    planTier: effective.planTier,
    subscriptionStatus: effective.subscriptionStatus,
    trialEndsAt: effective.trialEndsAt,
    currentPeriodEnd: effective.currentPeriodEnd,
  });

  return effective;
};

export async function syncCheckoutSessionForOrganization({
  userId,
  orgId,
  checkoutSessionId,
}: SyncCheckoutSessionInput) {
  const normalizedSessionId = checkoutSessionId.trim();
  if (!normalizedSessionId) return;

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(normalizedSessionId, {
    expand: ["subscription"],
  });
  const sessionUserId = resolveSessionUserId(session);
  const sessionOrgId = resolveSessionOrgId(session);

  if (sessionUserId && sessionUserId !== userId) {
    throw new Error("Checkout session does not belong to the current user.");
  }
  if (sessionOrgId && sessionOrgId !== orgId) {
    throw new Error(
      "Checkout session does not belong to the active organization.",
    );
  }

  const stripeCustomerId = parseStripeCustomerId(session.customer ?? null);
  if (stripeCustomerId) {
    const owner =
      await getOrganizationBillingProfileByStripeCustomerId(stripeCustomerId);
    if (owner && owner.organizationId !== orgId) {
      throw new Error("Stripe customer is linked to a different organization.");
    }

    await upsertStripeCustomerForOrganization({
      organizationId: orgId,
      ownerUserId: userId,
      stripeCustomerId,
    });
  }

  if (session.mode === "payment") {
    if (session.metadata?.kind !== "topup" || session.payment_status !== "paid") {
      return;
    }

    await grantOrganizationCreditsFromBillingEvent({
      organizationId: orgId,
      amount: TOPUP_CREDITS,
      reason: "topup_purchase_grant",
      idempotencyKey: `topup:${session.id}`,
      metadata: {
        source: "checkout_return_sync",
        checkoutSessionId: session.id,
        customerId: stripeCustomerId,
        orgId,
        userId,
      },
    });
    return;
  }

  if (session.mode !== "subscription" || !stripeCustomerId) {
    return;
  }

  const sessionSubscription = session.subscription;
  const subscription =
    typeof sessionSubscription === "string"
      ? await stripe.subscriptions.retrieve(sessionSubscription)
      : sessionSubscription;

  if (!subscription) {
    return;
  }

  const effective = await syncSubscriptionStateForOrganization({
    orgId,
    ownerUserId: userId,
    stripeCustomerId,
    subscription,
  });
  if (effective.planTier === "free") return;
}

export async function syncBillingProfileFromStripeForOrganization(orgId: string) {
  const entitlement = await getOrganizationBillingEntitlement(orgId);
  const stripeCustomerId = entitlement.stripeCustomerId;
  if (!stripeCustomerId) return;

  const stripe = getStripeClient();

  let subscription: Stripe.Subscription | null = null;
  if (entitlement.stripeSubscriptionId) {
    try {
      subscription = await stripe.subscriptions.retrieve(
        entitlement.stripeSubscriptionId,
      );
    } catch {
      subscription = null;
    }
  }

  if (!subscription) {
    const listed = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      limit: 10,
    });
    subscription =
      listed.data.find((item) => item.status !== "incomplete_expired") ??
      listed.data[0] ??
      null;
  }

  const owner = await getOrganizationBillingProfileByStripeCustomerId(
    stripeCustomerId,
  );
  const ownerUserId = owner?.ownerUserId ?? "unknown";

  if (!subscription) {
    await upsertOrganizationBillingSubscriptionState({
      organizationId: orgId,
      ownerUserId,
      stripeCustomerId,
      stripeSubscriptionId: null,
      planTier: "free",
      subscriptionStatus: "canceled",
      trialEndsAt: null,
      currentPeriodEnd: null,
    });
    return;
  }

  await syncSubscriptionStateForOrganization({
    orgId,
    ownerUserId,
    stripeCustomerId,
    subscription,
  });
}
