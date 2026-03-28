type StreamingToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  argsText: string;
  result?: unknown;
};

type StreamingContentPart =
  | StreamingToolCallPart
  | {
      type: "text" | "reasoning";
      text?: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringifyUnknown = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return value.message || value.name;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const normalizeStreamingToolResult = (
  result: unknown,
  isError: boolean,
) => {
  if (!isError) {
    return result;
  }

  if (isRecord(result) && result.success === false && "error" in result) {
    return result;
  }

  return {
    success: false,
    error: stringifyUnknown(result),
  };
};

export const findLatestPendingToolCallIndexByName = (
  parts: StreamingContentPart[],
  toolName: string,
) => {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (
      part &&
      part.type === "tool-call" &&
      part.toolName === toolName &&
      part.result === undefined
    ) {
      return index;
    }
  }

  return -1;
};

export const setStreamingToolResult = (
  parts: StreamingContentPart[],
  indexByToolCallId: Map<string, number>,
  toolCallId: string,
  toolName: string,
  result: unknown,
  args?: unknown,
  isError = false,
) => {
  const normalizedResult = normalizeStreamingToolResult(result, isError);

  let existingIndex = indexByToolCallId.get(toolCallId);
  if (existingIndex === undefined) {
    const fallbackIndex = findLatestPendingToolCallIndexByName(parts, toolName);
    if (fallbackIndex !== -1) {
      existingIndex = fallbackIndex;
      indexByToolCallId.set(toolCallId, fallbackIndex);
    }
  }

  if (existingIndex === undefined) {
    return;
  }

  const existingPart = parts[existingIndex];
  if (!existingPart || existingPart.type !== "tool-call") {
    return;
  }

  if (args !== undefined) {
    existingPart.args = args;
    existingPart.argsText = JSON.stringify(args, null, 2);
  }

  existingPart.result = normalizedResult;
};

export type {
  StreamingContentPart as ToolStreamContentPart,
  StreamingToolCallPart as ToolStreamToolCallPart,
};
