import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";

import {
  getUserBillingEntitlement,
  isPaidSubscriptionStatus,
  upsertStripeCustomerForUser,
  upsertUserBillingSubscriptionState,
} from "@/lib/billing/repository";
import {
  getStripeClient,
  getStripePriceByLookupKey,
} from "@/lib/billing/stripe";
import {
  TOPUP_CREDITS,
  type BillingPlanTier,
} from "@/lib/billing/plans";
import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkoutRequestSchema = z
  .object({
    kind: z.enum(["subscription", "topup"]),
    tier: z.enum(["pro", "max"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "subscription" && !value.tier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tier"],
        message: "tier is required for subscription checkout.",
      });
    }
  });

const resolveAppOrigin = (request: Request) => {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const requestUrl = new URL(request.url);
  return requestUrl.origin;
};

const resolveSubscriptionCurrentPeriodEnd = (subscription: Stripe.Subscription) => {
  const firstItem = subscription.items.data[0];
  if (!firstItem || !Number.isFinite(firstItem.current_period_end)) {
    return null;
  }
  return new Date(firstItem.current_period_end * 1000).toISOString();
};

const resolveStripeCustomer = async (input: {
  userId: string;
  email: string | null | undefined;
  name: string | null | undefined;
  stripeCustomerId: string | null;
}) => {
  if (input.stripeCustomerId) {
    return input.stripeCustomerId;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email: input.email ?? undefined,
    name: input.name ?? undefined,
    metadata: {
      user_id: input.userId,
    },
  });

  await upsertStripeCustomerForUser({
    userId: input.userId,
    stripeCustomerId: customer.id,
  });

  return customer.id;
};

const createSubscriptionCheckoutSession = async (input: {
  userId: string;
  stripeCustomerId: string;
  tier: Exclude<BillingPlanTier, "free">;
  origin: string;
}) => {
  const stripe = getStripeClient();
  const price = await getStripePriceByLookupKey(input.tier);

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: input.stripeCustomerId,
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: `${input.origin}/account/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/account/billing?checkout=cancel`,
    client_reference_id: input.userId,
    metadata: {
      kind: "subscription",
      user_id: input.userId,
      plan_tier: input.tier,
    },
    subscription_data: {
      metadata: {
        user_id: input.userId,
        plan_tier: input.tier,
      },
    },
  });
};

const createTopupCheckoutSession = async (input: {
  userId: string;
  stripeCustomerId: string;
  origin: string;
}) => {
  const stripe = getStripeClient();
  const price = await getStripePriceByLookupKey("topup");

  return stripe.checkout.sessions.create({
    mode: "payment",
    customer: input.stripeCustomerId,
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: `${input.origin}/account/billing?topup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/account/billing?topup=cancel`,
    client_reference_id: input.userId,
    metadata: {
      kind: "topup",
      user_id: input.userId,
      topup_credits: String(TOPUP_CREDITS),
    },
  });
};

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const user = session?.user;
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = checkoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const entitlement = await getUserBillingEntitlement(user.id);
    const stripeCustomerId = await resolveStripeCustomer({
      userId: user.id,
      email: user.email,
      name: user.name,
      stripeCustomerId: entitlement.stripeCustomerId,
    });
    const origin = resolveAppOrigin(request);

    if (parsed.data.kind === "topup") {
      const checkoutSession = await createTopupCheckoutSession({
        userId: user.id,
        stripeCustomerId,
        origin,
      });

      if (!checkoutSession.url) {
        return NextResponse.json(
          { error: "Failed to initialize checkout." },
          { status: 500 },
        );
      }

      return NextResponse.json({
        checkoutUrl: checkoutSession.url,
        sessionId: checkoutSession.id,
      });
    }

    const targetTier = parsed.data.tier as Exclude<BillingPlanTier, "free">;

    if (
      entitlement.stripeSubscriptionId &&
      isPaidSubscriptionStatus(entitlement.subscriptionStatus)
    ) {
      const stripe = getStripeClient();
      const [targetPrice, currentSubscription] = await Promise.all([
        getStripePriceByLookupKey(targetTier),
        stripe.subscriptions.retrieve(entitlement.stripeSubscriptionId),
      ]);

      const currentItem = currentSubscription.items.data[0];
      if (!currentItem) {
        return NextResponse.json(
          { error: "Subscription item is missing." },
          { status: 409 },
        );
      }

      if (currentItem.price.id === targetPrice.id) {
        return NextResponse.json({
          updated: true,
          noChange: true,
          subscriptionId: currentSubscription.id,
        });
      }

      const updated = await stripe.subscriptions.update(currentSubscription.id, {
        items: [
          {
            id: currentItem.id,
            price: targetPrice.id,
          },
        ],
        // Reactivate immediately if it had been scheduled for cancellation.
        cancel_at_period_end: false,
        proration_behavior: "create_prorations",
        metadata: {
          ...currentSubscription.metadata,
          plan_tier: targetTier,
          user_id: user.id,
        },
      });

      await upsertUserBillingSubscriptionState({
        userId: user.id,
        stripeCustomerId,
        stripeSubscriptionId: updated.id,
        planTier: targetTier,
        subscriptionStatus: updated.status,
        trialEndsAt:
          typeof updated.trial_end === "number"
            ? new Date(updated.trial_end * 1000).toISOString()
            : null,
        currentPeriodEnd:
          resolveSubscriptionCurrentPeriodEnd(updated),
      });

      return NextResponse.json({
        updated: true,
        subscriptionId: updated.id,
      });
    }

    const checkoutSession = await createSubscriptionCheckoutSession({
      userId: user.id,
      stripeCustomerId,
      tier: targetTier,
      origin,
    });

    if (!checkoutSession.url) {
      return NextResponse.json(
        { error: "Failed to initialize checkout." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start checkout.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
