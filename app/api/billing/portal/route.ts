import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import {
  getUserBillingEntitlement,
  upsertStripeCustomerForUser,
} from "@/lib/billing/repository";
import {
  getStripeClient,
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resolveAppOrigin = (request: Request) => {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  return new URL(request.url).origin;
};

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const user = session?.user;
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const entitlement = await getUserBillingEntitlement(user.id);
    const stripe = getStripeClient();

    let customerId = entitlement.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await upsertStripeCustomerForUser({
        userId: user.id,
        stripeCustomerId: customerId,
      });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${resolveAppOrigin(request)}/account/billing?portal=return`,
      ...(STRIPE_BILLING_PORTAL_CONFIGURATION_ID
        ? { configuration: STRIPE_BILLING_PORTAL_CONFIGURATION_ID }
        : {}),
    });

    return NextResponse.json({
      portalUrl: portalSession.url,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create billing portal session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
