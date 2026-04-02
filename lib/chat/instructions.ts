export type AssistantSkillInstruction = {
  name: string;
  description: string;
  instructions: string;
  active: boolean;
};

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

  if (activeSkills.length === 0) {
    return "";
  }

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
    "User-defined custom skills are available for this conversation.",
    "Apply any relevant active skills when planning or executing responses.",
    "If multiple skills conflict, prefer the most specific skill and continue; ask only if conflict blocks safe execution.",
    ...blocks,
  ].join("\n\n");
};
