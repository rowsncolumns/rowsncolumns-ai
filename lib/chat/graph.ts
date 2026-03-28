import { ChatAnthropic } from "@langchain/anthropic";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

import { normalizeAssistantErrorMessage } from "@/lib/chat/errors";
import type { ChatStreamEvent } from "@/lib/chat/protocol";
import {
  getAssistantSessionByThreadId,
  listAssistantSessions,
  upsertAssistantSession,
} from "@/lib/chat/sessions-repository";
import { spreadsheetTools } from "@/lib/chat/tools";

const DEFAULT_OPENAI_MODEL = "gpt-5.2-chat-latest";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MODEL_TEMPERATURE = 0.2;
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
const DEFAULT_ANTHROPIC_THINKING_BUDGET_TOKENS = 2048;
const LOW_EFFORT_ANTHROPIC_THINKING_BUDGET_TOKENS = 1024;
const DEFAULT_GRAPH_RECURSION_LIMIT = 150;
const DEFAULT_LANGGRAPH_CHECKPOINT_SCHEMA = "public";
const CLAUDE_MODEL_PATTERN = /^claude/i;
const REASONING_MODEL_PATTERN = /^(o\d|gpt-5|codex)/i;
const SESSION_TITLE_SYSTEM_PROMPT = `You generate concise session titles for spreadsheet assistant conversations.

Rules:
- Return only the title text, no quotes, markdown, prefixes, or explanations.
- Keep it under 7 words.
- Make it specific and useful.
- Use title case.
`;
const MAX_SESSION_TITLE_LENGTH = 80;

const isReasoningModel = (model: string) =>
  REASONING_MODEL_PATTERN.test(model.trim());
const isClaudeModel = (model: string) =>
  CLAUDE_MODEL_PATTERN.test(model.trim());
const isLowEffortModel = (model: string) => model.trim().endsWith("-low");
const normalizeModelName = (model: string) => model.trim().replace(/-low$/, "");

const getEnv = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

type Provider = "openai" | "anthropic";
type OpenAIReasoningSummary = "auto" | "concise" | "detailed" | null;
type OpenAIReasoningEffort = "low" | "medium" | "high";
type AnthropicThinkingMode = "enabled" | "adaptive" | "disabled";
type ChatAbortReason = {
  code?: unknown;
  message?: unknown;
  timeoutMs?: unknown;
};

const isAbortError = (error: unknown) => {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
};

const getAbortReasonCode = (reason: unknown) => {
  if (!reason || typeof reason !== "object") {
    return null;
  }

  const { code } = reason as ChatAbortReason;
  return typeof code === "string" ? code : null;
};

const getAbortReasonTimeoutMs = (reason: unknown) => {
  if (!reason || typeof reason !== "object") {
    return null;
  }

  const { timeoutMs } = reason as ChatAbortReason;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return null;
  }

  return timeoutMs;
};

const getServerTimeoutMessage = (timeoutMs: number | null) => {
  const seconds = timeoutMs ? Math.ceil(timeoutMs / 1000) : 300;
  return `I hit the ${seconds}s server time limit before finishing this response. Ask me to continue and I will resume from where I stopped.`;
};

const parseOpenAIReasoningSummary = (
  value: string | undefined,
): OpenAIReasoningSummary => {
  const normalized = value?.toLowerCase();

  if (normalized === "auto") return "auto";
  if (normalized === "concise") return "concise";
  if (normalized === "detailed") return "detailed";
  if (normalized === "null" || normalized === "none") return null;

  return "auto";
};

const parseOpenAIReasoningEffort = (
  value: string | undefined,
): OpenAIReasoningEffort | undefined => {
  const normalized = value?.toLowerCase();

  if (normalized === "low") return "low";
  if (normalized === "medium") return "medium";
  if (normalized === "high") return "high";

  return undefined;
};

const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseAnthropicThinkingMode = (
  value: string | undefined,
): AnthropicThinkingMode => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "disabled") return "disabled";
  if (normalized === "adaptive") return "adaptive";
  if (normalized === "enabled") return "enabled";

  // Default to enabled so reasoning blocks are available in UI.
  return "enabled";
};

const resolveProviderConfig = (override?: {
  model?: string;
  provider?: Provider;
}) => {
  const providerOverride =
    override?.provider ?? getEnv("AI_PROVIDER")?.toLowerCase();
  const modelOverride = override?.model?.trim();

  if (providerOverride === "anthropic") {
    return {
      provider: "anthropic" as const,
      model:
        modelOverride ||
        getEnv("ANTHROPIC_MODEL") ||
        getEnv("AI_MODEL") ||
        DEFAULT_ANTHROPIC_MODEL,
    };
  }

  if (providerOverride === "openai") {
    return {
      provider: "openai" as const,
      model:
        modelOverride ||
        getEnv("OPENAI_MODEL") ||
        getEnv("AI_MODEL") ||
        DEFAULT_OPENAI_MODEL,
    };
  }

  const model =
    modelOverride ||
    getEnv("AI_MODEL") ||
    getEnv("OPENAI_MODEL") ||
    getEnv("ANTHROPIC_MODEL") ||
    DEFAULT_OPENAI_MODEL;

  return {
    provider: isClaudeModel(model)
      ? ("anthropic" as const)
      : ("openai" as const),
    model,
  };
};

const buildSystemPrompt = (options?: {
  docId?: string;
  systemInstructions?: string;
}) => {
  const { docId, systemInstructions } = options ?? {};

  const docContext = docId
    ? `\n\nYou are working on document ID: ${docId}. When calling tools that modify the spreadsheet, always include this docId in the tool arguments.`
    : "";

  const additionalInstructions = systemInstructions
    ? `\n\n${systemInstructions}`
    : "";

  return `You are an expert spreadsheet assistant. Execute tasks efficiently with sensible defaults.

## Core Rules
- Indexes are 1-based: A1 = row 1, col 1
- Prefer formulas over hardcoded values for calculations
- Batch multiple rows per write operation
- For sequences (1,2,3... or Jan,Feb,Mar...), write first 1-2 values then use auto-fill
- Act first, ask only if destructive or ambiguous

## Formula Errors
Auto-fix errors immediately without asking:
- #CIRC!/#REF! from circular refs → enable iterative calculation
- #REF! from deleted cells → repair references
- #NAME? → fix function spelling
- #VALUE! → fix argument types
- #DIV/0! → add IFERROR or fix divisor
After fixing, verify by querying the affected range.

## Circular References
- Avoid creating them by default
- If intentionally needed (LBO models, goal-seek), enable iterative mode FIRST
- Common mistakes: cell refs itself, A1↔B1 mutual refs, indirect loops

## Formatting
- Professional, minimal: bold for headers/totals only
- Auto-format numbers/dates/currency appropriately
- Avoid merged cells, excessive styling
- Write data first, then format

## Execution
- For 3+ steps: show brief plan, then execute immediately
- Be concise in responses
- Summarize changes when done
${docContext}
${additionalInstructions}`;
};

