export type ChatStreamEvent =
  | {
      type: "message.start";
      threadId: string;
      runId?: string;
    }
  | {
      type: "message.delta";
      delta: string;
    }
  | {
      type: "message.complete";
      threadId: string;
      message: string;
      runId?: string;
    }
  | {
      type: "reasoning.start";
    }
  | {
      type: "reasoning.delta";
      delta: string;
    }
  | {
      type: "tool.call";
      toolName: string;
      toolCallId?: string;
      args: unknown;
    }
  | {
      type: "tool.result";
      toolName: string;
      toolCallId?: string;
      args?: unknown;
      result: unknown;
      isError?: boolean;
    }
  | {
      type: "context.usage";
      runId: string;
      model: string;
      inputTokensPeak: number;
      contextWindowTokens: number;
      usedPercent: number;
      remainingPercent: number;
      warning: "normal" | "high";
    }
  | {
      type: "error";
      error: string;
    };

const safeJsonStringify = (value: unknown): string => {
  const visited = new WeakSet<object>();

  return JSON.stringify(value, (_key, currentValue) => {
    if (typeof currentValue === "bigint") {
      return currentValue.toString();
    }

    if (currentValue instanceof Error) {
      return {
        name: currentValue.name,
        message: currentValue.message,
        stack: currentValue.stack,
      };
    }

    if (currentValue && typeof currentValue === "object") {
      if (visited.has(currentValue)) {
        return "[Circular]";
      }
      visited.add(currentValue);
    }

    return currentValue;
  });
};

export const encodeChatStreamEvent = (event: ChatStreamEvent) => {
  return `data: ${safeJsonStringify(event)}\n\n`;
};

export async function* parseChatStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const payload = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n")
          .trim();

        if (!payload) {
          continue;
        }

        yield JSON.parse(payload) as ChatStreamEvent;
      }
    }

    const trailing = buffer.trim();
    if (!trailing) {
      return;
    }

    const payload = trailing
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n")
      .trim();

    if (payload) {
      yield JSON.parse(payload) as ChatStreamEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
