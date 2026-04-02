import type {
  AskUserQuestionItem,
  AskUserQuestionOption,
  ConfirmPlanExecutionItem,
  ParsedToolResult,
} from "./tool-types";

export const TOOL_INPUT_UNAVAILABLE_MARKER = "__rnc_tool_input_unavailable__";

export const DEFAULT_CUSTOM_ANSWER_PLACEHOLDER =
  "Enter your custom answer...";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isUnavailableToolArgs = (value: unknown) =>
  isRecord(value) && value[TOOL_INPUT_UNAVAILABLE_MARKER] === true;

export const isCustomAnswerOptionLabel = (label: string) =>
  label.trim().toLowerCase() === "custom";

export const deepParseJsonValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return deepParseJsonValue(parsed);
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map(deepParseJsonValue);
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepParseJsonValue(val);
    }
    return result;
  }

  return value;
};

export const getRangeFromParsedToolArgs = (value: unknown): string | null => {
  if (!isRecord(value)) return null;

  if (typeof value.range === "string" && value.range.trim().length > 0) {
    return value.range;
  }

  if (isRecord(value.input)) {
    const nestedRange = value.input.range;
    if (typeof nestedRange === "string" && nestedRange.trim().length > 0) {
      return nestedRange;
    }
  }

  return null;
};

export const getSheetIdFromParsedToolArgs = (value: unknown): number | null => {
  if (!isRecord(value)) return null;

  if (typeof value.sheetId === "number" && Number.isFinite(value.sheetId)) {
    return value.sheetId;
  }

  if (isRecord(value.input)) {
    const nestedSheetId = value.input.sheetId;
    if (typeof nestedSheetId === "number" && Number.isFinite(nestedSheetId)) {
      return nestedSheetId;
    }
  }

  return null;
};

export const getCreatedSheetIdFromToolResult = (value: unknown): number | null => {
  if (!isRecord(value)) return null;

  if (typeof value.sheetId === "number" && Number.isFinite(value.sheetId)) {
    return value.sheetId;
  }

  if (
    isRecord(value.sheet) &&
    typeof value.sheet.sheetId === "number" &&
    Number.isFinite(value.sheet.sheetId)
  ) {
    return value.sheet.sheetId;
  }

  return null;
};

export const extractParsedToolResult = (
  result: unknown,
): ParsedToolResult | null => {
  if (!result) return null;

  // Handle LangChain ToolMessage object: result.kwargs.content
  if (isRecord(result)) {
    const r = result;
    if (r.kwargs && typeof r.kwargs === "object") {
      const kwargs = r.kwargs as Record<string, unknown>;
      if (typeof kwargs.content === "string") {
        try {
          const parsed = JSON.parse(kwargs.content);
          return isRecord(parsed) ? (parsed as ParsedToolResult) : null;
        } catch {
          return { error: kwargs.content };
        }
      }
    }
    // Direct object with success property
    if ("success" in r) {
      return r as ParsedToolResult;
    }
  }

  // Handle string result
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return isRecord(parsed) ? (parsed as ParsedToolResult) : null;
    } catch {
      return null;
    }
  }

  return null;
};

export const parseAskUserQuestionsFromArgs = (
  value: unknown,
): AskUserQuestionItem[] | null => {
  if (!isRecord(value)) return null;

  const source = isRecord(value.input)
    ? (value.input as Record<string, unknown>)
    : value;
  if (!Array.isArray(source.questions)) {
    return null;
  }

  const parsed = source.questions
    .map((entry) => {
      if (!isRecord(entry)) return null;

      const question =
        typeof entry.question === "string" ? entry.question.trim() : "";
      const header =
        typeof entry.header === "string" ? entry.header.trim() : "";
      const optionsRaw = Array.isArray(entry.options) ? entry.options : [];
      const options = optionsRaw
        .map((option) => {
          if (!isRecord(option)) return null;
          const label =
            typeof option.label === "string" ? option.label.trim() : "";
          const description =
            typeof option.description === "string"
              ? option.description.trim()
              : "";
          if (!label || !description) return null;
          return { label, description };
        })
        .filter((option): option is AskUserQuestionOption => option !== null);

      if (!question || !header || options.length < 1) {
        return null;
      }

      return {
        question,
        header,
        options,
        multiSelect: entry.multiSelect === true,
      };
    })
    .filter((question): question is AskUserQuestionItem => question !== null);

  return parsed.length > 0 ? parsed : null;
};

