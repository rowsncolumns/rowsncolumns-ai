export type ChatStreamEvent =
  | {
      type: "message.start";
      threadId: string;
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
      result: unknown;
      isError?: boolean;
    }
  | {
      type: "error";
      error: string;
    };

export const encodeChatStreamEvent = (event: ChatStreamEvent) => {
  return `data: ${JSON.stringify(event)}\n\n`;
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
