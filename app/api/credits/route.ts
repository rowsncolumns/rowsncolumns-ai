import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/auth/admin";
import { auth } from "@/lib/auth/server";
import { INITIAL_CREDITS } from "@/lib/credits/pricing";
import { getUserCredits } from "@/lib/credits/repository";
import { getUserBillingEntitlement } from "@/lib/billing/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getNextResetAtUtc = (creditDay: string) => {
  const nextReset = new Date(`${creditDay}T00:00:00.000Z`);
  nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  return nextReset.toISOString();
};

export async function GET() {
  try {
    const { data: session } = await auth.getSession();
    const user = session?.user;
    const userId = user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const isAdmin = isAdminUser({ id: user.id, email: user.email });
    const credits = await getUserCredits(userId);
    const billing = await getUserBillingEntitlement(userId);
    const available = isAdmin ? null : credits.availableCredits;

    return NextResponse.json({
      credits: {
        balance: available,
        available,
        dailyFreeRemaining: isAdmin ? null : credits.dailyFreeRemaining,
        paidBalance: isAdmin ? null : credits.paidBalance,
        creditDay: credits.creditDay,
        dailyLimit: INITIAL_CREDITS,
        unlimited: isAdmin,
        nextResetAt: getNextResetAtUtc(credits.creditDay),
        updatedAt: credits.updatedAt,
      },
      billing: {
        plan: billing.plan,
        subscriptionStatus: billing.subscriptionStatus,
        trialEndsAt: billing.trialEndsAt,
        currentPeriodEnd: billing.currentPeriodEnd,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load credits.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
