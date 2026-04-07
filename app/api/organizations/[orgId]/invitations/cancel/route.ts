import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import {
  getOrganizationInvitationById,
  getOrganizationRoleForUser,
  isOrganizationAdminRole,
} from "@/lib/auth/organization-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

const cancelInvitationSchema = z.object({
  invitationId: z.string().trim().min(1).max(200),
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
      return NextResponse.json(
        { error: "Invalid organization." },
        { status: 400 },
      );
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
        { error: "Only organization admins can remove invitations." },
        { status: 403 },
      );
    }

    const payload = await request.json().catch(() => null);
    const parsed = cancelInvitationSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const invitation = await getOrganizationInvitationById({
      organizationId: orgId,
      invitationId: parsed.data.invitationId,
    });
    if (!invitation) {
      return NextResponse.json(
        { error: "Invitation not found." },
        { status: 404 },
      );
    }
    if (invitation.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending invitations can be removed." },
        { status: 409 },
      );
    }

    await auth.api.cancelInvitation({
      headers: request.headers,
      body: {
        invitationId: invitation.id,
      },
    });

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        status: "canceled",
      },
    });
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? Math.max(400, Math.min(599, (error as { status: number }).status))
        : 500;
    const message =
      error instanceof Error
        ? error.message
        : "Failed to cancel organization invitation.";
    return NextResponse.json({ error: message }, { status });
  }
}
