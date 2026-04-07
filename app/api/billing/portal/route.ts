import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveActiveOrganizationIdForSession } from "@/lib/auth/organization";
import { auth } from "@/lib/auth/server";
import {
  getOrganizationRoleForUser,
  isOrganizationAdminRole,
} from "@/lib/auth/organization-membership";
import {
  getOrganizationBillingEntitlement,
  upsertStripeCustomerForOrganization,
} from "@/lib/billing/repository";
import {
  getStripeClient,
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const portalRequestSchema = z.object({
  organizationId: z.string().trim().min(1).max(200).optional(),
});

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
    const body = await request.json().catch(() => null);
    const parsed = portalRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const requestedOrgId = parsed.data.organizationId?.trim() || null;
    const activeOrgId = await resolveActiveOrganizationIdForSession(session);
    const orgId = requestedOrgId ?? activeOrgId;
    if (!orgId) {
      return NextResponse.json(
        {
          error: "No active organization. Create an organization first.",
          onboardingUrl: "/onboarding/organization",
        },
        { status: 409 },
      );
    }

    const role = await getOrganizationRoleForUser({
      userId: user.id,
      organizationId: orgId,
    });
    if (!role) {
      return NextResponse.json(
        { error: "You are not a member of this organization." },
        { status: 403 },
      );
    }
    if (!isOrganizationAdminRole(role)) {
      return NextResponse.json(
        { error: "Only organization admins can manage billing." },
        { status: 403 },
      );
    }

    const entitlement = await getOrganizationBillingEntitlement(orgId);
    const stripe = getStripeClient();

    let customerId = entitlement.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        metadata: { user_id: user.id, org_id: orgId },
      });
      customerId = customer.id;
      await upsertStripeCustomerForOrganization({
        organizationId: orgId,
        ownerUserId: user.id,
        stripeCustomerId: customerId,
      });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${resolveAppOrigin(request)}/org/${encodeURIComponent(orgId)}/billing?portal=return`,
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
