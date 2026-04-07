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

const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug format."),
});

export async function PATCH(request: Request, context: RouteContext) {
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
        { error: "Only organization admins can update settings." },
        { status: 403 },
      );
    }

    const payload = await request.json().catch(() => null);
    const parsed = updateOrganizationSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }

    const result = await auth.api.updateOrganization({
      headers: request.headers,
      body: {
        organizationId: orgId,
        data: {
          name: parsed.data.name,
          slug: parsed.data.slug,
        },
      },
    });

    return NextResponse.json({
      id: result?.id ?? orgId,
      name: result?.name ?? parsed.data.name,
      slug: result?.slug ?? parsed.data.slug,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update organization.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
