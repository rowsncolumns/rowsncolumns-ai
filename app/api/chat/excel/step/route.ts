import { NextResponse } from "next/server";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

import { isAdminUser } from "@/lib/auth/admin";
import { auth } from "@/lib/auth/server";
import { buildSpreadsheetContextInstructions } from "@/lib/chat/context";
import type {
  ExcelChatStepRequest,
  ExcelChatStepResponse,
  ExcelToolCall,
} from "@/lib/chat/excel-protocol";
import {
  mergeSystemInstructions,
  normalizeInstructionText,
} from "@/lib/chat/instructions";
import { spreadsheetTools } from "@/lib/chat/tools";
import { listAssistantSkills } from "@/lib/skills/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_OPENAI_MODEL = "gpt-5.4";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const CHAT_MODEL = process.env.CHAT_MODEL?.trim() || undefined;
const CHAT_SYSTEM_INSTRUCTIONS =
  process.env.CHAT_SYSTEM_INSTRUCTIONS?.trim() || undefined;

const EXCEL_TOOL_NAMES = new Set([
  "spreadsheet_changeBatch",
  "spreadsheet_queryRange",
  "spreadsheet_readDocument",
  "spreadsheet_createSheet",
  "spreadsheet_updateSheet",
  "spreadsheet_formatRange",
]);

const EXCEL_PLANNING_TOOLS = spreadsheetTools.filter((tool) =>
  EXCEL_TOOL_NAMES.has(tool.name),
);

const normalizeProvider = (
  value: unknown,
): "openai" | "anthropic" | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "openai" || normalized === "anthropic") {
    return normalized;
  }
  return undefined;
};

const inferProviderFromModel = (
  model: string | undefined,
): "openai" | "anthropic" => {
  if (!model) return "openai";
  return /^claude/i.test(model) ? "anthropic" : "openai";
};

const safeJsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseToolArgs = (value: unknown) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const contentToText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        chunks.push(part);
        continue;
      }
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") {
          chunks.push(text);
        }
      }
    }
    return chunks.join("");
  }

  return "";
};

const getLatestUserMessage = (messages: ExcelChatStepRequest["messages"]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.content.trim().length > 0) {
      return message.content.trim();
    }
  }
  return "";
};

const buildSystemPrompt = (input: {
  userInstructions?: string;
  contextInstructions?: string;
  skillsInstructions?: string;
}) => {
  const basePrompt = `You are an expert Excel assistant running inside an Office add-in.

You MUST only use available tools when you need to read or modify workbook state.
Prefer safe, minimal edits and keep responses concise and practical.

Important constraints:
- Use A1 notation in tool args.
- sheetId values are 1-based worksheet positions when provided.
- Keep formatting changes focused and avoid broad stylistic rewrites.
- If a request is unclear, make a reasonable assumption and proceed.

Execution contract (mandatory):
- You are an execution agent, not a planner.
- If any tool result shows formula errors (#REF!, #VALUE!, #DIV/0!, #NAME?, #N/A, #NUM!, #NULL!, #SPILL!), immediately issue tool calls to repair them in this same run.
- After each repair, verify the affected range with spreadsheet_queryRange or spreadsheet_readDocument.
- Do not output "next step", "I will fix", "I can fix", or any future-tense repair promise.
- Only return a final assistant message when detected formula errors are resolved, or the tool-iteration limit is reached.
- If the tool-iteration limit is reached, report unresolved cells/ranges and the exact next repair action.
`;

  return mergeSystemInstructions(
    mergeSystemInstructions(
      mergeSystemInstructions(
        normalizeInstructionText(basePrompt),
        normalizeInstructionText(input.userInstructions),
      ),
      normalizeInstructionText(input.contextInstructions),
    ),
    normalizeInstructionText(input.skillsInstructions),
  );
};

const toConversationMessages = (
  input: ExcelChatStepRequest,
  systemPrompt: string,
) => {
  const messages: BaseMessage[] = [new SystemMessage(systemPrompt)];

  for (const message of input.messages) {
    const content = message.content.trim();
    if (!content) continue;
    if (message.role === "user") {
      messages.push(new HumanMessage(content));
      continue;
    }
    messages.push(new AIMessage(content));
  }

  for (const round of input.toolRounds ?? []) {
    const normalizedCalls = round.toolCalls
      .filter((call) => EXCEL_TOOL_NAMES.has(call.toolName))
      .map((call) => ({
        id: call.toolCallId,
        name: call.toolName,
        args: parseToolArgs(call.args),
        type: "tool_call" as const,
      }));

    if (normalizedCalls.length === 0) continue;

    messages.push(
      new AIMessage({
        content: "",
        tool_calls: normalizedCalls,
      }),
    );

    for (const result of round.toolResults) {
      messages.push(
        new ToolMessage({
          content: safeJsonStringify(result.result),
          tool_call_id: result.toolCallId,
          name: result.toolName,
        }),
      );
    }
  }

  return messages;
};

