import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import {
  getOrganizationRoleForUser,
  isOrganizationAdminRole,
} from "@/lib/auth/organization-membership";
import {
  createAssistantSkill,
  deleteAssistantSkill,
  listAssistantSkills,
  updateAssistantSkill,
} from "@/lib/skills/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

const createSkillSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Skill name is required.")
    .max(120, "Skill name is too long."),
  description: z
    .string()
    .max(4000, "Skill description is too long.")
    .optional()
    .default(""),
  instructions: z
    .string()
    .trim()
    .min(1, "Skill instructions are required.")
    .max(20000, "Skill instructions are too long."),
  active: z.boolean().optional().default(true),
});

const updateSkillSchema = z
  .object({
    skillId: z.string().trim().min(1, "skillId is required."),
    name: z
      .string()
      .trim()
      .min(1, "Skill name cannot be empty.")
      .max(120, "Skill name is too long.")
      .optional(),
    description: z
      .string()
      .max(4000, "Skill description is too long.")
      .optional(),
    instructions: z
      .string()
      .trim()
      .min(1, "Skill instructions cannot be empty.")
      .max(20000, "Skill instructions are too long.")
      .optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.instructions !== undefined ||
      value.active !== undefined,
    { message: "At least one field must be provided to update." },
  );

const deleteSkillSchema = z.object({
  skillId: z.string().trim().min(1, "skillId is required."),
});

const getValidationMessage = (error: z.ZodError) =>
  error.issues[0]?.message || "Invalid request.";

const resolveAdminContext = async (context: RouteContext) => {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const { orgId: rawOrgId } = await context.params;
  const organizationId = rawOrgId.trim();
  if (!organizationId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Invalid organization." },
        { status: 400 },
      ),
    };
  }

  const role = await getOrganizationRoleForUser({
    userId,
    organizationId,
  });
  if (!role) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "You are not a member of this organization." },
        { status: 403 },
      ),
    };
  }

  if (!isOrganizationAdminRole(role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Only organization admins can manage skills." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    userId,
    organizationId,
  };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const authContext = await resolveAdminContext(context);
    if (!authContext.ok) {
      return authContext.response;
    }

    const skills = await listAssistantSkills({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    });

    return NextResponse.json({ skills });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load skills.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const authContext = await resolveAdminContext(context);
    if (!authContext.ok) {
      return authContext.response;
    }

    const body = await request.json();
    const parsed = createSkillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: getValidationMessage(parsed.error) },
        { status: 400 },
      );
    }

    const skill = await createAssistantSkill({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      name: parsed.data.name,
      description: parsed.data.description.trim(),
      instructions: parsed.data.instructions,
      active: parsed.data.active,
    });

    return NextResponse.json({ skill }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create skill.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const authContext = await resolveAdminContext(context);
    if (!authContext.ok) {
      return authContext.response;
    }

    const body = await request.json();
    const parsed = updateSkillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: getValidationMessage(parsed.error) },
        { status: 400 },
      );
    }

    const skill = await updateAssistantSkill({
      skillId: parsed.data.skillId,
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      name: parsed.data.name,
      description: parsed.data.description?.trim(),
      instructions: parsed.data.instructions,
      active: parsed.data.active,
    });

    if (!skill) {
      return NextResponse.json({ error: "Skill not found." }, { status: 404 });
    }

    return NextResponse.json({ skill });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update skill.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const authContext = await resolveAdminContext(context);
    if (!authContext.ok) {
      return authContext.response;
    }

    const body = await request.json();
    const parsed = deleteSkillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: getValidationMessage(parsed.error) },
        { status: 400 },
      );
    }

    const deleted = await deleteAssistantSkill({
      skillId: parsed.data.skillId,
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    });

    if (!deleted) {
      return NextResponse.json({ error: "Skill not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete skill.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
