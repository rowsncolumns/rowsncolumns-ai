export type AssistantSkillInstruction = {
  name: string;
  description: string;
  instructions: string;
  active: boolean;
};

const BRANDING_RULE_BLOCK = [
  "Branding guidelines are mandatory constraints for this conversation.",
  "Always apply branding rules when generating copy, structure, naming, colors, and style-related output.",
  "When producing spreadsheet models/reports/tables (for example DCF, LBO, budget, dashboards), apply a branding pass before completion.",
  "Branding pass means: align labels and wording with brand voice, and apply brand-aligned formatting/colors where formatting tools are available.",
  "Do not treat branding as optional unless the user explicitly asks for raw/unformatted output.",
  "Only deviate if the user explicitly asks to override a branding rule.",
].join("\n");

export const normalizeInstructionText = (value: string | undefined | null) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const mergeSystemInstructions = (
  primary: string | undefined | null,
  secondary: string | undefined | null,
) => {
  const first = normalizeInstructionText(primary);
  const second = normalizeInstructionText(secondary);

  if (first && second) {
    return `${first}\n\n${second}`;
  }
  return first ?? second;
};

export const buildSkillsInstruction = (skills: AssistantSkillInstruction[]) => {
  const activeSkills = skills.filter((skill) => {
    if (!skill.active) return false;
    if (!skill.name.trim()) return false;
    if (!skill.instructions.trim()) return false;
    return true;
  });

  const blocks = activeSkills.map((skill, index) => {
    const description = skill.description.trim();
    const instructions = skill.instructions.trim();

    return [
      `Skill ${index + 1}: ${skill.name.trim()}`,
      description ? `Description: ${description}` : null,
      `Instructions:\n${instructions}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "Branding and style consistency rules are always in effect.",
    BRANDING_RULE_BLOCK,
    ...(activeSkills.length > 0
      ? [
          "User-defined custom skills are available for this conversation.",
          "Apply any relevant active skills when planning or executing responses.",
          "If multiple skills conflict, prefer the most specific skill and continue; ask only if conflict blocks safe execution.",
        ]
      : []),
    ...blocks,
  ].join("\n\n");
};