/**
 * Extract numbered properties from an object (e.g., step1, step2, ... or risk1, risk2, ...)
 * This handles cases where the model outputs individual properties instead of an array.
 */
const extractNumberedProperties = (
  source: Record<string, unknown>,
  prefix: string,
): string[] => {
  const results: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const key = `${prefix}${i}`;
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      results.push(value.trim());
    }
  }
  return results;
};

export const parseConfirmPlanExecutionFromArgs = (
  value: unknown,
): ConfirmPlanExecutionItem | null => {
  if (!isRecord(value)) {
    return null;
  }

  const source = isRecord(value.input)
    ? (value.input as Record<string, unknown>)
    : value;

  // Extract title - use fallback if missing
  const title =
    typeof source.title === "string" && source.title.trim().length > 0
      ? source.title.trim()
      : "Plan Confirmation";

  // Extract summary - use fallback if missing
  const summary =
    typeof source.summary === "string" && source.summary.trim().length > 0
      ? source.summary.trim()
      : "Review and approve this plan before applying changes.";

  const reason =
    typeof source.reason === "string" && source.reason.trim().length > 0
      ? source.reason.trim()
      : undefined;
  const reviewHeader =
    typeof source.reviewHeader === "string" &&
    source.reviewHeader.trim().length > 0
      ? source.reviewHeader.trim()
      : undefined;
  const approveButtonLabel =
    typeof source.approveButtonLabel === "string" &&
    source.approveButtonLabel.trim().length > 0
      ? source.approveButtonLabel.trim()
      : undefined;
  const requestChangesButtonLabel =
    typeof source.requestChangesButtonLabel === "string" &&
    source.requestChangesButtonLabel.trim().length > 0
      ? source.requestChangesButtonLabel.trim()
      : undefined;
  const submitChangesButtonLabel =
    typeof source.submitChangesButtonLabel === "string" &&
    source.submitChangesButtonLabel.trim().length > 0
      ? source.submitChangesButtonLabel.trim()
      : undefined;
  const feedbackPrompt =
    typeof source.feedbackPrompt === "string" &&
    source.feedbackPrompt.trim().length > 0
      ? source.feedbackPrompt.trim()
      : undefined;

  // Try to get steps from array first, then fall back to numbered properties (step1, step2, ...)
  let steps: string[] = [];
  if (Array.isArray(source.steps)) {
    steps = source.steps
      .map((step) => (typeof step === "string" ? step.trim() : ""))
      .filter(Boolean);
  }
  if (steps.length === 0) {
    steps = extractNumberedProperties(source, "step");
  }

  // Try to get risks from array first, then fall back to numbered properties (risk1, risk2, ...)
  let risks: string[] = [];
  if (Array.isArray(source.risks)) {
    risks = source.risks
      .map((risk) => (typeof risk === "string" ? risk.trim() : ""))
      .filter(Boolean);
  }
  if (risks.length === 0) {
    risks = extractNumberedProperties(source, "risk");
  }

  // Always return a valid item - no strict validation required
  // The UI will display whatever data is available
  return {
    title,
    summary,
    steps,
    risks,
    ...(reason ? { reason } : {}),
    ...(reviewHeader ? { reviewHeader } : {}),
    ...(approveButtonLabel ? { approveButtonLabel } : {}),
    ...(requestChangesButtonLabel ? { requestChangesButtonLabel } : {}),
    ...(submitChangesButtonLabel ? { submitChangesButtonLabel } : {}),
    ...(feedbackPrompt ? { feedbackPrompt } : {}),
  };
};
