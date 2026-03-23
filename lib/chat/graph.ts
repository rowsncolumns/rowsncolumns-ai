import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
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
import { spreadsheetTools } from "@/lib/chat/tools";

const DEFAULT_OPENAI_MODEL = "gpt-5.2-chat-latest";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MODEL_TEMPERATURE = 0.2;
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
const DEFAULT_ANTHROPIC_THINKING_BUDGET_TOKENS = 2048;
const DEFAULT_GRAPH_RECURSION_LIMIT = 75;
const DEFAULT_LANGGRAPH_CHECKPOINT_SCHEMA = "public";
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

## Coordinate System (Critical)
- Treat spreadsheet row/column indexes as 1-based unless a tool explicitly states otherwise.
- A1 corresponds to rowIndex=1 and columnIndex=1.
- When uncertain, prefer explicit A1 notation to avoid off-by-one mistakes.

## Spreadsheet design principles
- Create clear headers and labels.
- Group related content logically.
- Keep assumptions and editable inputs in clearly marked areas when relevant.
- Make formulas easy to trace and copy across rows or columns.
- Use helper columns instead of deeply nested formulas when that improves clarity.
- Freeze panes, filters, tables, and conditional formatting when they materially improve navigation or usability.
- Size columns and format numbers appropriately for the content.

## Automatic Formula Error Detection and Fixing

When you see formula errors in the spreadsheet (via query_sheet_range results
or formulaResults), you MUST automatically attempt to fix them without waiting
for the user to ask. This is critical for a good user experience.

## Error Types and Automatic Fixes

1. **Circular Dependency Errors (#CIRC!, circular reference errors)**:
    - These appear in LBO models, financial models with goal-seeking, or models
      where interest expense depends on debt which depends on cash flow
    - **AUTO-FIX (fallback for unintentional errors)**: Immediately use
      enable iterative mode to resolve these
    - No user confirmation needed - this is the standard fix for financial models
    - NOTE: This is a reactive fallback. See PREVENTION section below for the
      preferred proactive approach

2. **#REF! Errors**:
    - If caused by circular references, enable iterative calculation mode
    - If caused by deleted cells/ranges, inform the user about the broken reference

3. **#NAME? Errors**:
    - Usually indicates an unknown function or misspelled formula
    - Suggest corrections if the intended function is clear

4. **#VALUE! Errors**:
    - Wrong argument type in formula
    - Review the formula and suggest fixes

5. **#DIV/0! Errors**:
    - Division by zero
    - Suggest adding error handling with IFERROR() or fixing the divisor

## Proactive Behavior
- When opening or querying a spreadsheet, scan for errors in the results
- If you detect circular dependency patterns (common in financial/LBO models),
  enable iterative calculation mode immediately
- After fixing errors, verify the fix worked by re-querying the affected range
- Inform the user what you fixed and why

## PREVENTION — Avoiding Circular References
By default, do NOT create formulas that produce circular references.
A circular reference occurs when a formula directly or indirectly refers
back to its own cell (e.g., A1 → B1 → A1). These cause #CIRC! or #REF!
errors and break the spreadsheet.

Before writing any formula, verify that none of the referenced cells
depend (directly or indirectly) on the cell you are writing to.

Common accidental circular patterns:
- A cell's formula references itself (e.g., =A1+1 written into A1)
- Two cells referencing each other (e.g., A1=B1+1 and B1=A1+1)
- Indirect loops through intermediate cells (e.g., A1→B1→C1→A1)

If circular references are intentionally required (e.g., LBO models,
iterative goal-seeking), you MUST enable iterative mode BEFORE writing any circular formulas. The
preferred approach is always to enable iterative calculation mode
proactively rather than relying on the reactive auto-fix above.

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

const buildCheckpointThreadId = (threadId: string, userId?: string) =>
  userId ? `user:${userId}:thread:${threadId}` : threadId;

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
  },
) => ({
  configurable: {
    thread_id: buildCheckpointThreadId(threadId, override?.userId),
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
      : resultSource ?? "";

  return {
    ...(typeof toolCallIdValue === "string" ? { toolCallId: toolCallIdValue } : {}),
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
            ? toolCallLocationById.get(toolResult.toolCallId) ?? null
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
      const text = contentToText(getStoredMessageProperty(rawMessage, "content"));
      const toolCalls = getStoredToolCalls(rawMessage);
      const parts: PersistedThreadContentPart[] = [];

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
  const state = await (await getGraph()).getState(
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
    await (await getGraph()).updateState(
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

export async function* streamSpreadsheetAssistant(input: {
  threadId: string;
  userId?: string;
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
        const toolInput =
          event.data &&
          typeof event.data === "object" &&
          "input" in event.data &&
          (event.data as { input?: unknown }).input !== undefined
            ? (event.data as { input?: unknown }).input
            : undefined;
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
          ...(toolInput !== undefined ? { args: toolInput } : {}),
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
          ...(toolInput !== undefined ? { args: toolInput } : {}),
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
