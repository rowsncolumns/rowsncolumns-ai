import type { ChatStreamEvent } from "@/lib/chat/protocol";

export type AssistantContextUsage = Extract<
  ChatStreamEvent,
  { type: "context.usage" }
>;

export type AssistantContextUsageByThread = Record<string, AssistantContextUsage>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const tryParseJsonString = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const normalizeContextUsageCandidate = (
  input: unknown,
  depth = 0,
): unknown => {
  if (depth > 3) {
    return input;
  }

  const parsed = tryParseJsonString(input);
  if (!isRecord(parsed)) {
    return parsed;
  }

  if (parsed.type === "context.usage") {
    return parsed;
  }

  if ("data" in parsed) {
    return normalizeContextUsageCandidate(parsed.data, depth + 1);
  }

  if ("eventData" in parsed) {
    return normalizeContextUsageCandidate(parsed.eventData, depth + 1);
  }

  return parsed;
};

export const parseAssistantContextUsageEvent = (
  value: unknown,
): AssistantContextUsage | null => {
  const candidate = normalizeContextUsageCandidate(value);
  if (!isRecord(candidate) || candidate.type !== "context.usage") {
    return null;
  }

  const runId = toNonEmptyString(candidate.runId);
  const model = toNonEmptyString(candidate.model);
  const inputTokensPeak = toFiniteNumber(candidate.inputTokensPeak);
  const contextWindowTokens = toFiniteNumber(candidate.contextWindowTokens);
  const usedPercent = toFiniteNumber(candidate.usedPercent);
  const remainingPercent = toFiniteNumber(candidate.remainingPercent);
  const warning = candidate.warning;

  if (
    !runId ||
    !model ||
    inputTokensPeak === null ||
    contextWindowTokens === null ||
    usedPercent === null ||
    remainingPercent === null ||
    (warning !== "normal" && warning !== "high")
  ) {
    return null;
  }

  return {
    type: "context.usage",
    runId,
    model,
    inputTokensPeak: Math.max(0, Math.round(inputTokensPeak)),
    contextWindowTokens: Math.max(1, Math.round(contextWindowTokens)),
    usedPercent: Math.min(100, Math.max(0, Math.round(usedPercent))),
    remainingPercent: Math.min(100, Math.max(0, Math.round(remainingPercent))),
    warning,
  };
};

export const getLatestContextUsageFromRunEvents = (
  events: ReadonlyArray<{ data: unknown }>,
): AssistantContextUsage | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const parsed = parseAssistantContextUsageEvent(events[index]?.data);
    if (parsed) {
      return parsed;
    }
  }
  return null;
};

export const setThreadContextUsage = (
  previous: AssistantContextUsageByThread,
  threadId: string,
  usage: AssistantContextUsage,
): AssistantContextUsageByThread => {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return previous;
  }

  return {
    ...previous,
    [normalizedThreadId]: usage,
  };
};

export const clearThreadContextUsage = (
  previous: AssistantContextUsageByThread,
  threadId: string | undefined,
): AssistantContextUsageByThread => {
  const normalizedThreadId = threadId?.trim();
  if (!normalizedThreadId || !(normalizedThreadId in previous)) {
    return previous;
  }

  const next = { ...previous };
  delete next[normalizedThreadId];
  return next;
};

export const getThreadContextUsage = (
  state: AssistantContextUsageByThread,
  threadId: string | undefined,
): AssistantContextUsage | null => {
  const normalizedThreadId = threadId?.trim();
  if (!normalizedThreadId) {
    return null;
  }

  return state[normalizedThreadId] ?? null;
};