const getModel = (override?: {
  model?: string;
  provider?: Provider;
  reasoningEnabled?: boolean;
}) => {
  const { provider, model } = resolveProviderConfig(override);

  if (provider === "anthropic") {
    const apiKey = getEnv("ANTHROPIC_API_KEY");

    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured.");
    }

    // Check if this is a low-effort model variant and normalize the model name
    const lowEffort = isLowEffortModel(model);
    const normalizedModel = normalizeModelName(model);

    const maxTokens = parsePositiveInt(
      getEnv("ANTHROPIC_MAX_TOKENS"),
      DEFAULT_ANTHROPIC_MAX_TOKENS,
    );
    const configuredThinkingMode = parseAnthropicThinkingMode(
      getEnv("ANTHROPIC_THINKING"),
    );
    const thinkingMode =
      override?.reasoningEnabled === false
        ? ("disabled" as const)
        : override?.reasoningEnabled === true
          ? ("enabled" as const)
          : configuredThinkingMode;
    const defaultBudget = lowEffort
      ? LOW_EFFORT_ANTHROPIC_THINKING_BUDGET_TOKENS
      : DEFAULT_ANTHROPIC_THINKING_BUDGET_TOKENS;
    const configuredThinkingBudget = parsePositiveInt(
      getEnv("ANTHROPIC_THINKING_BUDGET_TOKENS"),
      defaultBudget,
    );
    const thinkingBudget = Math.max(
      1024,
      Math.min(configuredThinkingBudget, maxTokens - 1),
    );
    const thinking =
      thinkingMode === "adaptive"
        ? ({ type: "adaptive" } as const)
        : thinkingMode === "enabled"
          ? ({
              type: "enabled",
              budget_tokens: thinkingBudget,
            } as const)
          : ({ type: "disabled" } as const);
    const anthropicTemperature =
      thinking.type === "enabled" || thinking.type === "adaptive"
        ? undefined
        : DEFAULT_MODEL_TEMPERATURE;

    return new ChatAnthropic({
      apiKey,
      model: normalizedModel,
      maxTokens,
      thinking,
      ...(anthropicTemperature !== undefined
        ? { temperature: anthropicTemperature }
        : {}),
    });
  }

  const apiKey = getEnv("OPENAI_API_KEY");

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const reasoningSummary = parseOpenAIReasoningSummary(
    getEnv("OPENAI_REASONING_SUMMARY"),
  );
  const reasoningEffort = parseOpenAIReasoningEffort(
    getEnv("OPENAI_REASONING_EFFORT"),
  );
  const enableReasoningSummary =
    (override?.reasoningEnabled ?? true) && isReasoningModel(model);

  const openAITemperature = isReasoningModel(model)
    ? undefined
    : DEFAULT_MODEL_TEMPERATURE;

  return new ChatOpenAI({
    apiKey,
    model,
    ...(openAITemperature !== undefined
      ? { temperature: openAITemperature }
      : {}),
    ...(enableReasoningSummary
      ? {
          reasoning: {
            summary: reasoningSummary,
            ...(reasoningEffort ? { effort: reasoningEffort } : {}),
          },
        }
      : {}),
  });
};

const shouldContinue = (state: typeof MessagesAnnotation.State) => {
  const lastMessage = state.messages[state.messages.length - 1];

  // If the last message has tool calls, route to tools node
  if (
    lastMessage &&
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0
  ) {
    return "tools";
  }

  // Otherwise, end the graph
  return END;
};

/**
 * Filter out content types that OpenAI doesn't support (like 'reasoning' from Claude).
 * OpenAI only supports: 'text', 'image_url', 'input_audio', 'refusal', 'audio', 'file'
 */
const sanitizeMessagesForOpenAI = (
  messages: (typeof MessagesAnnotation.State)["messages"],
) => {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message;
    }

    const filteredContent = message.content.filter((part) => {
      if (typeof part === "string") return true;
      if (!part || typeof part !== "object") return false;
      const partType = (part as { type?: string }).type;
      // Filter out 'reasoning' and 'thinking' content types
      return partType !== "reasoning" && partType !== "thinking";
    });

    // If no content left after filtering, keep at least an empty text
    if (filteredContent.length === 0) {
      return {
        ...message,
        content: [{ type: "text", text: "" }],
      };
    }

    return {
      ...message,
      content: filteredContent,
    };
  });
};

const buildCheckpointThreadId = (threadId: string) => threadId;

let checkpointerPromise: Promise<MemorySaver | PostgresSaver> | null = null;

const getCheckpointer = async () => {
  if (!checkpointerPromise) {
    checkpointerPromise = (async () => {
      const databaseUrl = getEnv("DATABASE_URL");
      if (!databaseUrl) {
        console.warn(
          "[graph] DATABASE_URL is missing. Falling back to in-memory checkpoints.",
        );
        return new MemorySaver();
      }

      const schema =
        getEnv("LANGGRAPH_CHECKPOINT_SCHEMA") ??
        DEFAULT_LANGGRAPH_CHECKPOINT_SCHEMA;

      try {
        const checkpointer = PostgresSaver.fromConnString(databaseUrl, {
          schema,
        });
        await checkpointer.setup();
        return checkpointer;
      } catch (error) {
        console.error(
          "[graph] Failed to initialize Postgres checkpointer. Falling back to in-memory checkpoints.",
          error,
        );
        return new MemorySaver();
      }
    })();
  }

  return checkpointerPromise;
};

const createGraph = async () => {
  const checkpointer = await getCheckpointer();
  const toolNode = new ToolNode(spreadsheetTools);

  return new StateGraph(MessagesAnnotation)
    .addNode(
      "call-model",
      async (
        state,
        runtimeConfig?: {
          configurable?: {
            model?: string;
            provider?: string;
            reasoningEnabled?: boolean;
            docId?: string;
            systemInstructions?: string;
          };
        },
      ) => {
        const providerCandidate = runtimeConfig?.configurable?.provider;
        const providerOverride: Provider | undefined =
          providerCandidate === "openai" || providerCandidate === "anthropic"
            ? providerCandidate
            : undefined;
        const modelOverride = runtimeConfig?.configurable?.model;
        const reasoningEnabled = runtimeConfig?.configurable?.reasoningEnabled;
        const docId = runtimeConfig?.configurable?.docId;
        const systemInstructions =
          runtimeConfig?.configurable?.systemInstructions;
        const model = getModel({
          model: modelOverride,
          provider: providerOverride,
          reasoningEnabled,
        }).bindTools(spreadsheetTools, { parallel_tool_calls: true });

        // Sanitize messages for OpenAI (remove unsupported content types like 'reasoning')
        const { provider } = resolveProviderConfig({
          model: modelOverride,
          provider: providerOverride,
        });
        const messagesToSend =
          provider === "openai"
            ? sanitizeMessagesForOpenAI(state.messages)
            : state.messages;

        const response = await model.invoke([
          new SystemMessage(buildSystemPrompt({ docId, systemInstructions })),
          ...messagesToSend,
        ]);

        return {
          messages: [response],
        };
      },
    )
    .addNode("tools", toolNode)
    .addEdge(START, "call-model")
    .addConditionalEdges("call-model", shouldContinue, {
      tools: "tools",
      [END]: END,
    })
    .addEdge("tools", "call-model")
    .compile({
      checkpointer,
    });
};

type ChatGraph = Awaited<ReturnType<typeof createGraph>>;

let graphPromise: Promise<ChatGraph> | null = null;

const getGraph = async () => {
  if (process.env.NODE_ENV !== "production") {
    return createGraph();
  }

  if (!graphPromise) {
    graphPromise = createGraph().catch((error) => {
      graphPromise = null;
      throw error;
    });
  }

  return graphPromise;
};

const getThreadConfig = (
  threadId: string,
  runName?: string,
  override?: {
    model?: string;
    provider?: Provider;
    reasoningEnabled?: boolean;
    docId?: string;
    systemInstructions?: string;
    userId?: string;
    sessionTitle?: string;
  },
) => ({
  configurable: {
    thread_id: buildCheckpointThreadId(threadId),
    ...(override?.model ? { model: override.model } : {}),
    ...(override?.provider ? { provider: override.provider } : {}),
    ...(typeof override?.reasoningEnabled === "boolean"
      ? { reasoningEnabled: override.reasoningEnabled }
      : {}),
    ...(override?.docId ? { docId: override.docId } : {}),
    ...(override?.systemInstructions
      ? { systemInstructions: override.systemInstructions }
      : {}),
  },
  // LangSmith tracing config
  runName: runName ?? "spreadsheet-assistant",
  tags: ["rnc-ai", "spreadsheet"],
  metadata: {
    threadId,
    ...(override?.userId ? { userId: override.userId } : {}),
    ...(override?.model ? { model: override.model } : {}),
    ...(override?.provider ? { provider: override.provider } : {}),
    ...(typeof override?.reasoningEnabled === "boolean"
      ? { reasoningEnabled: override.reasoningEnabled }
      : {}),
    ...(override?.docId ? { docId: override.docId } : {}),
    ...(override?.sessionTitle ? { sessionTitle: override.sessionTitle } : {}),
  },
});

