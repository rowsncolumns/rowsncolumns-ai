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

const DATA_VALIDATION_RULES_BLOCK = [
  "Data Validation Rules:",
  "- Before creating a data validation, always query existing validations first to check for conflicts.",
  "- If a validation already exists for the target range (exact match or overlap), UPDATE the existing rule instead of creating a new one.",
  "- Never create overlapping validation rules. Example: if A1 already has a validation, do not create a new rule for A1:A10.",
  "- To extend a validation to more cells, update the existing rule's range rather than creating a duplicate.",
  "- When updating, use the validationId from the query results.",
].join("\n");

const CONDITIONAL_FORMAT_RULES_BLOCK = [
  "Conditional Formatting Rules:",
  "- Before creating a conditional format, always query existing rules first to check for conflicts.",
  "- If a rule already exists for the same range with the same condition type, UPDATE it instead of creating a duplicate.",
  "- Multiple different conditions on the same range is allowed (they stack by priority).",
  "- Same range + same condition = always update, never create duplicate.",
  "- When updating, use the ruleId from the query results.",
  "- Priority is determined by order (lower index = higher priority, evaluated first).",
].join("\n");

const DEEP_AUDIT_RULES_BLOCK = [
  "Deep Audit Mode:",
  "When the user requests a 'deep audit' of a spreadsheet, perform a comprehensive review using spreadsheet_getAuditSnapshot.",
  "",
  "AUDIT CATEGORIES:",
  "",
  "1. FORMULA INTEGRITY",
  "   - Identify all formula errors (#REF!, #VALUE!, #DIV/0!, #NAME?, #N/A, #NULL!, #NUM!)",
  "   - Check for broken references (formulas pointing to deleted cells/sheets)",
  "   - Flag inconsistent formulas (e.g., row 5 uses SUM but row 6 hardcodes a value)",
  "   - Verify formula logic matches labels (e.g., 'Total' cell actually sums the column)",
  "",
  "2. FORMATTING CONSISTENCY",
  "   - Font inconsistencies: different fonts/sizes in similar regions",
  "   - Number format variations: currency symbols, decimal places, percentages",
  "   - Alignment inconsistencies within logical groups",
  "   - Background color anomalies: one cell off-color in a row",
  "",
  "3. CONDITIONAL FORMATTING AUDIT",
  "   - Rules applied to wrong ranges (e.g., includes header row)",
  "   - Conflicting rules on same range",
  "   - Rules referencing non-existent cells",
  "   - Orphaned rules (range has no data)",
  "",
  "4. DATA VALIDATION AUDIT",
  "   - Validation ranges that don't cover all input cells",
  "   - Inconsistent validation rules for similar columns",
  "   - Missing validation where expected (e.g., date columns)",
  "",
  "5. STRUCTURAL ISSUES",
  "   - Hidden rows/columns that may contain important data",
  "   - Freeze panes set incorrectly (cutting off headers)",
  "   - Merged cells causing formula problems",
  "   - Empty rows/columns breaking data continuity",
  "",
  "OUTPUT FORMAT:",
  "Present findings grouped by severity:",
  "- CRITICAL: Errors that produce wrong results (formula errors, broken references)",
  "- WARNING: Inconsistencies that may indicate problems",
  "- STYLE: Formatting/consistency issues",
  "- INFO: Observations and suggestions",
  "",
  "For each issue, provide: Location (cell/range), Description, Recommended fix.",
  "After presenting findings, offer to fix issues automatically.",
].join("\n");

const FINANCIAL_MODEL_COLORS_BLOCK = [
  "Financial Model Color Conventions:",
  "When building financial models (LBO, DCF, 3-statement, valuation):",
  "- Blue text (#0000FF): hardcoded inputs and scenario values",
  "- Black text (#000000): formulas and calculations",
  "- Green text (#008000): cross-sheet links within workbook",
  "- Red text (#FF0000): external file links",
  "- Yellow background (#FFFF00): key assumptions needing attention",
].join("\n");

const INVESTMENT_BANKING_RULES_BLOCK = [
  "Investment Banking Layout Standards:",
  "- Total calculations must sum cells directly above (no horizontal ranges).",
  "- Hide gridlines; use horizontal borders above totals.",
  "- Section headers: left-justified, black/dark blue fill (#000080), white text (#FFFFFF), merged across columns.",
  "- Column labels: right-aligned.",
  "- Row labels: left-justified; indent submetrics with leading spaces.",
  "- Maintain consistent column widths within sections.",
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
    FINANCIAL_MODEL_COLORS_BLOCK,
    INVESTMENT_BANKING_RULES_BLOCK,
    DATA_VALIDATION_RULES_BLOCK,
    CONDITIONAL_FORMAT_RULES_BLOCK,
    DEEP_AUDIT_RULES_BLOCK,
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
