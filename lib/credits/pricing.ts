export const INITIAL_CREDITS = 30;
export const MIN_CREDITS_PER_RUN = 1;
export const MAX_CREDITS_PER_RUN = 6;
export const LONG_OUTPUT_TOKEN_THRESHOLD = 1500;
export const HEAVY_TOOL_CALL_THRESHOLD = 3;

type CreditPricingInput = {
  model?: string;
  outputChars: number;
  toolCallCount: number;
};

const LIGHT_MODELS = ["gpt-5.4-nano", "gpt-5-nano", "gpt-4.1-nano"];

const MID_MODELS = [
  "gpt-5.4-mini",
  "gpt-5-mini",
  "gpt-4.1-mini",
  "o4-mini",
  "claude-haiku",
];

const HEAVY_MODELS = [
  "gpt-5.4",
  "gpt-5.2-chat",
  "gpt-4.1",
  "o3",
  "claude-sonnet",
];

const OPUS_MODELS = ["claude-opus"];

export const estimateTokensFromChars = (chars: number) => {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
};

export const resolveModelMultiplier = (model?: string) => {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) return 2;

  if (OPUS_MODELS.some((token) => normalized.includes(token))) {
    return 3;
  }

  if (LIGHT_MODELS.some((token) => normalized.includes(token))) {
    return 1;
  }

  if (MID_MODELS.some((token) => normalized.includes(token))) {
    return 1.5;
  }

  if (HEAVY_MODELS.some((token) => normalized.includes(token))) {
    return 2;
  }

  return 2;
};

export const calculateChatRunCredits = ({
  model,
  outputChars,
  toolCallCount,
}: CreditPricingInput) => {
  const modelMultiplier = resolveModelMultiplier(model);
  const estimatedOutputTokens = estimateTokensFromChars(outputChars);
  const longOutputAdder =
    estimatedOutputTokens > LONG_OUTPUT_TOKEN_THRESHOLD ? 1 : 0;
  const toolCallAdder = toolCallCount > HEAVY_TOOL_CALL_THRESHOLD ? 1 : 0;

  const requestedCredits = Math.ceil(
    1 * modelMultiplier + longOutputAdder + toolCallAdder,
  );
  const credits = Math.max(
    MIN_CREDITS_PER_RUN,
    Math.min(MAX_CREDITS_PER_RUN, requestedCredits),
  );

  return {
    credits,
    requestedCredits,
    modelMultiplier,
    estimatedOutputTokens,
    longOutputAdder,
    toolCallAdder,
  };
};
