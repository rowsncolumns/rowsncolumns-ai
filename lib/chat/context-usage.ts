export type ContextUsageWarning = "normal" | "high";

export type ContextUsageSnapshot = {
  model: string;
  inputTokensPeak: number;
  contextWindowTokens: number;
  usedPercent: number;
  remainingPercent: number;
  warning: ContextUsageWarning;
};

export const CONTEXT_WARNING_THRESHOLD_USED_PERCENT = 70;
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

const MODEL_CONTEXT_WINDOWS: Array<{
  pattern: RegExp;
  tokens: number;
}> = [
  // Claude 4.6 family: 1M context
  { pattern: /^claude-(sonnet|opus)-4-6/i, tokens: 1_000_000 },
  // Claude 4.5 / older: 200K (Sonnet 4.5 can do 1M with beta header)
  { pattern: /^claude-(sonnet|opus|haiku)/i, tokens: 200_000 },
  // OpenAI reasoning models
  { pattern: /^o3/i, tokens: 200_000 },
  { pattern: /^o4-mini/i, tokens: 200_000 },
  // GPT-5.4 family: 1.05M
  { pattern: /^gpt-5\.4/i, tokens: 1_050_000 },
  // GPT-5.x (5.0–5.3): 400K
  { pattern: /^gpt-5/i, tokens: 400_000 },
  // GPT-4.1: ~1M
  { pattern: /^gpt-4\.1/i, tokens: 1_048_000 },
];

const toPositiveInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getNestedValue = (value: unknown, path: string[]): unknown => {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const extractViaPaths = (value: unknown, paths: string[][]): number | null => {
  for (const path of paths) {
    const parsed = toPositiveInt(getNestedValue(value, path));
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
};

const collectTokenCandidates = (
  value: unknown,
  visited = new Set<object>(),
  depth = 0,
): number[] => {
  if (depth > 6 || !value || typeof value !== "object") {
    return [];
  }

  if (visited.has(value)) {
    return [];
  }
  visited.add(value);

  const candidates: number[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      candidates.push(...collectTokenCandidates(item, visited, depth + 1));
    }
    return candidates;
  }

  const record = value as Record<string, unknown>;
  const keys = ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens"];
  for (const key of keys) {
    if (key in record) {
      const parsed = toPositiveInt(record[key]);
      if (parsed !== null) {
        candidates.push(parsed);
      }
    }
  }

  for (const nested of Object.values(record)) {
    candidates.push(...collectTokenCandidates(nested, visited, depth + 1));
  }

  return candidates;
};

export const resolveModelContextWindowTokens = (model: string | undefined) => {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return DEFAULT_CONTEXT_WINDOW_TOKENS;
  }

  for (const entry of MODEL_CONTEXT_WINDOWS) {
    if (entry.pattern.test(normalized)) {
      return entry.tokens;
    }
  }

  return DEFAULT_CONTEXT_WINDOW_TOKENS;
};

export const extractInputTokensFromModelEndData = (
  eventData: unknown,
): number | null => {
  const directPathCandidates = [
    ["usage_metadata", "input_tokens"],
    ["usageMetadata", "inputTokens"],
    ["usage", "input_tokens"],
    ["usage", "prompt_tokens"],
    ["usage", "inputTokens"],
    ["usage", "promptTokens"],
    ["token_usage", "input_tokens"],
    ["token_usage", "prompt_tokens"],
    ["tokenUsage", "inputTokens"],
    ["tokenUsage", "promptTokens"],
    ["response_metadata", "usage", "input_tokens"],
    ["response_metadata", "usage", "prompt_tokens"],
    ["response_metadata", "token_usage", "input_tokens"],
    ["response_metadata", "token_usage", "prompt_tokens"],
    ["responseMetadata", "usage", "inputTokens"],
    ["responseMetadata", "usage", "promptTokens"],
    ["llmOutput", "tokenUsage", "promptTokens"],
    ["output", "usage_metadata", "input_tokens"],
    ["output", "usage", "input_tokens"],
    ["output", "usage", "prompt_tokens"],
    ["output", "response_metadata", "usage", "input_tokens"],
    ["output", "response_metadata", "usage", "prompt_tokens"],
    ["output", "response_metadata", "token_usage", "input_tokens"],
    ["output", "response_metadata", "token_usage", "prompt_tokens"],
  ];

  const direct = extractViaPaths(eventData, directPathCandidates);
  if (direct !== null) {
    return direct;
  }

  const candidates = collectTokenCandidates(eventData);
  if (candidates.length === 0) {
    return null;
  }

  return Math.max(...candidates);
};

export const buildContextUsageSnapshot = (input: {
  model: string;
  inputTokensPeak: number;
  contextWindowTokens: number;
  warningThresholdUsedPercent?: number;
}): ContextUsageSnapshot | null => {
  const inputTokensPeak = Math.max(0, Math.floor(input.inputTokensPeak));
  const contextWindowTokens = Math.max(
    1,
    Math.floor(input.contextWindowTokens),
  );
  if (inputTokensPeak <= 0) {
    return null;
  }

  const usedPercentRaw = (inputTokensPeak / contextWindowTokens) * 100;
  const usedPercent = Math.min(100, Math.max(0, Math.round(usedPercentRaw)));
  const remainingPercent = Math.max(0, 100 - usedPercent);
  const threshold =
    input.warningThresholdUsedPercent ?? CONTEXT_WARNING_THRESHOLD_USED_PERCENT;

  return {
    model: input.model,
    inputTokensPeak,
    contextWindowTokens,
    usedPercent,
    remainingPercent,
    warning: usedPercent >= threshold ? "high" : "normal",
  };
};

export const getNextContextUsageSnapshot = (input: {
  model: string;
  modelEndEventData: unknown;
  currentPeakInputTokens: number;
}) => {
  const extractedInputTokens = extractInputTokensFromModelEndData(
    input.modelEndEventData,
  );
  if (extractedInputTokens === null) {
    return {
      nextPeakInputTokens: input.currentPeakInputTokens,
      snapshot: null,
      didIncreasePeak: false,
    };
  }

  const nextPeakInputTokens = Math.max(
    input.currentPeakInputTokens,
    extractedInputTokens,
  );
  const didIncreasePeak = nextPeakInputTokens > input.currentPeakInputTokens;
  if (!didIncreasePeak) {
    return {
      nextPeakInputTokens,
      snapshot: null,
      didIncreasePeak,
    };
  }

  const contextWindowTokens = resolveModelContextWindowTokens(input.model);
  return {
    nextPeakInputTokens,
    snapshot: buildContextUsageSnapshot({
      model: input.model,
      inputTokensPeak: nextPeakInputTokens,
      contextWindowTokens,
    }),
    didIncreasePeak,
  };
};
