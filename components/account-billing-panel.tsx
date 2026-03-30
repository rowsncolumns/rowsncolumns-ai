"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useBillingActions } from "@/components/use-billing-actions";
import {
  FREE_DAILY_CREDITS,
  MAX_MONTHLY_CREDITS,
  MAX_MONTHLY_PRICE_USD,
  PRO_MONTHLY_CREDITS,
  PRO_MONTHLY_PRICE_USD,
  TOPUP_CREDITS,
  TOPUP_PRICE_USD,
  type BillingPlanTier,
} from "@/lib/billing/plans";

type BillingPanelProps = {
  currentPlan: BillingPlanTier;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  availableCredits: number;
  dailyFreeRemaining: number;
  paidBalance: number;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
};

const formatSubscriptionStatus = (value: string | null) => {
  if (!value) return "none";
  if (value === "canceling") return "canceling (ends at period end)";
  return value;
};

const PLAN_CARDS: Array<{
  tier: BillingPlanTier;
  title: string;
  subtitle: string;
  priceLabel: string;
  creditsLabel: string;
  buttonLabel: string;
}> = [
  {
    tier: "free",
    title: "Free",
    subtitle: "For light usage",
    priceLabel: "$0/month",
    creditsLabel: `${FREE_DAILY_CREDITS} daily credits`,
    buttonLabel: "Free plan",
  },
  {
    tier: "pro",
    title: "Pro",
    subtitle: "For advanced individual use",
    priceLabel: `$${PRO_MONTHLY_PRICE_USD}/month`,
    creditsLabel: `${PRO_MONTHLY_CREDITS} credits / month`,
    buttonLabel: "Choose Pro",
  },
  {
    tier: "max",
    title: "Max",
    subtitle: "For teams and power users",
    priceLabel: `$${MAX_MONTHLY_PRICE_USD}/month`,
    creditsLabel: `${MAX_MONTHLY_CREDITS} credits / month`,
    buttonLabel: "Choose Max",
  },
];

export function AccountBillingPanel({
  currentPlan,
  subscriptionStatus,
  currentPeriodEnd,
  availableCredits,
  dailyFreeRemaining,
  paidBalance,
}: BillingPanelProps) {
  const hasPaidPlan = currentPlan !== "free";
  const normalizedStatus = subscriptionStatus?.trim().toLowerCase() ?? null;
  const periodDateLabel =
    normalizedStatus === "active"
      ? "Next billing date"
      : normalizedStatus === "canceling"
        ? "Access until"
        : "Current period end";
  const {
    isSubmittingTier,
    isSubmittingTopup,
    isOpeningPortal,
    startSubscriptionCheckout,
    startTopupCheckout,
    openBillingPortal,
    confirmationDialog,
  } = useBillingActions();

  const handleTierSelection = React.useCallback(async (tier: BillingPlanTier) => {
    if (tier === "free") {
      return;
    }

    await startSubscriptionCheckout({
      tier,
      currentPlan,
    });
  }, [currentPlan, startSubscriptionCheckout]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-4">
        <h3 className="display-font text-lg font-semibold text-foreground">Current Billing</h3>
        <p className="mt-1 text-sm text-(--muted-foreground)">
          Credit usage varies by message complexity and usually takes 2-15 credits per message.
        </p>
        <div className="mt-2 grid gap-2 text-sm text-(--muted-foreground) sm:grid-cols-2">
          <p>
            <span className="font-medium text-foreground">Plan:</span>{" "}
            {currentPlan.toUpperCase()}
          </p>
          <p>
            <span className="font-medium text-foreground">Status:</span>{" "}
            {formatSubscriptionStatus(subscriptionStatus)}
          </p>
          <p>
            <span className="font-medium text-foreground">{periodDateLabel}:</span>{" "}
            {formatDateTime(currentPeriodEnd)}
          </p>
          <p>
            <span className="font-medium text-foreground">Available credits:</span>{" "}
            {availableCredits}
          </p>
          <p>
            <span className="font-medium text-foreground">Paid balance:</span>{" "}
            {paidBalance}
          </p>
          <p>
            <span className="font-medium text-foreground">Daily free remaining:</span>{" "}
            {dailyFreeRemaining}
          </p>
        </div>

        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={openBillingPortal}
            disabled={isOpeningPortal}
          >
            {isOpeningPortal
              ? "Opening portal..."
              : hasPaidPlan
                ? "Manage subscription"
                : "Manage billing in Stripe"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_CARDS.map((card) => {
          const isCurrent = card.tier === currentPlan;
          const isBusy = isSubmittingTier === card.tier;
          return (
            <div
              key={card.tier}
              className="rounded-xl border border-(--card-border) bg-(--card-bg) p-4"
            >
              <p className="display-font text-xl font-semibold text-foreground">{card.title}</p>
              <p className="mt-1 text-xs text-(--muted-foreground)">{card.subtitle}</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{card.priceLabel}</p>
              <p className="mt-1 text-sm text-(--muted-foreground)">{card.creditsLabel}</p>
              {(() => {
                const buttonVariant =
                  isCurrent || card.tier === "free" ? "secondary" : "primary";
                const buttonLabel = isBusy
                  ? "Submitting..."
                  : isCurrent
                    ? "Current plan"
                    : card.tier === "free"
                      ? "Included with all accounts"
                      : card.buttonLabel;

                return (
                  <Button
                    type="button"
                    className="mt-4 w-full"
                    onClick={() => handleTierSelection(card.tier)}
                    disabled={card.tier === "free" || isCurrent || !!isSubmittingTier}
                    variant={buttonVariant}
                  >
                    {buttonLabel}
                  </Button>
                );
              })()}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-4">
        <h3 className="display-font text-lg font-semibold text-foreground">
          One-Off Credit Top-Up
        </h3>
        <p className="mt-1 text-sm text-(--muted-foreground)">
          Buy a {TOPUP_PRICE_USD} USD pack and receive {TOPUP_CREDITS} credits.
        </p>
        <Button
          type="button"
          onClick={startTopupCheckout}
          disabled={isSubmittingTopup}
          className="mt-4"
        >
          {isSubmittingTopup
            ? "Redirecting..."
            : `Buy ${TOPUP_CREDITS} credits for $${TOPUP_PRICE_USD}`}
        </Button>
      </div>
      {confirmationDialog}
    </div>
  );
}
