type JsonRecord = Record<string, unknown>;

const LOW_BALANCE_ERROR_CODES = new Set([
  "insufficient_quota",
  "billing_hard_limit_reached",
  "credit_balance_too_low",
]);

const LOW_BALANCE_MESSAGE_GENERIC =
  "The selected AI provider account is out of credits. Please switch models or ask your workspace admin to top up provider billing.";

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const tryParseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const stripErrorPrefix = (value: string) =>
  value.replace(/^(model|processing)\s+error:\s*/i, "").trim();

const stripLeadingStatusCode = (value: string) =>
  value.replace(/^\d{3}\s+/, "").trim();

const extractJsonPayload = (value: string): unknown | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = tryParseJson(trimmed);
  if (direct !== null) {
    return direct;
  }

  const statusPrefixed = trimmed.match(/^\d{3}\s+([\s\S]+)$/);
  if (statusPrefixed) {
    const parsed = tryParseJson(statusPrefixed[1].trim());
    if (parsed !== null) {
      return parsed;
    }
  }

  const jsonStart = trimmed.indexOf("{");
  if (jsonStart > 0) {
    const parsed = tryParseJson(trimmed.slice(jsonStart).trim());
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const extractMessageFromPayload = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.error === "string" && value.error.trim()) {
    return value.error.trim();
  }

  if (isRecord(value.error)) {
    const nestedError = value.error;
    if (typeof nestedError.message === "string" && nestedError.message.trim()) {
      return nestedError.message.trim();
    }
  }

  if (typeof value.message === "string" && value.message.trim()) {
    return value.message.trim();
  }

  return null;
};

const extractErrorCodeFromPayload = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.code === "string" && value.code.trim()) {
    return value.code.trim().toLowerCase();
  }

  if (typeof value.type === "string" && value.type.trim()) {
    return value.type.trim().toLowerCase();
  }

  if (isRecord(value.error)) {
    const nestedError = value.error;
    if (typeof nestedError.code === "string" && nestedError.code.trim()) {
      return nestedError.code.trim().toLowerCase();
    }

    if (typeof nestedError.type === "string" && nestedError.type.trim()) {
      return nestedError.type.trim().toLowerCase();
    }
  }

  return null;
};

const detectProviderLabel = (value: string): "Anthropic" | "OpenAI" | null => {
  const lowered = value.toLowerCase();
  if (lowered.includes("anthropic")) {
    return "Anthropic";
  }
  if (lowered.includes("openai")) {
    return "OpenAI";
  }
  return null;
};

export const isProviderLowBalanceErrorMessage = (
  value: string,
  payload?: unknown,
) => {
  const code = extractErrorCodeFromPayload(payload);
  if (code && LOW_BALANCE_ERROR_CODES.has(code)) {
    return true;
  }

  // Anthropic low-balance currently arrives as invalid_request_error, so keep
  // a narrow text fallback for that provider message.
  return value.toLowerCase().includes("credit balance is too low");
};

const buildLowBalanceMessage = (
  providerLabel: "Anthropic" | "OpenAI" | null,
) => {
  if (!providerLabel) {
    return LOW_BALANCE_MESSAGE_GENERIC;
  }

  return `The ${providerLabel} API account is out of credits. Please switch models or ask your workspace admin to top up ${providerLabel} billing.`;
};

export const normalizeAssistantErrorMessage = (
  rawError: string,
  fallbackMessage = "Assistant request failed.",
) => {
  const trimmedRaw = rawError.trim();
  if (!trimmedRaw) {
    return fallbackMessage;
  }

  const strippedPrefix = stripErrorPrefix(trimmedRaw);
  const parsedPayload = extractJsonPayload(strippedPrefix);
  const extractedMessage = extractMessageFromPayload(parsedPayload);
  const normalizedMessage = stripLeadingStatusCode(
    extractedMessage ?? strippedPrefix,
  );
  const detectionText = [
    trimmedRaw,
    strippedPrefix,
    extractedMessage ?? "",
  ].join("\n");

  if (isProviderLowBalanceErrorMessage(detectionText, parsedPayload)) {
    return buildLowBalanceMessage(detectProviderLabel(detectionText));
  }

  return normalizedMessage || fallbackMessage;
};