const toToolCalls = (rawToolCalls: unknown[]): ExcelToolCall[] => {
  const result: ExcelToolCall[] = [];

  for (const entry of rawToolCalls) {
    if (!entry || typeof entry !== "object") continue;
    const toolCall = entry as {
      id?: unknown;
      name?: unknown;
      args?: unknown;
    };
    if (typeof toolCall.name !== "string") continue;
    if (!EXCEL_TOOL_NAMES.has(toolCall.name)) continue;

    const toolCallId =
      typeof toolCall.id === "string" && toolCall.id.trim().length > 0
        ? toolCall.id
        : `tool_${Math.random().toString(36).slice(2, 10)}`;

    result.push({
      toolCallId,
      toolName: toolCall.name,
      args: parseToolArgs(toolCall.args),
    });
  }

  return result;
};

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const user = session?.user;
    if (!user?.id) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized. Please sign in to continue." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as ExcelChatStepRequest;
    const threadId = body.threadId?.trim();
    if (!threadId) {
      return NextResponse.json(
        {
          ok: false,
          error: "threadId is required.",
        } satisfies ExcelChatStepResponse,
        { status: 400 },
      );
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "messages are required.",
        } satisfies ExcelChatStepResponse,
        { status: 400 },
      );
    }

    const requestedModel =
      typeof body.model === "string" && body.model.trim().length > 0
        ? body.model.trim()
        : undefined;
    const provider =
      normalizeProvider(body.provider) ??
      inferProviderFromModel(requestedModel);
    const model =
      requestedModel ||
      CHAT_MODEL ||
      (provider === "anthropic"
        ? DEFAULT_ANTHROPIC_MODEL
        : DEFAULT_OPENAI_MODEL);

    let skillsInstructions = "";
    try {
      const skills = await listAssistantSkills({ userId: user.id });
      if (skills.length > 0) {
        const activeSkills = skills
          .filter((skill) => skill.active)
          .map((skill) => `Skill: ${skill.name}\n${skill.instructions}`)
          .join("\n\n");
        skillsInstructions = activeSkills;
      }
    } catch (error) {
      console.error("[chat/excel/step] Failed to load skills", error);
    }

    const latestUserMessage = getLatestUserMessage(body.messages);
    const contextInstructions = buildSpreadsheetContextInstructions(
      body.context,
    );
    const systemPrompt =
      buildSystemPrompt({
        userInstructions: body.systemInstructions ?? CHAT_SYSTEM_INSTRUCTIONS,
        contextInstructions,
        skillsInstructions,
      }) || "You are an expert Excel assistant.";
    const conversation = toConversationMessages(body, systemPrompt);

    const llm =
      provider === "anthropic"
        ? new ChatAnthropic({
            model,
            temperature: 0,
          })
        : new ChatOpenAI({
            model,
            temperature: 0,
          });

    const llmWithTools = llm.bindTools(EXCEL_PLANNING_TOOLS);
    const response = await llmWithTools.invoke(conversation, {
      metadata: {
        threadId,
        userId: user.id,
        isAdmin: isAdminUser({ id: user.id, email: user.email }),
        lastUserMessage: latestUserMessage.slice(0, 500),
      },
      signal: request.signal,
    });

    const toolCalls = toToolCalls(
      Array.isArray(response.tool_calls) ? response.tool_calls : [],
    );
    if (toolCalls.length > 0) {
      return NextResponse.json({
        ok: true,
        type: "tool_calls",
        toolCalls,
      } satisfies ExcelChatStepResponse);
    }

    const message = contentToText(response.content).trim();
    return NextResponse.json({
      ok: true,
      type: "assistant",
      message: message || "Done.",
    } satisfies ExcelChatStepResponse);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to process Excel chat step.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      } satisfies ExcelChatStepResponse,
      { status: 500 },
    );
  }
}
