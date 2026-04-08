import { readFileSync } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db/postgres";

export type AssistantSkillRecord = {
  id: string;
  userId: string;
  organizationId: string | null;
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
  organizationId: string;
  organizationName?: string | null;
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

const DEFAULT_BRANDING_SKILL_NAME = "Brand Guidelines";
const DEFAULT_BRANDING_SKILL_DESCRIPTION =
  "Default branding constraints applied to generated spreadsheet content.";
const DEFAULT_BRANDING_SKILL_FALLBACK_INSTRUCTIONS = `Always follow the user's brand consistently when generating spreadsheet content.

Priority rules:
1. If the user provided explicit brand guidance in this conversation, treat it as highest priority.
2. Keep tone, wording, naming, and visual choices aligned with brand guidance.
3. For colors, prefer a cohesive palette and maintain readability/contrast.
4. For headings, labels, and copy, stay concise, clear, and consistent.
5. If brand guidance is missing or ambiguous, use neutral professional defaults and ask one clarifying question when needed.

Never ignore brand constraints unless the user explicitly asks to override them.`;

const loadDefaultBrandingSkillInstructions = () => {
  try {
    const filePath = path.resolve(process.cwd(), "BRAND_GUIDELINES.md");
    const fileContents = readFileSync(filePath, "utf8").trim();
    if (fileContents.length > 0) {
      return fileContents;
    }
  } catch {
    // Fall back to inline default instructions if file is unavailable.
  }

  return DEFAULT_BRANDING_SKILL_FALLBACK_INSTRUCTIONS;
};

const DEFAULT_BRANDING_SKILL_INSTRUCTIONS =
  loadDefaultBrandingSkillInstructions();

const BRAND_GUIDELINES_TITLE_PATTERN = /^#\s+.*Brand Guidelines\s*$/m;
const BRAND_NAME_BULLET_PATTERN = /^- Brand name:\s*.*$/m;
const BRAND_CORE_SECTION_PATTERN = /^##\s+1\)\s+Brand Core\s*$/m;

const shouldBootstrapDefaultBrandingSkill = () => {
  const value = process.env.AUTO_CREATE_BRANDING_SKILL?.trim().toLowerCase();
  if (value === "false" || value === "0") {
    return false;
  }
  return true;
};

const normalizeNonEmptyString = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getDefaultBrandingSkillId = (organizationId: string) =>
  `default-brand-guidelines:org:${organizationId}`;

const applyBrandNameToDefaultInstructions = (
  organizationName: string | null | undefined,
) => {
  const normalizedOrganizationName = normalizeNonEmptyString(organizationName);
  if (!normalizedOrganizationName) {
    return DEFAULT_BRANDING_SKILL_INSTRUCTIONS;
  }

  const title = `# ${normalizedOrganizationName} Brand Guidelines`;
  const brandNameBullet = `- Brand name: ${normalizedOrganizationName}`;

  let instructions = DEFAULT_BRANDING_SKILL_INSTRUCTIONS;
  if (BRAND_GUIDELINES_TITLE_PATTERN.test(instructions)) {
    instructions = instructions.replace(BRAND_GUIDELINES_TITLE_PATTERN, title);
  } else {
    instructions = `${title}\n\n${instructions}`;
  }

  if (BRAND_NAME_BULLET_PATTERN.test(instructions)) {
    instructions = instructions.replace(
      BRAND_NAME_BULLET_PATTERN,
      brandNameBullet,
    );
  } else if (BRAND_CORE_SECTION_PATTERN.test(instructions)) {
    instructions = instructions.replace(
      BRAND_CORE_SECTION_PATTERN,
      (match) => `${match}\n${brandNameBullet}`,
    );
  } else {
    instructions = `${instructions.trimEnd()}\n\n## 1) Brand Core\n${brandNameBullet}\n`;
  }

  return instructions;
};

const mapRowToSkill = (row: AssistantSkillRow): AssistantSkillRecord => ({
  id: row.id,
  userId: row.user_id,
  organizationId: row.workspace_id,
  name: row.name,
  description: row.description,
  instructions: row.instructions,
  active: row.active,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

async function getSkillById({
  skillId,
  organizationId,
}: {
  skillId: string;
  organizationId: string;
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
    FROM public.assistant_skills
    WHERE id = ${skillId}
      AND workspace_id = ${organizationId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export type GetAssistantSkillInput = {
  skillId: string;
  organizationId: string;
};

export async function getAssistantSkill({
  skillId,
  organizationId,
}: GetAssistantSkillInput): Promise<AssistantSkillRecord | null> {
  const row = await getSkillById({ skillId, organizationId });
  return row ? mapRowToSkill(row) : null;
}

async function resolveOrganizationNameById(
  organizationId: string,
): Promise<string | null> {
  const normalizedOrganizationId = normalizeNonEmptyString(organizationId);
  if (!normalizedOrganizationId) {
    return null;
  }

  try {
    const rows = await db<{ name: string | null }[]>`
      SELECT name
      FROM public.organization
      WHERE id = ${normalizedOrganizationId}
      LIMIT 1
    `;
    return normalizeNonEmptyString(rows[0]?.name ?? null);
  } catch {
    return null;
  }
}

async function ensureDefaultBrandingSkillForOrganization({
  userId,
  organizationId,
  organizationName,
}: AssistantSkillScope) {
  if (!shouldBootstrapDefaultBrandingSkill()) {
    return;
  }

  const normalizedOrganizationId = normalizeNonEmptyString(organizationId);
  if (!normalizedOrganizationId) {
    return;
  }

  const existingSkills = await db<{ id: string }[]>`
    SELECT id
    FROM public.assistant_skills
    WHERE workspace_id = ${normalizedOrganizationId}
    LIMIT 1
  `;

  if (existingSkills.length > 0) {
    return;
  }

  const defaultSkillId = getDefaultBrandingSkillId(normalizedOrganizationId);
  const resolvedOrganizationName =
    normalizeNonEmptyString(organizationName) ??
    (await resolveOrganizationNameById(normalizedOrganizationId));
  const defaultInstructions = applyBrandNameToDefaultInstructions(
    resolvedOrganizationName,
  );

  await db`
    INSERT INTO public.assistant_skills (
      id,
      user_id,
      workspace_id,
      name,
      description,
      instructions,
      active
    )
    VALUES (
      ${defaultSkillId},
      ${userId},
      ${normalizedOrganizationId},
      ${DEFAULT_BRANDING_SKILL_NAME},
      ${DEFAULT_BRANDING_SKILL_DESCRIPTION},
      ${defaultInstructions},
      ${true}
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function listAssistantSkills({
  userId,
  organizationId,
  organizationName,
}: AssistantSkillScope): Promise<AssistantSkillRecord[]> {
  const normalizedOrganizationId = normalizeNonEmptyString(organizationId);
  if (!normalizedOrganizationId) {
    return [];
  }

  await ensureDefaultBrandingSkillForOrganization({
    userId,
    organizationId: normalizedOrganizationId,
    organizationName,
  });

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
    FROM public.assistant_skills
    WHERE workspace_id = ${normalizedOrganizationId}
    ORDER BY created_at DESC
  `;

  return rows.map(mapRowToSkill);
}

export async function createAssistantSkill({
  userId,
  organizationId,
  name,
  description,
  instructions,
  active,
}: CreateAssistantSkillInput): Promise<AssistantSkillRecord> {
  const id = crypto.randomUUID();

  const rows = await db<AssistantSkillRow[]>`
    INSERT INTO public.assistant_skills (
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
      ${organizationId},
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
  organizationId,
  name,
  description,
  instructions,
  active,
}: UpdateAssistantSkillInput): Promise<AssistantSkillRecord | null> {
  const existingSkill = await getSkillById({
    skillId,
    organizationId,
  });

  if (!existingSkill) {
    return null;
  }

  const rows = await db<AssistantSkillRow[]>`
    UPDATE public.assistant_skills
    SET
      name = ${name ?? existingSkill.name},
      description = ${description ?? existingSkill.description},
      instructions = ${instructions ?? existingSkill.instructions},
      active = ${active ?? existingSkill.active},
      updated_at = NOW()
    WHERE id = ${skillId}
      AND workspace_id = ${organizationId}
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
  organizationId,
}: DeleteAssistantSkillInput): Promise<boolean> {
  const rows = await db<{ id: string }[]>`
    DELETE FROM public.assistant_skills
    WHERE id = ${skillId}
      AND workspace_id = ${organizationId}
    RETURNING id
  `;

  return rows.length > 0;
}