const contentToText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (!part || typeof part !== "object") {
        return "";
      }

      const text =
        "text" in part && typeof part.text === "string" ? part.text : "";
      if (text) {
        return text;
      }

      if ("type" in part && part.type === "text" && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const contentToReasoning = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      if ("type" in part && part.type === "reasoning") {
        if ("reasoning" in part && typeof part.reasoning === "string") {
          return part.reasoning;
        }

        if ("text" in part && typeof part.text === "string") {
          return part.text;
        }
      }

      if ("type" in part && part.type === "thinking") {
        if ("thinking" in part && typeof part.thinking === "string") {
          return part.thinking;
        }

        if ("text" in part && typeof part.text === "string") {
          return part.text;
        }
      }

      return "";
    })
    .filter(Boolean)
    .join("");
};

const additionalKwargsToReasoning = (additionalKwargs: unknown): string => {
  if (!additionalKwargs || typeof additionalKwargs !== "object") {
    return "";
  }

  const candidate = additionalKwargs as {
    reasoning_content?: unknown;
    reasoning?: unknown;
  };

  if (typeof candidate.reasoning_content === "string") {
    return candidate.reasoning_content;
  }

  if (!candidate.reasoning || typeof candidate.reasoning !== "object") {
    return "";
  }

  const reasoning = candidate.reasoning as {
    summary?: unknown;
    text?: unknown;
    reasoning?: unknown;
  };

  if (Array.isArray(reasoning.summary)) {
    const summaryText = reasoning.summary
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }

        return "text" in item && typeof item.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join("");

    if (summaryText) {
      return summaryText;
    }
  }

  if (typeof reasoning.reasoning === "string") {
    return reasoning.reasoning;
  }

  if (typeof reasoning.text === "string") {
    return reasoning.text;
  }

  return "";
};

