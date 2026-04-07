import type { Metadata } from "next";

import { ActiveOrganizationSync } from "@/components/active-organization-sync";
import { AccountBillingPanel } from "@/components/account-billing-panel";
import { OrganizationNav } from "@/components/organization-nav";
import { PageTitleBlock } from "@/components/page-title-block";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { buildOrganizationBillingPath } from "@/lib/auth/organization";
import {
  syncBillingProfileFromStripeForOrganization,
  syncCheckoutSessionForOrganization,
} from "@/lib/billing/checkout-session-sync";
import { getOrganizationBillingEntitlement } from "@/lib/billing/repository";
import { getOrganizationCredits } from "@/lib/credits/repository";

import {
  buildOrganizationAdminTabs,
  resolveOrganizationAdminPageContext,
} from "../_lib";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type RouteParams = Promise<{ orgId: string }>;

const readSingleParam = (value: string | string[] | undefined) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Organization Billing",
  description: "Manage organization-level billing and credits.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function OrganizationBillingPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const { orgId: rawOrgId } = await params;
  const orgId = rawOrgId.trim();
  const callbackPath = buildOrganizationBillingPath(orgId);
  const { user, organization, sessionActiveOrganizationId } =
    await resolveOrganizationAdminPageContext({
      orgId,
      callbackPath,
    });

  const queryParams = await searchParams;
  const checkoutSessionId = readSingleParam(queryParams.session_id);
  const hasCheckoutSuccess = readSingleParam(queryParams.checkout) === "success";
  const hasTopupSuccess = readSingleParam(queryParams.topup) === "success";
  const isPortalReturn = readSingleParam(queryParams.portal) === "return";
  let didCheckoutSync = false;

  if (checkoutSessionId && (hasCheckoutSuccess || hasTopupSuccess)) {
    await syncCheckoutSessionForOrganization({
      userId: user.id,
      orgId: organization.id,
      checkoutSessionId,
    }).catch((error) => {
      console.error(
        "Failed to sync checkout session on organization billing return.",
        error,
      );
    });
    didCheckoutSync = true;
  }

  if (isPortalReturn || !didCheckoutSync) {
    await syncBillingProfileFromStripeForOrganization(organization.id).catch(
      (error) => {
        console.error("Failed to sync org billing profile from Stripe.", error);
      },
    );
  }

  const [credits, billing] = await Promise.all([
    getOrganizationCredits(organization.id),
    getOrganizationBillingEntitlement(organization.id),
  ]);

  return (
    <SiteFixedWidthPageShell
      initialUser={{
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      }}
    >
      <ActiveOrganizationSync
        organizationId={organization.id}
        sessionActiveOrganizationId={sessionActiveOrganizationId}
      />
      <section className="mx-auto w-full rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
        <OrganizationNav
          tabs={buildOrganizationAdminTabs(organization.id, "billing")}
        />
        <PageTitleBlock
          title={`${organization.name} Billing`}
          tagline="Manage your organization subscription, top-ups, and current credit balance."
        />
        <div className="pt-1 sm:pt-2">
          <AccountBillingPanel
            organizationId={organization.id}
            currentPlan={billing.plan}
            subscriptionStatus={billing.subscriptionStatus}
            currentPeriodEnd={billing.currentPeriodEnd}
            availableCredits={credits.availableCredits}
            dailyFreeRemaining={credits.dailyFreeRemaining}
            paidBalance={credits.paidBalance}
          />
        </div>
      </section>
    </SiteFixedWidthPageShell>
  );
}
