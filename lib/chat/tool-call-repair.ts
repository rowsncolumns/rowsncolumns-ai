const getStoredMessageProperty = (
  value: unknown,
  key: string,
): unknown | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (key in record) {
    return record[key];
  }

  const kwargs =
    "kwargs" in record && record.kwargs && typeof record.kwargs === "object"
      ? (record.kwargs as Record<string, unknown>)
      : undefined;
  if (kwargs && key in kwargs) {
    return kwargs[key];
  }

  return undefined;
};

export const collectRespondedToolCallIds = (
  messages: unknown[],
  startIndex: number,
) => {
  const respondedToolCallIds = new Set<string>();

  for (let i = startIndex; i < messages.length; i += 1) {
    const toolCallIdValue = getStoredMessageProperty(
      messages[i],
      "tool_call_id",
    );
    if (typeof toolCallIdValue === "string" && toolCallIdValue.trim()) {
      respondedToolCallIds.add(toolCallIdValue);
    }
  }

  return respondedToolCallIds;
};
