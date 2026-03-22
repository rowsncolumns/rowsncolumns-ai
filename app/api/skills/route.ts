import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import {
  createAssistantSkill,
  deleteAssistantSkill,
  listAssistantSkills,
  updateAssistantSkill,
} from "@/lib/skills/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workspaceIdSchema = z
  .string()
  .trim()
  .max(200, "workspaceId is too long.")
  .optional();

const createSkillSchema = z.object({
  workspaceId: workspaceIdSchema,
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
    workspaceId: workspaceIdSchema,
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
  workspaceId: workspaceIdSchema,
  skillId: z.string().trim().min(1, "skillId is required."),
});

function formatValidationError(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function getValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message || "Invalid request.";
}

export async function GET(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceParse = workspaceIdSchema.safeParse(
      searchParams.get("workspaceId") ?? undefined,
    );

    if (!workspaceParse.success) {
      return formatValidationError(getValidationMessage(workspaceParse.error));
    }

    const skills = await listAssistantSkills({
      userId,
      workspaceId: workspaceParse.data,
    });

    return NextResponse.json({ skills });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load skills.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json();
    const parsed = createSkillSchema.safeParse(body);
    if (!parsed.success) {
      return formatValidationError(getValidationMessage(parsed.error));
    }

    const skill = await createAssistantSkill({
      userId,
      workspaceId: parsed.data.workspaceId,
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

export async function PATCH(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json();
    const parsed = updateSkillSchema.safeParse(body);
    if (!parsed.success) {
      return formatValidationError(getValidationMessage(parsed.error));
    }

    const skill = await updateAssistantSkill({
      skillId: parsed.data.skillId,
      userId,
      workspaceId: parsed.data.workspaceId,
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

export async function DELETE(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json();
    const parsed = deleteSkillSchema.safeParse(body);
    if (!parsed.success) {
      return formatValidationError(getValidationMessage(parsed.error));
    }

    const deleted = await deleteAssistantSkill({
      skillId: parsed.data.skillId,
      userId,
      workspaceId: parsed.data.workspaceId,
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
