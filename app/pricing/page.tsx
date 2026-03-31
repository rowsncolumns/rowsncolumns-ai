import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Coins, Sparkles } from "lucide-react";

import { AuthModalTrigger } from "@/components/auth-modal-trigger";
import { Badge } from "@/components/ui/badge";
import { PricingCheckoutButton } from "@/components/pricing-checkout-button";
import { Button, getButtonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import { getUserBillingEntitlement } from "@/lib/billing/repository";
import {
  FREE_DAILY_CREDITS,
  MAX_MONTHLY_CREDITS,
  MAX_MONTHLY_PRICE_USD,
  PRO_MONTHLY_CREDITS,
  PRO_MONTHLY_PRICE_USD,
  TOPUP_CREDITS,
  TOPUP_PRICE_USD,
} from "@/lib/billing/plans";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Choose the RowsnColumns AI plan that fits your spreadsheet workflow volume and buy one-off credit top-ups when needed.",
  alternates: {
    canonical: "/pricing",
  },
};

const planCards = [
  {
    tier: "free" as const,
    name: "Free",
    price: "$0",
    period: "/month",
    credits: `${FREE_DAILY_CREDITS} daily credits`,
    blurb: "Best for trying the product and light day-to-day tasks.",
    points: [
      "Daily credit reset",
      "Access to core spreadsheet assistant",
      "Buy one-off top-ups anytime",
    ],
    highlight: false,
  },
  {
    tier: "pro" as const,
    name: "Pro",
    price: `$${PRO_MONTHLY_PRICE_USD}`,
    period: "/month",
    credits: `${PRO_MONTHLY_CREDITS} credits / month`,
    blurb: "Built for individual operators shipping weekly workflows.",
    points: [
      "Monthly durable credits",
      "Priority model access",
      "Seamless upgrade to Max",
    ],
    highlight: true,
  },
  {
    tier: "max" as const,
    name: "Max",
    price: `$${MAX_MONTHLY_PRICE_USD}`,
    period: "/month",
    credits: `${MAX_MONTHLY_CREDITS} credits / month`,
    blurb: "For power users and teams running heavy automation volume.",
    points: [
      "High monthly credit capacity",
      "Best fit for complex multi-step workloads",
      "Audit history and rollback controls",
      "Priority support",
      "Keeps top-up flexibility",
    ],
    highlight: false,
  },
] as const;

