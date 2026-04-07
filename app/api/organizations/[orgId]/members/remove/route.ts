import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import {
  getOrganizationRoleForUser,
  isOrganizationAdminRole,
  listOrganizationMembers,
} from "@/lib/auth/organization-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

const removeOrganizationMemberSchema = z.object({
  memberId: z.string().trim().min(1).max(200),
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
        { error: "Only organization admins can remove members." },
        { status: 403 },
      );
    }

    const payload = await request.json().catch(() => null);
    const parsed = removeOrganizationMemberSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const members = await listOrganizationMembers({ organizationId: orgId });
    const member = members.find((item) => item.id === parsed.data.memberId) ?? null;
    if (!member) {
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }
    if (member.role === "owner") {
      return NextResponse.json(
        { error: "Owner membership cannot be removed from this action." },
        { status: 409 },
      );
    }

    await auth.api.removeMember({
      headers: request.headers,
      body: {
        organizationId: orgId,
        memberIdOrEmail: member.id,
      },
    });

    return NextResponse.json({
      member: {
        id: member.id,
        userId: member.userId,
        email: member.email,
        role: member.role,
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
        : "Failed to remove organization member.";
    return NextResponse.json({ error: message }, { status });
  }
}
