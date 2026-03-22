import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

import type { ChatStreamEvent } from "@/lib/chat/protocol";
import { spreadsheetTools } from "@/lib/chat/tools";

const DEFAULT_OPENAI_MODEL = "gpt-5.2-chat-latest";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MODEL_TEMPERATURE = 0.2;
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
const DEFAULT_ANTHROPIC_THINKING_BUDGET_TOKENS = 2048;
const DEFAULT_GRAPH_RECURSION_LIMIT = 75;
const CLAUDE_MODEL_PATTERN = /^claude/i;
const REASONING_MODEL_PATTERN = /^(o\d|gpt-5|codex)/i;

const isReasoningModel = (model: string) =>
  REASONING_MODEL_PATTERN.test(model.trim());
const isClaudeModel = (model: string) =>
  CLAUDE_MODEL_PATTERN.test(model.trim());

const getEnv = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

type Provider = "openai" | "anthropic";
type OpenAIReasoningSummary = "auto" | "concise" | "detailed" | null;
type OpenAIReasoningEffort = "low" | "medium" | "high";
type AnthropicThinkingMode = "enabled" | "adaptive" | "disabled";

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

  return `You are an expert Excel and spreadsheet assistant. You help users create, modify, analyze, and improve spreadsheets that are accurate, maintainable, and easy to understand.

## Priorities
1. Correctness first
2. Clarity over complexity
3. Maintainable structure over clever formulas
4. Fast execution with sensible defaults
5. Professional formatting only when it improves usability

## General behavior
- Understand the user’s goal before making spreadsheet changes.
- Adapt the spreadsheet structure to the task instead of forcing a fixed layout.
- Prefer simple, auditable formulas and consistent patterns.
- Keep inputs, calculations, and outputs clearly separated whenever the model or workflow is non-trivial.
- Use formatting to improve readability, not as decoration.
- Avoid unnecessary complexity, excessive styling, or brittle formulas.
- Default to action over clarification: make reasonable assumptions and execute.
- If information is missing but common defaults are possible, proceed with those defaults and state assumptions briefly.
- Never stop at a question when a safe, non-destructive next step is available.

## Spreadsheet design principles
- Create clear headers and labels.
- Group related content logically.
- Keep assumptions and editable inputs in clearly marked areas when relevant.
- Make formulas easy to trace and copy across rows or columns.
- Use helper columns instead of deeply nested formulas when that improves clarity.
- Freeze panes, filters, tables, and conditional formatting when they materially improve navigation or usability.
- Size columns and format numbers appropriately for the content.

## Formula standards
- Do not hardcode repeat-use constants inside formulas when they should be user-editable.
- Reference cells or named ranges for assumptions when appropriate.
- Prefer robust formulas that fill down cleanly.
- Add error handling where needed, but do not hide real problems unnecessarily.
- Use the simplest formula that reliably solves the task.
- Preserve existing workbook logic unless the user asks for a redesign.

## Error handling and formula repair
- Always check for broken or invalid spreadsheet formulas when creating or editing a workbook.
- If a formula returns an error such as #REF!, #VALUE!, #DIV/0!, #NAME?, #N/A, #NUM!, #NULL!, or #SPILL!, fix it whenever the intended logic can be determined reliably.
- Prefer repairing the root cause instead of masking the error with IFERROR unless the error is an expected part of the model.
- Replace broken references with valid references based on surrounding formulas, headers, labels, and workbook structure.
- When the correct fix is ambiguous, make the safest reasonable repair and clearly note it in the summary.
- Preserve the user’s intended calculation logic while fixing errors.
- Never leave obvious formula errors unresolved if they can be repaired.

## Formatting standards
- Use professional, restrained formatting.
- Distinguish inputs, calculated cells, headers, and totals when useful.
- Apply appropriate number formats for currency, percentages, dates, and large numbers.
- Use borders, fill, and emphasis sparingly.
- Avoid merged cells unless they genuinely improve presentation and won’t interfere with sorting, filtering, or downstream use.

## When creating a new spreadsheet or sheet
- Start with a structure that matches the user’s objective.
- Include titles, headers, summaries, and assumptions only when they are useful.
- Make the result usable immediately, not just technically complete.
- Default to a clean, business-friendly layout.
- If the workbook/sheet is empty and the user asks for a report/summary/model, scaffold a practical starter layout immediately (headers, formulas, totals, and sensible placeholders) instead of asking for schema first.

## When editing an existing spreadsheet
- Respect the existing structure unless it is clearly broken or the user asks for improvement.
- Avoid unnecessary reformatting.
- Preserve formulas, references, and sheet logic.
- Make targeted changes and keep them consistent with the workbook.

## Communication style
- Be concise, direct, and practical.
- Briefly explain important design or formula choices when they are not obvious.
- Ask for clarification only when absolutely required to avoid a likely wrong or destructive result.
- If clarification is needed, ask at most one short question and include what was already done.
- After making changes, summarize what was done and note anything the user should review.

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
    const configuredThinkingBudget = parsePositiveInt(
      getEnv("ANTHROPIC_THINKING_BUDGET_TOKENS"),
      DEFAULT_ANTHROPIC_THINKING_BUDGET_TOKENS,
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
      model,
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

const createGraph = () => {
  const checkpointer = new MemorySaver();
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
    .compile({ checkpointer });
};

type ChatGraph = ReturnType<typeof createGraph>;

let graph: ChatGraph | null = null;

const getGraph = () => {
  if (!graph) {
    graph = createGraph();
  }

  return graph;
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
  },
) => ({
  configurable: {
    thread_id: threadId,
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
    ...(override?.model ? { model: override.model } : {}),
    ...(override?.provider ? { provider: override.provider } : {}),
    ...(typeof override?.reasoningEnabled === "boolean"
      ? { reasoningEnabled: override.reasoningEnabled }
      : {}),
    ...(override?.docId ? { docId: override.docId } : {}),
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
    status?: unknown;
    content?: unknown;
  };
  const kwargs =
    maybeMessage.kwargs && typeof maybeMessage.kwargs === "object"
      ? (maybeMessage.kwargs as {
          name?: unknown;
          tool_call_id?: unknown;
          status?: unknown;
          content?: unknown;
        })
      : undefined;

  const idParts = Array.isArray(maybeMessage.id)
    ? maybeMessage.id.map((part) => String(part))
    : [];
  const isToolMessageType = idParts.some((part) => part.includes("ToolMessage"));

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
  const status =
    maybeToolMessage.status ??
    maybeToolMessage.kwargs?.status;
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

export async function* streamSpreadsheetAssistant(input: {
  threadId: string;
  docId?: string;
  message: string;
  model?: string;
  provider?: Provider;
  reasoningEnabled?: boolean;
  systemInstructions?: string;
  abortSignal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent, void, unknown> {
  yield {
    type: "message.start",
    threadId: input.threadId,
  };

  const config = getThreadConfig(input.threadId, "stream-assistant", {
    model: input.model,
    provider: input.provider,
    reasoningEnabled: input.reasoningEnabled,
    docId: input.docId,
    systemInstructions: input.systemInstructions,
  });

  // Use streamEvents to get proper LangSmith tracing with the thread
  const eventStream = getGraph().streamEvents(
    {
      messages: [new HumanMessage(input.message)],
    },
    {
      ...config,
      version: "v2",
      recursionLimit: parsePositiveInt(
        getEnv("LANGGRAPH_RECURSION_LIMIT"),
        DEFAULT_GRAPH_RECURSION_LIMIT,
      ),
      signal: input.abortSignal,
    },
  );

  let assistantMessage = "";
  const emittedToolResultKeys = new Set<string>();
  try {
    for await (const event of eventStream) {
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

        yield {
          type: "tool.call",
          toolName,
          toolCallId: runId,
          args: toolInput,
        };
        continue;
      }

      // Handle tool results
      if (event.event === "on_tool_end") {
        const toolName = event.name;
        const toolOutput = event.data?.output;
        const runId = event.run_id;
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
          result: normalized.result,
          isError: normalized.isError,
        };
        continue;
      }

      // Handle tool errors
      if (event.event === "on_tool_error") {
        const toolName = event.name;
        const error = event.data?.error as unknown;
        const runId = event.run_id;
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
          const dedupKey = getToolResultDedupKey(chainToolResult);
          if (emittedToolResultKeys.has(dedupKey)) {
            continue;
          }
          emittedToolResultKeys.add(dedupKey);

          yield {
            type: "tool.result",
            toolName: chainToolResult.toolName,
            toolCallId: chainToolResult.toolCallId,
            result: chainToolResult.result,
            isError: chainToolResult.isError,
          };
        }
        continue;
      }

      // Handle chain/graph errors (e.g., invalid tool arguments from LLM)
      if (event.event === "on_chain_error") {
        const error = event.data?.error as unknown;
        const errorMessage =
          error && typeof error === "object" && "message" in error
            ? String(error.message)
            : String(error);

        console.error("[graph] Chain error:", errorMessage);

        yield {
          type: "error",
          error: `Processing error: ${errorMessage}`,
        };
        continue;
      }

      // Handle LLM errors
      if (event.event === "on_llm_error") {
        const error = event.data?.error as unknown;
        const errorMessage =
          error && typeof error === "object" && "message" in error
            ? String(error.message)
            : String(error);

        console.error("[graph] LLM error:", errorMessage);

        yield {
          type: "error",
          error: `Model error: ${errorMessage}`,
        };
        continue;
      }
    }
  } catch (error) {
    if (!isGraphRecursionLimitError(error)) {
      throw error;
    }

    const partialMessage = assistantMessage.trim();
    const fallbackMessage = partialMessage
      ? `${partialMessage}\n\nI hit the tool-iteration limit before finishing. Ask me to continue and I will proceed from here.`
      : "I hit the tool-iteration limit before finishing this request. Ask me to continue and I will proceed.";

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