export default async function PricingPage() {
  const session = await getServerSessionSafe();
  const billing = session?.user
    ? await getUserBillingEntitlement(session.user.id)
    : null;
  const initialUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : undefined;

  const isAuthenticated = Boolean(initialUser);
  const currentPlan = billing?.plan ?? "free";
  const billingHref = "/account/billing";
  const startHref = "/sheets";

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[36rem] bg-[radial-gradient(circle_at_top,rgba(255,109,52,0.26),transparent_44%)]" />
      <div className="absolute left-[-12rem] top-[38rem] -z-10 h-96 w-96 rounded-full bg-[rgba(18,132,255,0.12)] blur-3xl" />
      <div className="absolute right-[-12rem] top-[58rem] -z-10 h-96 w-96 rounded-full bg-[rgba(255,109,52,0.12)] blur-3xl" />

      <section className="px-5 pt-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="hero-grid overflow-hidden bg-(--card-bg)">
            <div className="p-4 sm:p-6">
              <SiteHeader initialUser={initialUser} />
            </div>
          </Card>
        </div>
      </section>

      <section className="px-5 pb-16 pt-8 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl space-y-6 sm:space-y-8">
          <Card className="overflow-hidden border-black/10 bg-[linear-gradient(135deg,#111827_0%,#1f2937_55%,#2f1f1a_100%)] text-white shadow-[0_30px_80px_rgba(17,24,39,0.26)]">
            <CardContent className="grid gap-7 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-10 lg:p-10">
              <div>
                <Badge className="border-0 bg-white/12 text-white">
                  Pricing
                </Badge>
                <h1 className="display-font mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  Clear credit pricing for every stage of usage.
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-white/78 sm:text-lg sm:leading-8">
                  Start free, move to Pro or Max when your workload grows, and
                  buy one-off credit blocks whenever you need extra capacity.
                </p>
                <p className="mt-3 text-sm text-white/72">
                  Credit usage varies by message complexity and usually takes
                  2-15 credits per message.
                </p>
              </div>

              <div className="rounded-2xl border border-white/12 bg-white/8 p-5 backdrop-blur sm:p-6">
                <p className="text-xs uppercase tracking-[0.18em] text-white/66">
                  Quick Start
                </p>
                <p className="display-font mt-3 text-3xl">
                  Get live in minutes
                </p>
                <p className="mt-2 text-sm text-white/74">
                  Upgrade, downgrade, or cancel at any time in Stripe.
                </p>
                {isAuthenticated ? (
                  <Link
                    href={startHref}
                    className={getButtonClassName({
                      variant: "primary",
                      className: "mt-5",
                    })}
                  >
                    Start building
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <AuthModalTrigger
                    triggerText="Start building"
                    mobileTriggerText="Start building"
                    initialIsAuthenticated={false}
                    triggerVariant="contrast"
                    redirectTo={startHref}
                    className="mt-5 h-11! rounded-xl!"
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            {planCards.map((plan) => (
              <Card
                key={plan.name}
                className={
                  plan.highlight
                    ? "relative flex h-full flex-col overflow-hidden border-[rgba(255,109,52,0.42)] bg-[linear-gradient(180deg,rgba(255,109,52,0.13),rgba(255,109,52,0.03))]"
                    : "flex h-full flex-col bg-(--card-bg-solid)"
                }
              >
                <CardHeader className="space-y-4 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="display-font text-3xl">
                      {plan.name}
                    </CardTitle>
                    {plan.highlight ? (
                      <Badge className="border-0 bg-[var(--accent)] text-[var(--accent-foreground)]">
                        Most popular
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-end gap-1">
                    <p className="display-font text-5xl font-semibold">
                      {plan.price}
                    </p>
                    <p className="pb-1 text-sm text-(--muted-foreground)">
                      {plan.period}
                    </p>
                  </div>
                  <p className="text-sm text-(--muted-foreground)">
                    {plan.credits}
                  </p>
                  <p className="text-sm text-(--muted-foreground)">
                    {plan.blurb}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col pt-0">
                  <div className="space-y-2.5">
                    {plan.points.map((point) => (
                      <div
                        key={point}
                        className="flex items-start gap-2 rounded-xl border border-(--card-border) bg-(--card-bg) px-3 py-3"
                      >
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                        <p className="text-sm leading-6 text-(--muted-foreground)">
                          {point}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto pt-5">
                    {isAuthenticated ? (
                      plan.tier === "free" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          disabled
                        >
                          Included with all accounts
                        </Button>
                      ) : (
                        <PricingCheckoutButton
                          kind="subscription"
                          tier={plan.tier}
                          label={`Choose ${plan.name}`}
                          currentPlan={currentPlan}
                          className="w-full"
                        />
                      )
                    ) : (
                      <AuthModalTrigger
                        triggerText={`Choose ${plan.name}`}
                        mobileTriggerText={`Choose ${plan.name}`}
                        initialIsAuthenticated={false}
                        triggerVariant="primary"
                        redirectTo={billingHref}
                        className="!h-11 !w-full !rounded-xl"
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden border-black/10 bg-[linear-gradient(125deg,var(--card-bg-solid),var(--card-bg-subtle))]">
            <CardContent className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <Badge variant="muted" className="gap-1.5">
                  <Coins className="h-3.5 w-3.5" />
                  One-Off Top-Up
                </Badge>
                <h2 className="display-font mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground">
                  Need extra credits this month?
                </h2>
                <p className="mt-3 max-w-2xl text-base leading-7 text-(--muted-foreground)">
                  Buy a one-off pack for ${TOPUP_PRICE_USD} and receive{" "}
                  {TOPUP_CREDITS} credits. Top-up credits are durable and can be
                  used by Free, Pro, or Max users.
                </p>
              </div>

              <div className="rounded-2xl border border-(--card-border) bg-(--card-bg) p-5 text-center sm:min-w-72">
                <p className="text-sm uppercase tracking-[0.18em] text-(--muted-foreground)">
                  Top-Up Block
                </p>
                <p className="display-font mt-2 text-4xl text-foreground">
                  {TOPUP_CREDITS}
                </p>
                <p className="mt-1 text-sm text-(--muted-foreground)">
                  credits
                </p>
                <p className="mt-3 text-xl font-semibold text-foreground">
                  ${TOPUP_PRICE_USD}
                </p>
                {isAuthenticated ? (
                  <PricingCheckoutButton
                    kind="topup"
                    label="Buy top-up"
                    className="mt-4 w-full"
                  />
                ) : (
                  <AuthModalTrigger
                    triggerText="Buy top-up"
                    mobileTriggerText="Buy top-up"
                    initialIsAuthenticated={false}
                    triggerVariant="primary"
                    redirectTo={billingHref}
                    className="mt-4 !h-11 !w-full !rounded-xl"
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-(--card-bg-solid)">
            <CardContent className="grid gap-4 p-6 sm:grid-cols-3 sm:p-8">
              {[
                {
                  title: "Monthly grants",
                  copy: "Pro and Max credits are added each billing cycle after successful payment.",
                },
                {
                  title: "Cancellation behavior",
                  copy: "Canceling keeps access until period end, then your plan falls back to Free.",
                },
                {
                  title: "Durable balance",
                  copy: "Paid and top-up credits remain in your balance across downgrades and cancellations.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-xl border border-(--card-border) bg-(--card-bg) p-4"
                >
                  <p className="display-font text-xl font-semibold text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-(--muted-foreground)">
                    {item.copy}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-(--card-border) bg-(--card-bg) px-5 py-5 sm:flex-row sm:items-center sm:px-6">
            <div>
              <p className="display-font text-xl font-semibold text-foreground">
                Ready to choose a plan?
              </p>
              <p className="mt-1 text-sm text-(--muted-foreground)">
                Open Billing to subscribe, manage your plan, or purchase top-up
                credits.
              </p>
            </div>
            {isAuthenticated ? (
              <Link
                href={billingHref}
                className={getButtonClassName({
                  variant: "primary",
                })}
              >
                <Sparkles className="h-4 w-4" />
                Open billing
              </Link>
            ) : (
              <AuthModalTrigger
                triggerText="Open billing"
                mobileTriggerText="Open billing"
                initialIsAuthenticated={false}
                triggerVariant="primary"
                redirectTo={billingHref}
                className="!h-11 !rounded-xl"
              />
            )}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
