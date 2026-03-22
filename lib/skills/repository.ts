import { db } from "@/lib/db/postgres";

export type AssistantSkillRecord = {
  id: string;
  userId: string;
  workspaceId: string | null;
  name: string;
  description: string;
  instructions: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type AssistantSkillRow = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  name: string;
  description: string;
  instructions: string;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type AssistantSkillScope = {
  userId: string;
  workspaceId?: string | null;
};

type CreateAssistantSkillInput = AssistantSkillScope & {
  name: string;
  description: string;
  instructions: string;
  active: boolean;
};

type UpdateAssistantSkillInput = AssistantSkillScope & {
  skillId: string;
  name?: string;
  description?: string;
  instructions?: string;
  active?: boolean;
};

type DeleteAssistantSkillInput = AssistantSkillScope & {
  skillId: string;
};

const normalizeWorkspaceId = (workspaceId?: string | null) => {
  const trimmed = workspaceId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const mapRowToSkill = (row: AssistantSkillRow): AssistantSkillRecord => ({
  id: row.id,
  userId: row.user_id,
  workspaceId: row.workspace_id,
  name: row.name,
  description: row.description,
  instructions: row.instructions,
  active: row.active,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

async function getSkillById({
  skillId,
  userId,
}: {
  skillId: string;
  userId: string;
}) {
  const rows = await db<AssistantSkillRow[]>`
    SELECT
      id,
      user_id,
      workspace_id,
      name,
      description,
      instructions,
      active,
      created_at,
      updated_at
    FROM assistant_skills
    WHERE id = ${skillId}
      AND user_id = ${userId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function listAssistantSkills({
  userId,
}: AssistantSkillScope): Promise<AssistantSkillRecord[]> {
  const rows = await db<AssistantSkillRow[]>`
    SELECT
      id,
      user_id,
      workspace_id,
      name,
      description,
      instructions,
      active,
      created_at,
      updated_at
    FROM assistant_skills
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return rows.map(mapRowToSkill);
}

export async function createAssistantSkill({
  userId,
  workspaceId,
  name,
  description,
  instructions,
  active,
}: CreateAssistantSkillInput): Promise<AssistantSkillRecord> {
  const id = crypto.randomUUID();
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);

  const rows = await db<AssistantSkillRow[]>`
    INSERT INTO assistant_skills (
      id,
      user_id,
      workspace_id,
      name,
      description,
      instructions,
      active
    )
    VALUES (
      ${id},
      ${userId},
      ${normalizedWorkspaceId},
      ${name},
      ${description},
      ${instructions},
      ${active}
    )
    RETURNING
      id,
      user_id,
      workspace_id,
      name,
      description,
      instructions,
      active,
      created_at,
      updated_at
  `;

  const skill = rows[0];
  if (!skill) {
    throw new Error("Failed to create assistant skill.");
  }

  return mapRowToSkill(skill);
}

export async function updateAssistantSkill({
  skillId,
  userId,
  name,
  description,
  instructions,
  active,
}: UpdateAssistantSkillInput): Promise<AssistantSkillRecord | null> {
  const existingSkill = await getSkillById({
    skillId,
    userId,
  });

  if (!existingSkill) {
    return null;
  }

  const rows = await db<AssistantSkillRow[]>`
    UPDATE assistant_skills
    SET
      name = ${name ?? existingSkill.name},
      description = ${description ?? existingSkill.description},
      instructions = ${instructions ?? existingSkill.instructions},
      active = ${active ?? existingSkill.active},
      updated_at = NOW()
    WHERE id = ${skillId}
      AND user_id = ${userId}
    RETURNING
      id,
      user_id,
      workspace_id,
      name,
      description,
      instructions,
      active,
      created_at,
      updated_at
  `;

  const skill = rows[0];
  if (!skill) {
    return null;
  }

  return mapRowToSkill(skill);
}

export async function deleteAssistantSkill({
  skillId,
  userId,
}: DeleteAssistantSkillInput): Promise<boolean> {
  const rows = await db<{ id: string }[]>`
    DELETE FROM assistant_skills
    WHERE id = ${skillId}
      AND user_id = ${userId}
    RETURNING id
  `;

  return rows.length > 0;
}
