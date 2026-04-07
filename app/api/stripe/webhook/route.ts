import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  getOrganizationBillingProfileByStripeCustomerId,
  upsertOrganizationBillingSubscriptionState,
  upsertStripeCustomerForOrganization,
} from "@/lib/billing/repository";
import {
  getStripeClient,
  resolvePlanTierFromStripeSubscription,
  STRIPE_WEBHOOK_SECRET,
} from "@/lib/billing/stripe";
import {
  hasProcessedStripeWebhookEvent,
  markStripeWebhookEventProcessed,
} from "@/lib/billing/webhook-events-repository";
import { resolvePlanMonthlyCredits, TOPUP_CREDITS } from "@/lib/billing/plans";
import { grantOrganizationCreditsFromBillingEvent } from "@/lib/credits/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unixToIsoOrNull = (value: number | null | undefined) => {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
};

const resolveSubscriptionCurrentPeriodEnd = (subscription: Stripe.Subscription) => {
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

const parseStripeCustomerId = (value: string | Stripe.Customer | Stripe.DeletedCustomer | null) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id;
};

type OrganizationCustomerContext = {
  organizationId: string;
  ownerUserId: string;
};

const resolveOrganizationForCustomer = async (
  stripeCustomerId: string,
): Promise<OrganizationCustomerContext | null> => {
  const existing =
    await getOrganizationBillingProfileByStripeCustomerId(stripeCustomerId);
  if (existing) {
    return {
      organizationId: existing.organizationId,
      ownerUserId: existing.ownerUserId,
    };
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (typeof customer === "string" || customer.deleted) {
    return null;
  }

  const metadataOrgId = customer.metadata?.org_id?.trim();
  if (!metadataOrgId) {
    return null;
  }

  const ownerUserId = customer.metadata?.user_id?.trim() || "unknown";

  await upsertStripeCustomerForOrganization({
    organizationId: metadataOrgId,
    ownerUserId,
    stripeCustomerId,
  });

  return {
    organizationId: metadataOrgId,
    ownerUserId,
  };
};

const syncSubscriptionState = async (input: {
  organizationId: string;
  ownerUserId: string;
  stripeCustomerId: string;
  subscription: Stripe.Subscription;
}) => {
  const effective = await resolveEffectiveSubscriptionState(input.subscription);
  await upsertOrganizationBillingSubscriptionState({
    organizationId: input.organizationId,
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

const handleCheckoutSessionCompleted = async (event: Stripe.Event) => {
  const session = event.data.object as Stripe.Checkout.Session;
  const stripeCustomerId = parseStripeCustomerId(session.customer ?? null);
  if (!stripeCustomerId) return;

  const sessionUserId =
    session.client_reference_id?.trim() ||
    session.metadata?.user_id?.trim() ||
    null;
  const sessionOrgId = session.metadata?.org_id?.trim() || null;

  if (sessionOrgId) {
    await upsertStripeCustomerForOrganization({
      organizationId: sessionOrgId,
      ownerUserId: sessionUserId || "unknown",
      stripeCustomerId,
    });
  }

  if (session.mode === "payment") {
    if (session.metadata?.kind !== "topup") {
      return;
    }
    if (session.payment_status !== "paid") {
      return;
    }

    const orgContext = sessionOrgId
      ? {
          organizationId: sessionOrgId,
          ownerUserId: sessionUserId || "unknown",
        }
      : await resolveOrganizationForCustomer(stripeCustomerId);
    if (!orgContext) return;

    await grantOrganizationCreditsFromBillingEvent({
      organizationId: orgContext.organizationId,
      amount: TOPUP_CREDITS,
      reason: "topup_purchase_grant",
      idempotencyKey: `topup:${session.id}`,
      metadata: {
        stripeEventId: event.id,
        checkoutSessionId: session.id,
        customerId: stripeCustomerId,
        orgId: orgContext.organizationId,
        userId: sessionUserId,
      },
    });
    return;
  }

  if (session.mode !== "subscription" || typeof session.subscription !== "string") {
    return;
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(session.subscription);

  const orgContext = sessionOrgId
    ? {
        organizationId: sessionOrgId,
        ownerUserId: sessionUserId || "unknown",
      }
    : await resolveOrganizationForCustomer(stripeCustomerId);
  if (!orgContext) return;

  const synced = await syncSubscriptionState({
    organizationId: orgContext.organizationId,
    ownerUserId: orgContext.ownerUserId,
    stripeCustomerId,
    subscription,
  });
  if (synced.planTier === "free") return;
};

const handleInvoicePaid = async (event: Stripe.Event) => {
  const invoice = event.data.object as Stripe.Invoice;
  const parentSubscriptionId =
    invoice.parent?.type === "subscription_details"
      ? invoice.parent.subscription_details?.subscription
      : null;
  const subscriptionId =
    typeof parentSubscriptionId === "string"
      ? parentSubscriptionId
      : parentSubscriptionId && typeof parentSubscriptionId === "object"
        ? parentSubscriptionId.id
        : null;

  if (!invoice.customer || !subscriptionId) {
    return;
  }
  if ((invoice.amount_paid ?? 0) <= 0) {
    return;
  }

  const stripeCustomerId = parseStripeCustomerId(invoice.customer);
  if (!stripeCustomerId) return;

  const orgContext = await resolveOrganizationForCustomer(stripeCustomerId);
  if (!orgContext) return;

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const synced = await syncSubscriptionState({
    organizationId: orgContext.organizationId,
    ownerUserId: orgContext.ownerUserId,
    stripeCustomerId,
    subscription,
  });

  if (synced.planTier === "free") return;

  await grantOrganizationCreditsFromBillingEvent({
    organizationId: orgContext.organizationId,
    amount: resolvePlanMonthlyCredits(synced.planTier),
    reason: "subscription_cycle_grant",
    idempotencyKey: `invoice:${invoice.id}`,
    metadata: {
      stripeEventId: event.id,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      planTier: synced.planTier,
      orgId: orgContext.organizationId,
      ownerUserId: orgContext.ownerUserId,
    },
  });
};

const handleSubscriptionUpdated = async (event: Stripe.Event) => {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = parseStripeCustomerId(subscription.customer);
  if (!stripeCustomerId) return;

  const orgContext = await resolveOrganizationForCustomer(stripeCustomerId);
  if (!orgContext) return;

  await syncSubscriptionState({
    organizationId: orgContext.organizationId,
    ownerUserId: orgContext.ownerUserId,
    stripeCustomerId,
    subscription,
  });
};

export async function POST(request: Request) {
  try {
    if (!STRIPE_WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: "Missing STRIPE_WEBHOOK_SECRET." },
        { status: 500 },
      );
    }

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return NextResponse.json(
        { error: "Missing Stripe signature header." },
        { status: 400 },
      );
    }

    const payload = await request.text();
    const stripe = getStripeClient();
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        payload,
        signature,
        STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid webhook signature.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (await hasProcessedStripeWebhookEvent(event.id)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionUpdated(event);
        break;
      default:
        break;
    }

    await markStripeWebhookEventProcessed({
      eventId: event.id,
      eventType: event.type,
      payload: event,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process webhook.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
