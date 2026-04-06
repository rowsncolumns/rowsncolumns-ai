import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountBillingPanel } from "@/components/account-billing-panel";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import {
  syncBillingProfileFromStripeForUser,
  syncCheckoutSessionForUser,
} from "@/lib/billing/checkout-session-sync";
import { getUserBillingEntitlement } from "@/lib/billing/repository";
import { getUserCredits } from "@/lib/credits/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Billing",
  description:
    "Manage your RowsnColumns AI subscription and one-off credit top-ups.",
  robots: {
    index: false,
    follow: false,
  },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const readSingleParam = (value: string | string[] | undefined) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
};

export default async function AccountBillingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getServerSessionSafe();

  if (!session?.user) {
    redirect("/auth/sign-in?callbackURL=/account/billing");
  }

  const user = session.user;
  const params = await searchParams;
  const checkoutSessionId = readSingleParam(params.session_id);
  const hasCheckoutSuccess = readSingleParam(params.checkout) === "success";
  const hasTopupSuccess = readSingleParam(params.topup) === "success";
  const isPortalReturn = readSingleParam(params.portal) === "return";
  let didCheckoutSync = false;

  if (checkoutSessionId && (hasCheckoutSuccess || hasTopupSuccess)) {
    await syncCheckoutSessionForUser({
      userId: user.id,
      checkoutSessionId,
    }).catch((error) => {
      console.error(
        "Failed to sync checkout session on billing return.",
        error,
      );
    });
    didCheckoutSync = true;
  }

  if (isPortalReturn || !didCheckoutSync) {
    await syncBillingProfileFromStripeForUser(user.id).catch((error) => {
      console.error("Failed to sync billing profile from Stripe.", error);
    });
  }

  const [credits, billing] = await Promise.all([
    getUserCredits(user.id),
    getUserBillingEntitlement(user.id),
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
      <section className="mx-auto w-full rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
        <div className="pb-2">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
            Billing
          </h1>
          <p className="mt-1 text-sm leading-7 text-(--muted-foreground) sm:text-base">
            Manage your subscription, one-off top-ups, and current credit
            balance in one place.
          </p>
        </div>
        <div className="pt-1 sm:pt-2">
          <AccountBillingPanel
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
