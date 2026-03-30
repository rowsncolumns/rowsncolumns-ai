"use client";

import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { useBillingActions } from "@/components/use-billing-actions";
import { type BillingPlanTier } from "@/lib/billing/plans";

type PricingCheckoutButtonProps = {
  kind: "subscription" | "topup";
  tier?: "pro" | "max";
  label: string;
  currentPlan?: BillingPlanTier;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function PricingCheckoutButton({
  kind,
  tier,
  label,
  currentPlan,
  className,
  variant = "primary",
  size = "default",
}: PricingCheckoutButtonProps) {
  const {
    isSubmittingTier,
    isSubmittingTopup,
    startSubscriptionCheckout,
    startTopupCheckout,
    confirmationDialog,
  } = useBillingActions();

  const isSubmitting =
    kind === "topup"
      ? isSubmittingTopup
      : tier
        ? isSubmittingTier === tier
        : false;

  const handleClick = async () => {
    if (kind === "topup") {
      await startTopupCheckout();
      return;
    }

    if (!tier) {
      return;
    }

    await startSubscriptionCheckout({
      tier,
      currentPlan,
    });
  };

  return (
    <>
      <Button
        type="button"
        onClick={handleClick}
        disabled={isSubmitting}
        className={className}
        variant={variant}
        size={size}
      >
        {isSubmitting ? "Processing..." : label}
      </Button>
      {confirmationDialog}
    </>
  );
}
