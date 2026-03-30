"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getButtonClassName } from "@/components/ui/button";
import { type BillingPlanTier } from "@/lib/billing/plans";

type PaidTier = "pro" | "max";

type CheckoutResponse = {
  checkoutUrl?: string;
  updated?: boolean;
  noChange?: boolean;
  error?: string;
};

type PortalResponse = {
  portalUrl?: string;
  error?: string;
};

type PendingPlanChange = {
  currentPlan: PaidTier;
  nextPlan: PaidTier;
  resolve: (confirmed: boolean) => void;
};

export function useBillingActions() {
  const router = useRouter();
  const [isSubmittingTier, setIsSubmittingTier] =
    React.useState<PaidTier | null>(null);
  const [isSubmittingTopup, setIsSubmittingTopup] = React.useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = React.useState(false);
  const [pendingPlanChange, setPendingPlanChange] =
    React.useState<PendingPlanChange | null>(null);

  const resolvePlanChangeConfirmation = React.useCallback(
    (confirmed: boolean) => {
      if (!pendingPlanChange) return;
      pendingPlanChange.resolve(confirmed);
      setPendingPlanChange(null);
    },
    [pendingPlanChange],
  );

  const requestPlanChangeConfirmation = React.useCallback(
    (currentPlan: PaidTier, nextPlan: PaidTier) =>
      new Promise<boolean>((resolve) => {
        setPendingPlanChange({
          currentPlan,
          nextPlan,
          resolve,
        });
      }),
    [],
  );

  React.useEffect(() => {
    return () => {
      if (pendingPlanChange) {
        pendingPlanChange.resolve(false);
      }
    };
  }, [pendingPlanChange]);

  const startSubscriptionCheckout = React.useCallback(async (input: {
    tier: PaidTier;
    currentPlan?: BillingPlanTier;
  }) => {
    const tier = input.tier;
    const currentPlan = input.currentPlan ?? "free";
    const isExistingPaidPlan = currentPlan === "pro" || currentPlan === "max";
    const isPlanChange = isExistingPaidPlan && currentPlan !== tier;

    if (isPlanChange) {
      const confirmed = await requestPlanChangeConfirmation(
        currentPlan as PaidTier,
        tier,
      );
      if (!confirmed) {
        return;
      }
    }

    setIsSubmittingTier(tier);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "subscription",
          tier,
        }),
      });

      const payload = (await response
        .json()
        .catch(() => null)) as CheckoutResponse | null;
      if (!response.ok) {
        toast.error(payload?.error ?? "Failed to start checkout.");
        return;
      }

      if (payload?.checkoutUrl) {
        window.location.assign(payload.checkoutUrl);
        return;
      }

      if (payload?.updated) {
        if (payload.noChange) {
          toast.warning(`Your account is already on the ${tier.toUpperCase()} plan.`);
        } else {
          toast.success(
            `Plan updated to ${tier.toUpperCase()}. Stripe will apply proration automatically.`,
          );
        }
        router.refresh();
      }
    } catch {
      toast.error("Failed to start checkout.");
    } finally {
      setIsSubmittingTier(null);
    }
  }, [requestPlanChangeConfirmation, router]);

  const startTopupCheckout = React.useCallback(async () => {
    setIsSubmittingTopup(true);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "topup",
        }),
      });

      const payload = (await response
        .json()
        .catch(() => null)) as CheckoutResponse | null;
      if (!response.ok || !payload?.checkoutUrl) {
        toast.error(payload?.error ?? "Failed to start top-up checkout.");
        return;
      }

      window.location.assign(payload.checkoutUrl);
    } catch {
      toast.error("Failed to start top-up checkout.");
    } finally {
      setIsSubmittingTopup(false);
    }
  }, []);

  const openBillingPortal = React.useCallback(async () => {
    setIsOpeningPortal(true);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as PortalResponse | null;
      if (!response.ok || !payload?.portalUrl) {
        toast.error(payload?.error ?? "Failed to open billing portal.");
        return;
      }
      window.location.assign(payload.portalUrl);
    } catch {
      toast.error("Failed to open billing portal.");
    } finally {
      setIsOpeningPortal(false);
    }
  }, []);

  const confirmationDialog = pendingPlanChange ? (
    <AlertDialog
      open={Boolean(pendingPlanChange)}
      onOpenChange={(open) => {
        if (!open) {
          resolvePlanChangeConfirmation(false);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm plan change</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to{" "}
            {pendingPlanChange.currentPlan === "pro" &&
            pendingPlanChange.nextPlan === "max"
              ? "upgrade"
              : "downgrade"}{" "}
            from {pendingPlanChange.currentPlan.toUpperCase()} to{" "}
            {pendingPlanChange.nextPlan.toUpperCase()}. Stripe may apply
            proration to your current billing cycle.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            className={getButtonClassName({
              variant: "secondary",
              size: "sm",
            })}
            onClick={() => resolvePlanChangeConfirmation(false)}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={getButtonClassName({
              variant: "primary",
              size: "sm",
            })}
            onClick={() => resolvePlanChangeConfirmation(true)}
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  return {
    isSubmittingTier,
    isSubmittingTopup,
    isOpeningPortal,
    startSubscriptionCheckout,
    startTopupCheckout,
    openBillingPortal,
    confirmationDialog,
  } as const;
}
