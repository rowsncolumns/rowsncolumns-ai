import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import {
  getOrganizationRoleForUser,
  isOrganizationAdminRole,
} from "@/lib/auth/organization-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

const inviteOrganizationMemberSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "member"]).default("member"),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { data: session } = await auth.getSession();
    const user = session?.user;
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { orgId: rawOrgId } = await context.params;
    const orgId = rawOrgId.trim();
    if (!orgId) {
      return NextResponse.json({ error: "Invalid organization." }, { status: 400 });
    }

    const role = await getOrganizationRoleForUser({
      userId: user.id,
      organizationId: orgId,
    });
    if (!role) {
      return NextResponse.json(
        { error: "You are not a member of this organization." },
        { status: 403 },
      );
    }
    if (!isOrganizationAdminRole(role)) {
      return NextResponse.json(
        { error: "Only organization admins can invite members." },
        { status: 403 },
      );
    }

    const payload = await request.json().catch(() => null);
    const parsed = inviteOrganizationMemberSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const invitation = await auth.api.createInvitation({
      headers: request.headers,
      body: {
        organizationId: orgId,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
      },
    });

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        organizationId: invitation.organizationId,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      },
    });
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? Math.max(
            400,
            Math.min(599, (error as { status: number }).status),
          )
        : 500;
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create organization invitation.";
    return NextResponse.json({ error: message }, { status });
  }
}
