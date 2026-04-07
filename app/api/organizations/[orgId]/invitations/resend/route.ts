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

const resendInvitationSchema = z.object({
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
        { error: "Only organization admins can resend invitations." },
        { status: 403 },
      );
    }

    const payload = await request.json().catch(() => null);
    const parsed = resendInvitationSchema.safeParse(payload);
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
        { error: "Only pending invitations can be resent." },
        { status: 409 },
      );
    }
    if (invitation.role !== "admin" && invitation.role !== "member") {
      return NextResponse.json(
        { error: "Only admin/member invitations can be resent." },
        { status: 409 },
      );
    }

    const resentInvitation = await auth.api.createInvitation({
      headers: request.headers,
      body: {
        organizationId: orgId,
        email: invitation.email.toLowerCase(),
        role: invitation.role,
        resend: true,
      },
    });

    return NextResponse.json({
      invitation: {
        id: resentInvitation.id,
        organizationId: resentInvitation.organizationId,
        email: resentInvitation.email,
        role: resentInvitation.role,
        status: resentInvitation.status,
        expiresAt: resentInvitation.expiresAt,
        createdAt: resentInvitation.createdAt,
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
        : "Failed to resend organization invitation.";
    return NextResponse.json({ error: message }, { status });
  }
}
