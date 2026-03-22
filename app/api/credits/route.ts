import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { INITIAL_CREDITS } from "@/lib/credits/pricing";
import { getUserCredits } from "@/lib/credits/repository";

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
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const credits = await getUserCredits(userId);

    return NextResponse.json({
      credits: {
        balance: credits.balance,
        creditDay: credits.creditDay,
        dailyLimit: INITIAL_CREDITS,
        nextResetAt: getNextResetAtUtc(credits.creditDay),
        updatedAt: credits.updatedAt,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load credits.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
