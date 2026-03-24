import type { SpreadsheetAssistantContext } from "@/lib/chat/context";

export type ExcelChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ExcelToolCall = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type ExcelToolResult = {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
};

export type ExcelToolRound = {
  toolCalls: ExcelToolCall[];
  toolResults: ExcelToolResult[];
};

export type ExcelChatStepRequest = {
  threadId: string;
  messages: ExcelChatHistoryMessage[];
  model?: string;
  provider?: "openai" | "anthropic";
  reasoningEnabled?: boolean;
  systemInstructions?: string;
  context?: SpreadsheetAssistantContext;
  toolRounds?: ExcelToolRound[];
};

export type ExcelChatStepResponse =
  | {
      ok: true;
      type: "assistant";
      message: string;
    }
  | {
      ok: true;
      type: "tool_calls";
      toolCalls: ExcelToolCall[];
    }
  | {
      ok: false;
      error: string;
    };