const stringifyUnknown = (value: unknown) => {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const normalizeSessionTitle = (value: string): string | null => {
  const collapsed = value
    .replace(/^title:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) {
    return null;
  }

  if (collapsed.length <= MAX_SESSION_TITLE_LENGTH) {
    return collapsed;
  }

  return `${collapsed.slice(0, MAX_SESSION_TITLE_LENGTH - 1).trimEnd()}…`;
};

const deriveFallbackSessionTitleFromMessage = (message: string) => {
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return "Untitled Session";
  }

  const normalizedLine = firstLine
    .replace(/[*_`#>[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedLine) {
    return "Untitled Session";
  }

  const words = normalizedLine.split(" ").slice(0, 7).join(" ");
  return normalizeSessionTitle(words) ?? "Untitled Session";
};

const getToolMessageContent = (value: unknown): string | null => {
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? value : null;
  }

  const maybeToolMessage = value as {
    content?: unknown;
    kwargs?: { content?: unknown };
  };

  if (typeof maybeToolMessage.content === "string") {
    return maybeToolMessage.content;
  }

  if (typeof maybeToolMessage.kwargs?.content === "string") {
    return maybeToolMessage.kwargs.content;
  }

  return null;
};

const tryParseJsonString = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

type StreamedToolResult = {
  toolName: string;
  toolCallId?: string;
  args?: unknown;
  result: unknown;
  isError: boolean;
};

const extractStreamedToolMessage = (
  value: unknown,
): StreamedToolResult | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeMessage = value as {
    id?: unknown;
    kwargs?: unknown;
    name?: unknown;
    tool_call_id?: unknown;
    input?: unknown;
    artifact?: unknown;
    status?: unknown;
    content?: unknown;
  };
  const kwargs =
    maybeMessage.kwargs && typeof maybeMessage.kwargs === "object"
      ? (maybeMessage.kwargs as {
          name?: unknown;
          tool_call_id?: unknown;
          input?: unknown;
          artifact?: unknown;
          status?: unknown;
          content?: unknown;
        })
      : undefined;

  const idParts = Array.isArray(maybeMessage.id)
    ? maybeMessage.id.map((part) => String(part))
    : [];
  const isToolMessageType = idParts.some((part) =>
    part.includes("ToolMessage"),
  );

  const toolName =
    typeof kwargs?.name === "string"
      ? kwargs.name
      : typeof maybeMessage.name === "string"
        ? maybeMessage.name
        : undefined;
  const toolCallId =
    typeof kwargs?.tool_call_id === "string"
      ? kwargs.tool_call_id
      : typeof maybeMessage.tool_call_id === "string"
        ? maybeMessage.tool_call_id
        : undefined;
  const status =
    typeof kwargs?.status === "string"
      ? kwargs.status
      : typeof maybeMessage.status === "string"
        ? maybeMessage.status
        : undefined;
  const content = kwargs?.content ?? maybeMessage.content;
  const directInput = kwargs?.input ?? maybeMessage.input;
  const artifact =
    kwargs?.artifact && typeof kwargs.artifact === "object"
      ? (kwargs.artifact as Record<string, unknown>)
      : maybeMessage.artifact && typeof maybeMessage.artifact === "object"
        ? (maybeMessage.artifact as Record<string, unknown>)
        : undefined;
  const artifactInput = artifact?.input;
  const args = directInput ?? artifactInput;

  if (!isToolMessageType && !toolName && !toolCallId) {
    return null;
  }

  if (status !== "error") {
    return null;
  }

  const isError = true;
  const parsedContent =
    typeof content === "string" ? tryParseJsonString(content) : content;
  const result = {
    success: false,
    error:
      typeof content === "string"
        ? content
        : stringifyUnknown(parsedContent ?? "Unknown tool error"),
  };

  return {
    toolName: toolName ?? "tool",
    ...(toolCallId ? { toolCallId } : {}),
    ...(args !== undefined ? { args } : {}),
    result,
    isError,
  };
};

const collectStreamedToolResults = (value: unknown): StreamedToolResult[] => {
  const queue: unknown[] = [value];
  const results: StreamedToolResult[] = [];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const maybeToolResult = extractStreamedToolMessage(current);
    if (maybeToolResult) {
      results.push(maybeToolResult);
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of ["messages", "message", "chunk", "output", "data"]) {
      if (key in record) {
        queue.push(record[key]);
      }
    }
  }

  return results;
};

type StreamedToolCall = {
  toolName: string;
  toolCallId?: string;
  args: unknown;
};

const extractStreamedToolCalls = (value: unknown): StreamedToolCall[] => {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const additionalKwargs =
    "additional_kwargs" in record &&
    record.additional_kwargs &&
    typeof record.additional_kwargs === "object"
      ? (record.additional_kwargs as Record<string, unknown>)
      : undefined;
  const direct = Array.isArray(record.tool_calls)
    ? record.tool_calls
    : undefined;
  const nested =
    additionalKwargs && Array.isArray(additionalKwargs.tool_calls)
      ? additionalKwargs.tool_calls
      : undefined;
  const toolCalls = direct ?? nested ?? [];

  return toolCalls
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const toolCall = item as {
        id?: unknown;
        name?: unknown;
        args?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      const toolName =
        typeof toolCall.name === "string"
          ? toolCall.name
          : typeof toolCall.function?.name === "string"
            ? toolCall.function.name
            : null;
      if (!toolName) {
        return null;
      }

      const argsSource =
        toolCall.args !== undefined ? toolCall.args : toolCall.function;
      const args = parseToolCallArgs(argsSource);
      const toolCallId =
        typeof toolCall.id === "string" ? toolCall.id : undefined;

      return {
        toolName,
        ...(toolCallId ? { toolCallId } : {}),
        args,
      };
    })
    .filter((toolCall): toolCall is StreamedToolCall => toolCall !== null);
};

const collectStreamedToolCalls = (value: unknown): StreamedToolCall[] => {
  const queue: unknown[] = [value];
  const results: StreamedToolCall[] = [];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const toolCalls = extractStreamedToolCalls(current);
    if (toolCalls.length > 0) {
      results.push(...toolCalls);
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of [
      "messages",
      "message",
      "chunk",
      "output",
      "outputs",
      "data",
      "kwargs",
      "additional_kwargs",
      "generations",
    ]) {
      if (key in record) {
        queue.push(record[key]);
      }
    }
  }

  return results;
};

const getToolResultDedupKey = (value: StreamedToolResult) => {
  if (value.toolCallId) {
    return `tool:${value.toolCallId}`;
  }

  return `tool:${value.toolName}:${value.isError ? "error" : "ok"}:${stringifyUnknown(
    value.result,
  )}`;
};

const normalizeToolResult = (
  toolOutput: unknown,
): { result: unknown; isError: boolean } => {
  if (!toolOutput || typeof toolOutput !== "object") {
    return { result: toolOutput, isError: false };
  }

  // ToolNode standard behavior wraps recoverable tool failures (including
  // schema/argument failures) as ToolMessage(status="error").
  const maybeToolMessage = toolOutput as {
    status?: unknown;
    kwargs?: { status?: unknown };
  };
  const status = maybeToolMessage.status ?? maybeToolMessage.kwargs?.status;
  if (status === "error") {
    return {
      result: {
        success: false,
        error:
          getToolMessageContent(toolOutput) ?? stringifyUnknown(toolOutput),
      },
      isError: true,
    };
  }

  return { result: toolOutput, isError: false };
};

const isGraphRecursionLimitError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Recursion limit") ||
    message.includes("GRAPH_RECURSION_LIMIT")
  );
};

type PersistedThreadTextPart = {
  type: "text";
  text: string;
};

type PersistedThreadReasoningPart = {
  type: "reasoning";
  text: string;
};

type PersistedThreadToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
};

type PersistedThreadContentPart =
  | PersistedThreadTextPart
  | PersistedThreadReasoningPart
  | PersistedThreadToolCallPart;

export type PersistedThreadMessage = {
  role: "user" | "assistant" | "system";
  content: string | PersistedThreadContentPart[];
};

const getStoredMessageType = (value: unknown): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeMessage = value as {
    _getType?: () => unknown;
    type?: unknown;
    id?: unknown;
    kwargs?: { type?: unknown };
  };

  if (typeof maybeMessage._getType === "function") {
    const result = maybeMessage._getType();
    if (typeof result === "string") {
      return result;
    }
  }

  if (typeof maybeMessage.type === "string") {
    return maybeMessage.type;
  }

  if (typeof maybeMessage.kwargs?.type === "string") {
    return maybeMessage.kwargs.type;
  }

  // Fallback for serialized LangChain message objects persisted as
  // `{ type: "constructor", id: ["langchain_core","messages","AIMessage"], ... }`.
  if (maybeMessage.type === "constructor" && Array.isArray(maybeMessage.id)) {
    const constructorName = maybeMessage.id.findLast(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );

    if (constructorName) {
      if (
        constructorName === "HumanMessage" ||
        constructorName === "HumanMessageChunk"
      ) {
        return "human";
      }

      if (
        constructorName === "AIMessage" ||
        constructorName === "AIMessageChunk"
      ) {
        return "ai";
      }

      if (
        constructorName === "SystemMessage" ||
        constructorName === "SystemMessageChunk"
      ) {
        return "system";
      }

      if (
        constructorName === "ToolMessage" ||
        constructorName === "ToolMessageChunk"
      ) {
        return "tool";
      }
    }
  }

  return null;
};

const toPersistedRole = (
  messageType: string | null,
): PersistedThreadMessage["role"] | null => {
  if (!messageType) return null;
  if (messageType === "human" || messageType === "user") return "user";
  if (messageType === "ai" || messageType === "assistant") return "assistant";
  if (messageType === "system") return "system";
  return null;
};

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

const parseToolCallArgs = (value: unknown): unknown => {
  if (typeof value === "string") {
    return tryParseJsonString(value);
  }

  if (
    value &&
    typeof value === "object" &&
    "arguments" in (value as Record<string, unknown>)
  ) {
    const argumentsValue = (value as { arguments?: unknown }).arguments;
    if (typeof argumentsValue === "string") {
      return tryParseJsonString(argumentsValue);
    }
  }

  return value;
};

type ParsedStoredToolCall = {
  id?: string;
  name: string;
  args: unknown;
};

const getStoredToolCalls = (value: unknown): ParsedStoredToolCall[] => {
  const direct = getStoredMessageProperty(value, "tool_calls");
  const additionalKwargs = getStoredMessageProperty(value, "additional_kwargs");
  const nested =
    additionalKwargs &&
    typeof additionalKwargs === "object" &&
    "tool_calls" in (additionalKwargs as Record<string, unknown>)
      ? (additionalKwargs as { tool_calls?: unknown }).tool_calls
      : undefined;
  const candidate = Array.isArray(direct)
    ? direct
    : Array.isArray(nested)
      ? nested
      : [];

  return candidate
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const toolCall = item as {
        id?: unknown;
        name?: unknown;
        args?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      const name =
        typeof toolCall.name === "string"
          ? toolCall.name
          : typeof toolCall.function?.name === "string"
            ? toolCall.function.name
            : null;
      if (!name) {
        return null;
      }

      const argsSource =
        toolCall.args !== undefined ? toolCall.args : toolCall.function;
      const args = parseToolCallArgs(argsSource);
      const id = typeof toolCall.id === "string" ? toolCall.id : undefined;

      return {
        ...(id ? { id } : {}),
        name,
        args,
      };
    })
    .filter((toolCall): toolCall is ParsedStoredToolCall => toolCall !== null);
};

type ParsedStoredToolResult = {
  toolCallId?: string;
  toolName?: string;
  result: unknown;
  isError: boolean;
};

const getStoredToolResult = (value: unknown): ParsedStoredToolResult | null => {
  const messageType = getStoredMessageType(value);
  if (messageType !== "tool") {
    return null;
  }

  const toolCallIdValue = getStoredMessageProperty(value, "tool_call_id");
  const toolNameValue = getStoredMessageProperty(value, "name");
  const statusValue = getStoredMessageProperty(value, "status");
  const contentValue = getStoredMessageProperty(value, "content");
  const artifactValue = getStoredMessageProperty(value, "artifact");
  const resultSource = contentValue ?? artifactValue;
  const result =
    typeof resultSource === "string"
      ? tryParseJsonString(resultSource)
      : (resultSource ?? "");

  return {
    ...(typeof toolCallIdValue === "string"
      ? { toolCallId: toolCallIdValue }
      : {}),
    ...(typeof toolNameValue === "string" ? { toolName: toolNameValue } : {}),
    result,
    isError: statusValue === "error",
  };
};

type ToolCallLocation = {
  messageIndex: number;
  partIndex: number;
};

const getToolCallPartAt = (
  messages: PersistedThreadMessage[],
  location: ToolCallLocation,
): PersistedThreadToolCallPart | null => {
  const message = messages[location.messageIndex];
  if (!message || !Array.isArray(message.content)) {
    return null;
  }

  const part = message.content[location.partIndex];
  if (!part || part.type !== "tool-call") {
    return null;
  }

  return part;
};

const getPendingToolCallLocationByName = (
  indexByName: Map<string, ToolCallLocation[]>,
  messages: PersistedThreadMessage[],
  toolName: string,
): ToolCallLocation | null => {
  const queue = indexByName.get(toolName);
  if (!queue || queue.length === 0) {
    return null;
  }

  while (queue.length > 0) {
    const location = queue.shift();
    if (!location) {
      continue;
    }
    const part = getToolCallPartAt(messages, location);
    if (part && part.result === undefined) {
      return location;
    }
  }

  return null;
};

const buildPersistedThreadMessages = (
  values: unknown[],
): PersistedThreadMessage[] => {
  const persistedMessages: PersistedThreadMessage[] = [];
  const toolCallLocationById = new Map<string, ToolCallLocation>();
  const pendingToolCallLocationsByName = new Map<string, ToolCallLocation[]>();

  for (const rawMessage of values) {
    const messageType = getStoredMessageType(rawMessage);

    if (messageType === "tool") {
      const toolResult = getStoredToolResult(rawMessage);
      if (toolResult) {
        const byId =
          toolResult.toolCallId &&
          toolCallLocationById.has(toolResult.toolCallId)
            ? (toolCallLocationById.get(toolResult.toolCallId) ?? null)
            : null;
        const byName =
          !byId && toolResult.toolName
            ? getPendingToolCallLocationByName(
                pendingToolCallLocationsByName,
                persistedMessages,
                toolResult.toolName,
              )
            : null;
        const location = byId ?? byName;

        if (location) {
          const part = getToolCallPartAt(persistedMessages, location);
          if (part) {
            part.result = toolResult.result;
            part.isError = toolResult.isError;
          }
        } else if (persistedMessages.length > 0) {
          const fallbackAssistantIndex = [...persistedMessages]
            .map((message, index) => ({ message, index }))
            .reverse()
            .find((entry) => entry.message.role === "assistant")?.index;
          if (fallbackAssistantIndex !== undefined) {
            const fallbackMessage = persistedMessages[fallbackAssistantIndex];
            const fallbackContent = Array.isArray(fallbackMessage.content)
              ? fallbackMessage.content
              : [
                  {
                    type: "text" as const,
                    text: String(fallbackMessage.content),
                  },
                ];
            fallbackContent.push({
              type: "tool-call",
              toolCallId:
                toolResult.toolCallId ??
                `tool:${toolResult.toolName ?? "tool"}:${fallbackAssistantIndex}:${fallbackContent.length}`,
              toolName: toolResult.toolName ?? "tool",
              args: {},
              result: toolResult.result,
              isError: toolResult.isError,
            });
            fallbackMessage.content = fallbackContent;
          }
        }

        if (toolResult.toolCallId) {
          toolCallLocationById.delete(toolResult.toolCallId);
        }
      }

      continue;
    }

    const role = toPersistedRole(messageType);
    if (!role) {
      continue;
    }

    if (role === "assistant") {
      const storedContent = getStoredMessageProperty(rawMessage, "content");
      const text = contentToText(storedContent);
      const contentReasoning = contentToReasoning(storedContent).trim();
      const kwargsReasoning = additionalKwargsToReasoning(
        getStoredMessageProperty(rawMessage, "additional_kwargs"),
      ).trim();
      const reasoning = [contentReasoning, kwargsReasoning]
        .filter((value, index, all) => value && all.indexOf(value) === index)
        .join("\n\n")
        .trim();
      const toolCalls = getStoredToolCalls(rawMessage);
      const parts: PersistedThreadContentPart[] = [];

      if (reasoning) {
        parts.push({
          type: "reasoning",
          text: reasoning,
        });
      }

      if (text.trim()) {
        parts.push({
          type: "text",
          text,
        });
      }

      const messageIndex = persistedMessages.length;
      for (const toolCall of toolCalls) {
        const toolCallId =
          toolCall.id ??
          `tool:${toolCall.name}:${messageIndex}:${parts.length}`;
        parts.push({
          type: "tool-call",
          toolCallId,
          toolName: toolCall.name,
          args: toolCall.args,
        });

        const location: ToolCallLocation = {
          messageIndex,
          partIndex: parts.length - 1,
        };
        if (toolCall.id) {
          toolCallLocationById.set(toolCall.id, location);
        }

        const pendingByName = pendingToolCallLocationsByName.get(toolCall.name);
        if (pendingByName) {
          pendingByName.push(location);
        } else {
          pendingToolCallLocationsByName.set(toolCall.name, [location]);
        }
      }

      if (parts.length === 0) {
        continue;
      }

      persistedMessages.push({
        role: "assistant",
        content: parts,
      });
      continue;
    }

    const text = contentToText(getStoredMessageProperty(rawMessage, "content"));
    if (!text.trim()) {
      continue;
    }

    persistedMessages.push({
      role,
      content: text,
    });
  }

  return persistedMessages;
};

export async function getSpreadsheetAssistantThreadMessages(input: {
  threadId: string;
  userId?: string;
}): Promise<PersistedThreadMessage[]> {
  const state = await (
    await getGraph()
  ).getState(
    getThreadConfig(input.threadId, "get-thread-state", {
      userId: input.userId,
    }),
  );
  const values = state.values;
  if (!values || typeof values !== "object") {
    return [];
  }

  const messages = (values as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return [];
  }

  return buildPersistedThreadMessages(messages);
}

/**
 * Fork a conversation at a specific message index, creating a new thread
 * with the conversation history up to and including that message.
 */
export async function forkThreadAtMessage(input: {
  sourceThreadId: string;
  userId: string;
  atMessageIndex: number;
  docId?: string;
}): Promise<{ newThreadId: string; title: string }> {
  const graph = await getGraph();

  // Get the raw messages from the source thread
  const sourceConfig = getThreadConfig(
    input.sourceThreadId,
    "fork-source-read",
    { userId: input.userId },
  );
  const state = await graph.getState(sourceConfig);
  const values = state.values;

  if (!values || typeof values !== "object") {
    throw new Error("Source thread has no state");
  }

  const rawMessages = (values as { messages?: unknown }).messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new Error("Source thread has no messages");
  }

  // Build persisted messages to find the correct slice point
  // (persisted messages exclude tool-only messages, so indices differ)
  const persistedMessages = buildPersistedThreadMessages(rawMessages);

  if (
    input.atMessageIndex < 0 ||
    input.atMessageIndex >= persistedMessages.length
  ) {
    throw new Error(
      `Invalid message index: ${input.atMessageIndex}. Thread has ${persistedMessages.length} messages.`,
    );
  }

  // Find how many raw messages correspond to the first N persisted messages
  // We need to include all messages up to and including the target message,
  // plus any tool messages that follow it (to keep tool calls complete)
  let persistedCount = 0;
  let rawSliceEnd = 0;

  for (let i = 0; i < rawMessages.length; i++) {
    const messageType = getStoredMessageType(rawMessages[i]);
    if (messageType !== "tool") {
      if (persistedCount > input.atMessageIndex) {
        // We've passed our target, stop here
        break;
      }
      persistedCount++;
    }
    rawSliceEnd = i + 1;

    // If we just processed our target message, include any following tool messages
    if (persistedCount === input.atMessageIndex + 1 && messageType !== "tool") {
      // Look ahead for tool messages
      while (
        rawSliceEnd < rawMessages.length &&
        getStoredMessageType(rawMessages[rawSliceEnd]) === "tool"
      ) {
        rawSliceEnd++;
      }
      break;
    }
  }

  const slicedMessages = rawMessages.slice(0, rawSliceEnd);
  if (slicedMessages.length === 0) {
    throw new Error("No messages to fork");
  }

  // Generate new thread ID
  const newThreadId = crypto.randomUUID();

  // Get source session info for title and model
  let sourceTitle: string | undefined;
  let sourceModel: string | undefined;
  try {
    const sourceSession = await getAssistantSessionByThreadId({
      threadId: input.sourceThreadId,
      userId: input.userId,
    });
    sourceTitle = sourceSession?.title;
    sourceModel = sourceSession?.model;
  } catch {
    // Ignore - we'll generate a new title
  }

  const newTitle = sourceTitle
    ? `Fork of ${sourceTitle}`
    : "Forked conversation";

  // Create session record for new thread (preserve model from source)
  await upsertAssistantSession({
    threadId: newThreadId,
    userId: input.userId,
    docId: input.docId,
    title: newTitle,
    model: sourceModel,
  });

  // Write sliced messages to new thread checkpoint
  const newConfig = getThreadConfig(newThreadId, "fork-destination-write", {
    userId: input.userId,
  });

  await graph.updateState(
    newConfig,
    { messages: slicedMessages },
    "call-model",
  );

  console.log("[graph] Forked thread:", {
    sourceThreadId: input.sourceThreadId,
    newThreadId,
    atMessageIndex: input.atMessageIndex,
    rawMessagesSliced: slicedMessages.length,
    totalRawMessages: rawMessages.length,
  });

  return { newThreadId, title: newTitle };
}

const getLatestSessionTitleForThread = async (input: {
  threadId: string;
  userId?: string;
}) => {
  const userId = input.userId?.trim();
  if (!userId) {
    return null;
  }

  let session: Awaited<ReturnType<typeof getAssistantSessionByThreadId>> = null;
  try {
    session = await getAssistantSessionByThreadId({
      threadId: input.threadId,
      userId,
    });
  } catch (error) {
    console.error("[graph] Failed to resolve indexed session title", {
      threadId: input.threadId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!session?.title) {
    return null;
  }

  return normalizeSessionTitle(session.title);
};

export async function resolveSpreadsheetAssistantSessionTitle(input: {
  threadId: string;
  userId?: string;
  message: string;
  model?: string;
  provider?: Provider;
  reasoningEnabled?: boolean;
}): Promise<string> {
  const existingTitle = await getLatestSessionTitleForThread({
    threadId: input.threadId,
    userId: input.userId,
  });
  if (existingTitle) {
    return existingTitle;
  }

  try {
    const titleModel = getModel({
      model: input.model,
      provider: input.provider,
      reasoningEnabled: false,
    });
    const titleResponse = await titleModel.invoke([
      new SystemMessage(SESSION_TITLE_SYSTEM_PROMPT),
      new HumanMessage(input.message),
    ]);
    const rawTitle =
      contentToText(titleResponse.content).split(/\r?\n/)[0] ?? "";
    const normalizedTitle = normalizeSessionTitle(rawTitle);
    if (normalizedTitle) {
      return normalizedTitle;
    }
  } catch (error) {
    console.error("[graph] Failed to generate session title", {
      threadId: input.threadId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return deriveFallbackSessionTitleFromMessage(input.message);
}

export type SpreadsheetAssistantSessionSummary = {
  threadId: string;
  updatedAt: string;
  docId?: string;
  title?: string;
};

export async function getSpreadsheetAssistantRecentSessions(input: {
  userId: string;
  limit?: number;
  docId?: string;
}): Promise<SpreadsheetAssistantSessionSummary[]> {
  const normalizedLimit = Math.max(
    1,
    Math.min(
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.floor(input.limit)
        : 10,
      50,
    ),
  );
  const normalizedUserId = input.userId.trim();
  if (!normalizedUserId) {
    return [];
  }

  try {
    const sessions = await listAssistantSessions({
      userId: normalizedUserId,
      limit: normalizedLimit,
      docId: input.docId,
    });
    if (sessions.length > 0) {
      return sessions.map((session) => ({
        threadId: session.threadId,
        updatedAt: session.updatedAt,
        ...(session.docId ? { docId: session.docId } : {}),
        ...(session.title ? { title: session.title } : {}),
      }));
    }
  } catch (error) {
    console.error("[graph] Failed to list indexed assistant sessions", {
      userId: normalizedUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Legacy bootstrap: older checkpoints may use scoped thread IDs of the form
  // "user:<userId>:thread:<threadId>" without corresponding session index rows.
  const scopedPrefix = `user:${normalizedUserId}:thread:`;
  const scanLimit = Math.max(normalizedLimit * 30, 300);
  const checkpointer = await getCheckpointer();
  const listConfig = { configurable: {} } as Parameters<
    typeof checkpointer.list
  >[0];
  const fallbackSessions: SpreadsheetAssistantSessionSummary[] = [];
  const seenThreadIds = new Set<string>();

  for await (const checkpointTuple of checkpointer.list(listConfig, {
    limit: scanLimit,
  })) {
    const configurable = checkpointTuple.config?.configurable;
    const checkpointThreadId =
      configurable &&
      typeof configurable === "object" &&
      "thread_id" in configurable &&
      typeof (configurable as { thread_id?: unknown }).thread_id === "string"
        ? (configurable as { thread_id: string }).thread_id
        : null;
    if (!checkpointThreadId || !checkpointThreadId.startsWith(scopedPrefix)) {
      continue;
    }

    const threadId = checkpointThreadId.slice(scopedPrefix.length).trim();
    if (!threadId || seenThreadIds.has(threadId)) {
      continue;
    }

    fallbackSessions.push({
      threadId,
      updatedAt:
        typeof checkpointTuple.checkpoint?.ts === "string"
          ? checkpointTuple.checkpoint.ts
          : "",
    });
    seenThreadIds.add(threadId);

    if (fallbackSessions.length >= normalizedLimit) {
      break;
    }
  }

  if (fallbackSessions.length > 0) {
    await Promise.all(
      fallbackSessions.map((session) =>
        upsertAssistantSession({
          threadId: session.threadId,
          userId: normalizedUserId,
        }).catch(() => undefined),
      ),
    );
  }

  return fallbackSessions;
}

const persistAssistantMessageToCheckpoint = async (input: {
  threadId: string;
  message: string;
  userId?: string;
}) => {
  const message = input.message.trim();
  if (!message) {
    return;
  }

  try {
    await (
      await getGraph()
    ).updateState(
      getThreadConfig(input.threadId, "persist-assistant-message", {
        userId: input.userId,
      }),
      {
        messages: [new AIMessage(message)],
      },
      "call-model",
    );
  } catch (error) {
    console.error("[graph] Failed to persist assistant message", error);
  }
};

export const persistAssistantFailureToCheckpoint = async (input: {
  threadId: string;
  userId?: string;
  userMessage?: string;
  errorMessage: string;
}) => {
  const errorMessage = input.errorMessage.trim();
  if (!errorMessage) {
    return;
  }

  const messages: (HumanMessage | AIMessage)[] = [];
  const userMessage = input.userMessage?.trim();
  if (userMessage) {
    messages.push(new HumanMessage(userMessage));
  }
  messages.push(new AIMessage(errorMessage));

  try {
    await (
      await getGraph()
    ).updateState(
      getThreadConfig(input.threadId, "persist-assistant-failure", {
        userId: input.userId,
      }),
      {
        messages,
      },
      "call-model",
    );
  } catch (error) {
    console.error("[graph] Failed to persist assistant failure", error);
  }
};

/**
 * Repairs orphaned tool calls in the conversation state.
 * When tool execution fails mid-stream, the conversation can be left with
 * AIMessage tool_calls that have no corresponding ToolMessage responses.
 * This function detects and fixes that by adding error ToolMessages.
 */
const repairOrphanedToolCalls = async (input: {
  threadId: string;
  userId?: string;
}): Promise<void> => {
  try {
    const graph = await getGraph();
    const config = getThreadConfig(input.threadId, "repair-orphaned-tools", {
      userId: input.userId,
    });

    const state = await graph.getState(config);
    const values = state.values;
    if (!values || typeof values !== "object") {
      return;
    }

    const messages = (values as { messages?: unknown }).messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return;
    }

    // Find the last AIMessage with tool_calls
    let lastAIMessageIndex = -1;
    let orphanedToolCalls: Array<{ id: string; name: string }> = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        msg &&
        typeof msg === "object" &&
        "tool_calls" in msg &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0
      ) {
        lastAIMessageIndex = i;
        orphanedToolCalls = msg.tool_calls
          .filter(
            (tc: unknown) =>
              tc && typeof tc === "object" && "id" in tc && "name" in tc,
          )
          .map((tc: { id: string; name: string }) => ({
            id: tc.id,
            name: tc.name,
          }));
        break;
      }
    }

    if (lastAIMessageIndex === -1 || orphanedToolCalls.length === 0) {
      return;
    }

    // Check which tool_call_ids have responses in messages after the AIMessage
    const respondedToolCallIds = new Set<string>();
    for (let i = lastAIMessageIndex + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (
        msg &&
        typeof msg === "object" &&
        "tool_call_id" in msg &&
        typeof msg.tool_call_id === "string"
      ) {
        respondedToolCallIds.add(msg.tool_call_id);
      }
    }

    // Find orphaned tool calls (no response)
    const missingResponses = orphanedToolCalls.filter(
      (tc) => !respondedToolCallIds.has(tc.id),
    );

    if (missingResponses.length === 0) {
      return;
    }

    console.warn("[graph] Repairing orphaned tool calls:", {
      threadId: input.threadId,
      orphanedCount: missingResponses.length,
      toolCallIds: missingResponses.map((tc) => tc.id),
    });

    // Create error ToolMessages for orphaned tool calls
    const repairMessages = missingResponses.map(
      (tc) =>
        new ToolMessage({
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify({
            success: false,
            error:
              "Tool execution was interrupted. The previous request failed to complete. Please retry your request.",
          }),
        }),
    );

    // Update state with repair messages
    await graph.updateState(config, { messages: repairMessages }, "tools");

    console.log("[graph] Successfully repaired orphaned tool calls:", {
      threadId: input.threadId,
      repairedCount: repairMessages.length,
    });
  } catch (error) {
    console.error("[graph] Failed to repair orphaned tool calls:", {
      threadId: input.threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - let the stream attempt to continue
  }
};

export async function* streamSpreadsheetAssistant(input: {
  threadId: string;
  userId?: string;
  docId?: string;
  sessionTitle?: string;
  message: string;
  model?: string;
  provider?: Provider;
  reasoningEnabled?: boolean;
  systemInstructions?: string;
  abortSignal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent, void, unknown> {
  // Repair any orphaned tool calls from previous failed requests
  await repairOrphanedToolCalls({
    threadId: input.threadId,
    userId: input.userId,
  });

  yield {
    type: "message.start",
    threadId: input.threadId,
  };

  const config = getThreadConfig(input.threadId, "stream-assistant", {
    model: input.model,
    provider: input.provider,
    reasoningEnabled: input.reasoningEnabled,
    docId: input.docId,
    sessionTitle: input.sessionTitle,
    systemInstructions: input.systemInstructions,
    userId: input.userId,
  });

  // Use streamEvents to get proper LangSmith tracing with the thread
  const eventStream = (await getGraph()).streamEvents(
    {
      messages: [new HumanMessage(input.message)],
    },
    {
      ...config,
      version: "v2",
      durability: "async",
      recursionLimit: parsePositiveInt(
        getEnv("LANGGRAPH_RECURSION_LIMIT"),
        DEFAULT_GRAPH_RECURSION_LIMIT,
      ),
      signal: input.abortSignal,
    },
  );

  let assistantMessage = "";
  const emittedToolResultKeys = new Set<string>();
  const observedToolCallKeys = new Set<string>();
  const pendingToolArgsByCallId = new Map<string, unknown>();
  const pendingToolArgsByName = new Map<
    string,
    Array<{ args: unknown; toolCallId?: string }>
  >();
  const TOOL_INPUT_UNAVAILABLE_MARKER = "__rnc_tool_input_unavailable__";
  const createUnavailableToolArgs = () => ({
    [TOOL_INPUT_UNAVAILABLE_MARKER]: true,
  });

  const getToolArgsSpecificity = (value: unknown): number => {
    if (value === undefined || value === null) {
      return 0;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 1;
      }
      if (trimmed === "{}" || trimmed === "[]") {
        return 2;
      }
      return 3 + Math.min(trimmed.length, 2000);
    }

    if (Array.isArray(value)) {
      return value.length === 0 ? 2 : 20 + value.length;
    }

    if (typeof value === "object") {
      const keyCount = Object.keys(value as Record<string, unknown>).length;
      return keyCount === 0 ? 2 : 30 + keyCount;
    }

    return 10;
  };

  const shouldReplacePendingToolArgs = (next: unknown, current: unknown) =>
    getToolArgsSpecificity(next) > getToolArgsSpecificity(current);

  const enqueuePendingToolArgs = (toolCall: StreamedToolCall) => {
    // Tool call IDs can appear many times as streaming argument chunks arrive.
    // Keep upgrading to the most informative args instead of freezing on "{}".
    if (!toolCall.toolCallId) {
      const key = `name:${toolCall.toolName}:${stringifyUnknown(toolCall.args)}`;
      if (observedToolCallKeys.has(key)) {
        return;
      }
      observedToolCallKeys.add(key);
    }

    if (toolCall.toolCallId) {
      const existingById = pendingToolArgsByCallId.get(toolCall.toolCallId);
      if (
        existingById === undefined ||
        shouldReplacePendingToolArgs(toolCall.args, existingById)
      ) {
        pendingToolArgsByCallId.set(toolCall.toolCallId, toolCall.args);
      }
    }

    const existingQueue = pendingToolArgsByName.get(toolCall.toolName) ?? [];
    if (toolCall.toolCallId) {
      const existingEntry = existingQueue.find(
        (entry) => entry.toolCallId === toolCall.toolCallId,
      );
      if (existingEntry) {
        if (shouldReplacePendingToolArgs(toolCall.args, existingEntry.args)) {
          existingEntry.args = toolCall.args;
        }
      } else {
        existingQueue.push({
          toolCallId: toolCall.toolCallId,
          args: toolCall.args,
        });
      }
    } else {
      existingQueue.push({ args: toolCall.args });
    }

    if (!pendingToolArgsByName.has(toolCall.toolName)) {
      pendingToolArgsByName.set(toolCall.toolName, existingQueue);
    }
  };

  const resolveToolArgs = (
    toolName: string,
    toolCallId?: string,
    args?: unknown,
  ): unknown => {
    if (args !== undefined) {
      return args;
    }

    if (toolCallId) {
      const byId = pendingToolArgsByCallId.get(toolCallId);
      if (byId !== undefined) {
        pendingToolArgsByCallId.delete(toolCallId);
        const byNameQueue = pendingToolArgsByName.get(toolName);
        if (byNameQueue) {
          const remaining = byNameQueue.filter(
            (entry) => entry.toolCallId !== toolCallId,
          );
          if (remaining.length > 0) {
            pendingToolArgsByName.set(toolName, remaining);
          } else {
            pendingToolArgsByName.delete(toolName);
          }
        }
        return byId;
      }
    }

    const byNameQueue = pendingToolArgsByName.get(toolName);
    if (byNameQueue && byNameQueue.length > 0) {
      const next = byNameQueue.shift();
      if (next?.toolCallId) {
        pendingToolArgsByCallId.delete(next.toolCallId);
      }
      if (byNameQueue.length === 0) {
        pendingToolArgsByName.delete(toolName);
      }
      return next?.args;
    }

    return undefined;
  };

  try {
    for await (const event of eventStream) {
      const observedToolCalls = collectStreamedToolCalls(event.data);
      for (const toolCall of observedToolCalls) {
        enqueuePendingToolArgs(toolCall);
      }

      // Handle model start - emit reasoning.start so UI can show thinking indicator
      if (event.event === "on_chat_model_start") {
        yield {
          type: "reasoning.start",
        };
        continue;
      }

      // Handle streaming tokens from the LLM
      if (event.event === "on_chat_model_stream") {
        const chunk = event.data?.chunk;
        if (!chunk) continue;

        const reasoningDelta =
          contentToReasoning(chunk.content) ||
          additionalKwargsToReasoning(chunk.additional_kwargs);

        if (reasoningDelta) {
          yield {
            type: "reasoning.delta",
            delta: reasoningDelta,
          };
        }

        const delta = contentToText(chunk.content);

        if (!delta) {
          continue;
        }

        assistantMessage += delta;

        yield {
          type: "message.delta",
          delta,
        };
        continue;
      }

      // Handle tool calls
      if (event.event === "on_tool_start") {
        const toolName = event.name;
        const toolInput = event.data?.input;
        const runId = event.run_id;
        const resolvedArgs = resolveToolArgs(toolName, runId, toolInput);

        yield {
          type: "tool.call",
          toolName,
          toolCallId: runId,
          args: resolvedArgs ?? createUnavailableToolArgs(),
        };
        continue;
      }

      // Handle tool results
      if (event.event === "on_tool_end") {
        const toolName = event.name;
        const toolOutput = event.data?.output;
        const toolInput =
          event.data &&
          typeof event.data === "object" &&
          "input" in event.data &&
          (event.data as { input?: unknown }).input !== undefined
            ? (event.data as { input?: unknown }).input
            : undefined;
        const runId = event.run_id;
        const resolvedArgs = resolveToolArgs(toolName, runId, toolInput);
        const normalized = normalizeToolResult(toolOutput);
        const dedupKey = getToolResultDedupKey({
          toolName,
          ...(runId ? { toolCallId: runId } : {}),
          result: normalized.result,
          isError: normalized.isError,
        });
        if (emittedToolResultKeys.has(dedupKey)) {
          continue;
        }
        emittedToolResultKeys.add(dedupKey);

        yield {
          type: "tool.result",
          toolName,
          toolCallId: runId,
          ...(resolvedArgs !== undefined ? { args: resolvedArgs } : {}),
          result: normalized.result,
          isError: normalized.isError,
        };
        continue;
      }

      // Handle tool errors
      if (event.event === "on_tool_error") {
        const toolName = event.name;
        const error = event.data?.error as unknown;
        const toolInput =
          event.data &&
          typeof event.data === "object" &&
          "input" in event.data &&
          (event.data as { input?: unknown }).input !== undefined
            ? (event.data as { input?: unknown }).input
            : undefined;
        const runId = event.run_id;
        const resolvedArgs = resolveToolArgs(toolName, runId, toolInput);
        const result = {
          success: false,
          error:
            error && typeof error === "object" && "message" in error
              ? String(error.message)
              : stringifyUnknown(error),
        };
        const dedupKey = getToolResultDedupKey({
          toolName,
          ...(runId ? { toolCallId: runId } : {}),
          result,
          isError: true,
        });
        if (emittedToolResultKeys.has(dedupKey)) {
          continue;
        }
        emittedToolResultKeys.add(dedupKey);

        yield {
          type: "tool.result",
          toolName,
          toolCallId: runId,
          ...(resolvedArgs !== undefined ? { args: resolvedArgs } : {}),
          result,
          isError: true,
        };
        continue;
      }

      // Handle ToolMessage errors emitted via chain events (for example,
      // schema validation failures that don't always surface as on_tool_error).
      if (event.event === "on_chain_stream" || event.event === "on_chain_end") {
        const chainToolResults = collectStreamedToolResults(event.data);
        for (const chainToolResult of chainToolResults) {
          const resolvedArgs = resolveToolArgs(
            chainToolResult.toolName,
            chainToolResult.toolCallId,
            chainToolResult.args,
          );
          const dedupKey = getToolResultDedupKey(chainToolResult);
          if (emittedToolResultKeys.has(dedupKey)) {
            continue;
          }
          emittedToolResultKeys.add(dedupKey);

          yield {
            type: "tool.result",
            toolName: chainToolResult.toolName,
            toolCallId: chainToolResult.toolCallId,
            ...(resolvedArgs !== undefined ? { args: resolvedArgs } : {}),
            result: chainToolResult.result,
            isError: chainToolResult.isError,
          };
        }
        continue;
      }

      // Handle chain/graph errors (e.g., invalid tool arguments from LLM)
      if (event.event === "on_chain_error") {
        const error = event.data?.error as unknown;
        const rawErrorMessage =
          error && typeof error === "object" && "message" in error
            ? String(error.message)
            : String(error);
        const errorMessage = normalizeAssistantErrorMessage(
          rawErrorMessage,
          "Unable to process this request. Please retry.",
        );

        console.error("[graph] Chain error:", rawErrorMessage);
        await persistAssistantMessageToCheckpoint({
          threadId: input.threadId,
          userId: input.userId,
          message: errorMessage,
        });

        yield {
          type: "error",
          error: errorMessage,
        };
        return;
      }

      // Handle LLM errors
      if (event.event === "on_llm_error") {
        const error = event.data?.error as unknown;
        const rawErrorMessage =
          error && typeof error === "object" && "message" in error
            ? String(error.message)
            : String(error);
        const errorMessage = normalizeAssistantErrorMessage(
          rawErrorMessage,
          "The model request failed. Please retry.",
        );

        console.error("[graph] LLM error:", rawErrorMessage);
        await persistAssistantMessageToCheckpoint({
          threadId: input.threadId,
          userId: input.userId,
          message: errorMessage,
        });

        yield {
          type: "error",
          error: errorMessage,
        };
        return;
      }
    }
  } catch (error) {
    const abortReason = input.abortSignal?.aborted
      ? input.abortSignal.reason
      : undefined;
    const abortReasonCode = getAbortReasonCode(abortReason);
    if (isAbortError(error) || input.abortSignal?.aborted) {
      if (abortReasonCode === "SERVER_TIMEOUT") {
        const partialMessage = assistantMessage.trim();
        const timeoutMessage = getServerTimeoutMessage(
          getAbortReasonTimeoutMs(abortReason),
        );
        const finalMessage = partialMessage
          ? `${partialMessage}\n\n${timeoutMessage}`
          : timeoutMessage;

        console.warn("[graph] Streaming aborted by server timeout");
        await persistAssistantMessageToCheckpoint({
          threadId: input.threadId,
          userId: input.userId,
          message: finalMessage,
        });

        yield {
          type: "message.complete",
          threadId: input.threadId,
          message: finalMessage,
        };
        return;
      }

      if (abortReasonCode === "CLIENT_ABORT") {
        console.warn("[graph] Streaming aborted by client");
        return;
      }
    }

    if (!isGraphRecursionLimitError(error)) {
      const rawErrorMessage =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : String(error ?? "");
      const errorMessage = normalizeAssistantErrorMessage(
        rawErrorMessage,
        "Assistant request failed. Please retry.",
      );

      console.error("[graph] Streaming error:", rawErrorMessage);
      await persistAssistantMessageToCheckpoint({
        threadId: input.threadId,
        userId: input.userId,
        message: errorMessage,
      });
      yield {
        type: "error",
        error: errorMessage,
      };
      return;
    }

    const partialMessage = assistantMessage.trim();
    const fallbackMessage = partialMessage
      ? `${partialMessage}\n\nI hit the tool-iteration limit before finishing. Ask me to continue and I will proceed from here.`
      : "I hit the tool-iteration limit before finishing this request. Ask me to continue and I will proceed.";
    await persistAssistantMessageToCheckpoint({
      threadId: input.threadId,
      userId: input.userId,
      message: fallbackMessage,
    });

    yield {
      type: "message.complete",
      threadId: input.threadId,
      message: fallbackMessage,
    };
    return;
  }

  const finalMessage =
    assistantMessage.trim() || "I do not have a response yet.";

  yield {
    type: "message.complete",
    threadId: input.threadId,
    message: finalMessage,
  };
}

export async function invokeSpreadsheetAssistant(input: {
  threadId: string;
  userId?: string;
  message: string;
  model?: string;
  provider?: Provider;
  reasoningEnabled?: boolean;
}) {
  let finalMessage = "";

  for await (const event of streamSpreadsheetAssistant(input)) {
    if (event.type === "message.delta") {
      finalMessage += event.delta;
      continue;
    }

    if (event.type === "message.complete") {
      finalMessage = event.message;
    }
  }

  return {
    message: finalMessage || "I do not have a response yet.",
  };
}
