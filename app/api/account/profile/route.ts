import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().default(""),
});

const normalizeNamePart = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

export async function PATCH(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const user = session?.user;
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = updateProfileSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const firstName = normalizeNamePart(parsed.data.firstName);
    const lastName = normalizeNamePart(parsed.data.lastName);
    const fullName = `${firstName} ${lastName}`.trim();

    await auth.api.updateUser({
      headers: request.headers,
      body: {
        name: fullName,
      },
    });

    return NextResponse.json({
      firstName,
      lastName,
      name: fullName,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
