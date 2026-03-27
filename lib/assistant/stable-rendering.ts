type RecordLike = Record<string, unknown>;

export type StableMessagePartRange =
  | { type: "single"; index: number }
  | { type: "toolGroup"; startIndex: number; endIndex: number }
  | { type: "reasoningGroup"; startIndex: number; endIndex: number };

const isRecord = (value: unknown): value is RecordLike =>
  typeof value === "object" && value !== null;

export const groupStableMessageParts = (
  partTypes: string[],
): StableMessagePartRange[] => {
  const ranges: StableMessagePartRange[] = [];
  let toolGroupStart = -1;
  let reasoningGroupStart = -1;

  for (let index = 0; index < partTypes.length; index += 1) {
    const type = partTypes[index];

    if (type === "tool-call") {
      if (reasoningGroupStart !== -1) {
        ranges.push({
          type: "reasoningGroup",
          startIndex: reasoningGroupStart,
          endIndex: index - 1,
        });
        reasoningGroupStart = -1;
      }
      if (toolGroupStart === -1) {
        toolGroupStart = index;
      }
      continue;
    }

    if (type === "reasoning") {
      if (toolGroupStart !== -1) {
        ranges.push({
          type: "toolGroup",
          startIndex: toolGroupStart,
          endIndex: index - 1,
        });
        toolGroupStart = -1;
      }
      if (reasoningGroupStart === -1) {
        reasoningGroupStart = index;
      }
      continue;
    }

    if (toolGroupStart !== -1) {
      ranges.push({
        type: "toolGroup",
        startIndex: toolGroupStart,
        endIndex: index - 1,
      });
      toolGroupStart = -1;
    }

    if (reasoningGroupStart !== -1) {
      ranges.push({
        type: "reasoningGroup",
        startIndex: reasoningGroupStart,
        endIndex: index - 1,
      });
      reasoningGroupStart = -1;
    }

    ranges.push({ type: "single", index });
  }

  if (toolGroupStart !== -1) {
    ranges.push({
      type: "toolGroup",
      startIndex: toolGroupStart,
      endIndex: partTypes.length - 1,
    });
  }

  if (reasoningGroupStart !== -1) {
    ranges.push({
      type: "reasoningGroup",
      startIndex: reasoningGroupStart,
      endIndex: partTypes.length - 1,
    });
  }

  return ranges;
};

export const getStablePartSignature = (part: unknown) => {
  if (!isRecord(part) || typeof part.type !== "string") {
    return "::";
  }

  const type = part.type;
  const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : "";
  const parentId = typeof part.parentId === "string" ? part.parentId : "";

  return `${type}::${toolCallId}::${parentId}`;
};

export const getStablePartTypeFromSignature = (signature: string) =>
  signature.split("::")[0] || "";

export const getStablePartRenderKeyFromSignature = (
  signature: string,
  index: number,
) => {
  const [type = "", toolCallId = "", parentId = ""] = signature.split("::");

  if (type === "tool-call" && toolCallId) {
    return `tool:${toolCallId}`;
  }

  if (type === "reasoning" && parentId) {
    return `reasoning:${parentId}`;
  }

  return `${type || "part"}:${index}`;
};

export const getStableThreadMessageRenderKey = (
  messageId: unknown,
  index: number,
) =>
  typeof messageId === "string" && messageId.length > 0
    ? messageId
    : `message:${index}`;
