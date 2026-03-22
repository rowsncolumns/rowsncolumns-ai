import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminUser } from "@/lib/auth/admin";
import { auth } from "@/lib/auth/server";
import { INITIAL_CREDITS } from "@/lib/credits/pricing";
import { adminRefillUserCredits } from "@/lib/credits/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refillRequestSchema = z
  .object({
    userId: z.string().trim().min(1, "userId is required."),
    mode: z.enum(["set", "add"]).default("set"),
    amount: z
      .number()
      .int("amount must be an integer.")
      .min(0, "amount must be at least 0.")
      .max(5000, "amount is too large.")
      .optional(),
    note: z.string().trim().max(300, "note is too long.").optional(),
  })
  .refine(
    (value) => !(value.mode === "add" && (value.amount ?? INITIAL_CREDITS) < 1),
    { message: "amount must be at least 1 in add mode." },
  );

const formatValidationError = (error: z.ZodError) =>
  NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request." }, { status: 400 });

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const user = session?.user;
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (!isAdminUser({ id: user.id, email: user.email })) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = refillRequestSchema.safeParse(body);
    if (!parsed.success) {
      return formatValidationError(parsed.error);
    }

    const refill = await adminRefillUserCredits({
      targetUserId: parsed.data.userId,
      adminUserId: user.id,
      mode: parsed.data.mode,
      amount: parsed.data.amount ?? INITIAL_CREDITS,
      note: parsed.data.note,
    });

    return NextResponse.json({ refill });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to refill user credits.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
