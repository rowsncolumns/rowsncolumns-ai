"use client";

import type {
  AssistantToolUIProps,
  ChatModelAdapter,
  ThreadMessage,
  ThreadMessageLike,
  ToolCallMessagePartProps,
} from "@assistant-ui/react";
import type {
  ReadonlyJSONObject,
  ReadonlyJSONValue,
} from "assistant-stream/utils";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useComposer,
  useComposerRuntime,
  useAssistantInstructions,
  useAssistantRuntime,
  useMessagePartText,
  useLocalRuntime,
  useMessage,
  useAssistantToolUI,
  useThread,
  useThreadRuntime,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
  colorKeys,
  defaultSpreadsheetTheme,
  Sheet,
  SpreadsheetTheme,
  TableView,
  useNavigateToSheetRange,
  useSpreadsheetApi,
} from "@rowsncolumns/spreadsheet";
import type { CellInterface, CellXfs } from "@rowsncolumns/common-types";
import {
  addressToSheetRange,
  MAX_COLUMN_COUNT,
  MAX_ROW_COUNT,
  selectionToAddress,
  uuidString,
} from "@rowsncolumns/utils";
import {
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronsUpDown,
  Copy,
  Cpu,
  Loader2,
  Navigation,
  Pencil,
  Plus,
  RotateCcw,
  Square,
  SendHorizontal,
  Sparkles,
  Table2,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { normalizeAssistantErrorMessage } from "@/lib/chat/errors";
import { parseChatStream } from "@/lib/chat/protocol";
import { INITIAL_CREDITS, MIN_CREDITS_PER_RUN } from "@/lib/credits/pricing";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { IconButton } from "@rowsncolumns/ui";
import { useSpreadsheetState } from "@rowsncolumns/spreadsheet-state";

type WorkspaceAssistantProps = {
  prompts: string[];
  docId?: string;
  sheets?: Sheet[];
  activeSheetId?: number;
  isAdmin?: boolean;
};

/**
 * Props for the UI-only WorkspaceAssistantUI component.
 * Used when AssistantRuntimeProvider is provided at a higher level.
 */
export type WorkspaceAssistantUIProps = {
  prompts: string[];
  docId?: string;
  isAdmin?: boolean;
  onNewSession?: () => void;
  isHydratingSession: boolean;
  selectedModel: string;
  selectedModelLabel: string;
  isModelPickerOpen: boolean;
  setIsModelPickerOpen: (open: boolean) => void;
  setSelectedModel: (model: string) => void;
  reasoningEnabled: boolean;
  setReasoningEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  reasoningEnabledRef: React.MutableRefObject<boolean>;
  forceCompactHeader?: boolean;
};
type ModelOption = {
  value: string;
  label: string;
};

type ModelOptionGroup = {
  label: string;
  options: ModelOption[];
};

type AssistantChatErrorPayload = {
  error?: string;
  code?: string;
};

const MODEL_OPTION_GROUPS: ModelOptionGroup[] = [
  {
    label: "OpenAI",
    options: [
      {
        value: "gpt-5.4",
        label: "GPT-5.4",
      },
      {
        value: "gpt-5.4-mini",
        label: "GPT-5.4 Mini",
      },
      {
        value: "gpt-5.4-nano",
        label: "GPT-5.4 Nano",
      },
      {
        value: "gpt-5.2-chat-latest",
        label: "GPT-5.2 Chat",
      },
      {
        value: "gpt-5-mini",
        label: "GPT-5 Mini",
      },
      {
        value: "gpt-5-nano",
        label: "GPT-5 Nano",
      },
      {
        value: "gpt-4.1",
        label: "GPT-4.1",
      },
      {
        value: "gpt-4.1-mini",
        label: "GPT-4.1 Mini",
      },
      {
        value: "gpt-4.1-nano",
        label: "GPT-4.1 Nano",
      },
      {
        value: "o3",
        label: "o3",
      },
      {
        value: "o4-mini",
        label: "o4-mini",
      },
    ],
  },
  {
    label: "Anthropic",
    options: [
      {
        value: "claude-opus-4-6",
        label: "Claude Opus 4.6",
      },
      {
        value: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
      },
      {
        value: "claude-sonnet-4-5-20250929",
        label: "Claude Sonnet 4.5",
      },
      {
        value: "claude-opus-4-5-20251101",
        label: "Claude Opus 4.5",
      },
      {
        value: "claude-haiku-4-5-20251001",
        label: "Claude Haiku 4.5",
      },
      {
        value: "claude-opus-4-1-20250805",
        label: "Claude Opus 4.1",
      },
    ],
  },
];

const DEFAULT_MODEL =
  MODEL_OPTION_GROUPS[0]?.options[0]?.value ?? "gpt-5.2-chat-latest";

const MODEL_OPTIONS: ModelOption[] = MODEL_OPTION_GROUPS.flatMap(
  (group) => group.options,
);
const MODEL_OPTION_VALUES = new Set<string>(
  MODEL_OPTIONS.map((option) => option.value),
);
const MODEL_STORAGE_KEY = "rnc.ai.workspace-assistant.model";
const REASONING_STORAGE_KEY = "rnc.ai.workspace-assistant.reasoning-enabled";
const SKILLS_API_ENDPOINT = "/api/skills";
const CHAT_API_ENDPOINT = "/api/chat";
const CHAT_HISTORY_API_ENDPOINT = "/api/chat/history";
const INSUFFICIENT_CREDITS_ERROR_CODE = "INSUFFICIENT_CREDITS";
const OUT_OF_CREDITS_MESSAGE =
  "You've run out of credits for today. Credits reset to 30 at the next daily reset.";
const CHAT_EXTERNAL_API_BASE_URL = (
  process.env.NEXT_PUBLIC_CHAT_API_BASE_URL ?? ""
).trim();
const CHAT_EXTERNAL_API_PATH = (
  process.env.NEXT_PUBLIC_CHAT_API_PATH ?? "/chat"
).trim();
const CHAT_EXTERNAL_API_ENABLED = CHAT_EXTERNAL_API_BASE_URL.length > 0;

type PersistedThreadHistoryMessage = {
  role: "user" | "assistant" | "system";
  content:
    | string
    | Array<
        | {
            type: "text";
            text: string;
          }
        | {
            type: "reasoning";
            text: string;
          }
        | {
            type: "tool-call";
            toolCallId?: string;
            toolName: string;
            args?: Record<string, unknown>;
            result?: unknown;
            isError?: boolean;
          }
      >;
};

type AssistantSkill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

const buildExternalChatApiUrl = () => {
  const base = CHAT_EXTERNAL_API_BASE_URL.replace(/\/+$/, "");
  const path = CHAT_EXTERNAL_API_PATH.startsWith("/")
    ? CHAT_EXTERNAL_API_PATH
    : `/${CHAT_EXTERNAL_API_PATH}`;
  return `${base}${path}`;
};

const getChatRequestUrl = () => {
  if (CHAT_EXTERNAL_API_ENABLED) {
    return buildExternalChatApiUrl();
  }

  return CHAT_API_ENDPOINT;
};

const getAuthBearerToken = async () => {
  const sessionResult = await authClient.getSession();
  const sessionToken = sessionResult.data?.session?.token?.trim();
  if (sessionToken) {
    return sessionToken;
  }

  return null;
};

const requestAssistantChat = async (input: {
  threadId: string;
  docId?: string;
  message: string;
  reasoningEnabled?: boolean;
  signal: AbortSignal;
}) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (CHAT_EXTERNAL_API_ENABLED) {
    const bearerToken = await getAuthBearerToken();
    if (!bearerToken) {
      throw new Error("Your session expired. Please sign in again.");
    }
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  return fetch(getChatRequestUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      threadId: input.threadId,
      docId: input.docId,
      message: input.message,
      ...(typeof input.reasoningEnabled === "boolean"
        ? { reasoningEnabled: input.reasoningEnabled }
        : {}),
    }),
    signal: input.signal,
    cache: "no-store",
  });
};

const useThreadIdFromUrl = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialSessionId = searchParams.get("session_id")?.trim() || null;
  const [threadId, setThreadId] = React.useState(
    () => initialSessionId ?? uuidString(),
  );
  const [persistInUrl, setPersistInUrl] = React.useState(
    () => initialSessionId !== null,
  );

  React.useEffect(() => {
    const currentSessionId = searchParams.get("session_id")?.trim() || null;
    setPersistInUrl(currentSessionId !== null);
    if (!currentSessionId) {
      return;
    }

    setThreadId((previousThreadId) =>
      previousThreadId === currentSessionId
        ? previousThreadId
        : currentSessionId,
    );
  }, [searchParams]);

  const pushSessionIdToHistory = React.useCallback(
    (nextSessionId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      const currentSessionId = searchParams.get("session_id")?.trim() || null;

      if (nextSessionId === null) {
        if (!currentSessionId) {
          return;
        }
        params.delete("session_id");
      } else {
        if (currentSessionId === nextSessionId) {
          return;
        }
        params.set("session_id", nextSessionId);
      }

      const nextQuery = params.toString();
      const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
      router.push(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const markThreadStarted = React.useCallback(() => {
    pushSessionIdToHistory(threadId);
    setPersistInUrl(true);
  }, [pushSessionIdToHistory, threadId]);

  const startNewThread = React.useCallback(() => {
    const nextThreadId = uuidString();
    pushSessionIdToHistory(null);
    setThreadId(nextThreadId);
    setPersistInUrl(false);
  }, [pushSessionIdToHistory]);

  return {
    threadId,
    persistInUrl,
    markThreadStarted,
    startNewThread,
  };
};

const parseSkillFromUnknown = (value: unknown): AssistantSkill | null => {
  if (typeof value !== "object" || value === null) return null;

  const maybeSkill = value as Record<string, unknown>;
  if (typeof maybeSkill.id !== "string" || maybeSkill.id.trim().length === 0) {
    return null;
  }

  const name =
    typeof maybeSkill.name === "string" ? maybeSkill.name.trim() : "";
  const description =
    typeof maybeSkill.description === "string" ? maybeSkill.description : "";
  const instructions =
    typeof maybeSkill.instructions === "string" ? maybeSkill.instructions : "";
  const active =
    typeof maybeSkill.active === "boolean" ? maybeSkill.active : true;
  const createdAt =
    typeof maybeSkill.createdAt === "string" && maybeSkill.createdAt.trim()
      ? maybeSkill.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof maybeSkill.updatedAt === "string" && maybeSkill.updatedAt.trim()
      ? maybeSkill.updatedAt
      : createdAt;

  if (!name) {
    return null;
  }

  return {
    id: maybeSkill.id,
    name,
    description,
    instructions,
    active,
    createdAt,
    updatedAt,
  };
};

const upsertSkillPreservingOrder = (
  skills: AssistantSkill[],
  nextSkill: AssistantSkill,
) => {
  const existingIndex = skills.findIndex((skill) => skill.id === nextSkill.id);
  if (existingIndex === -1) {
    return [nextSkill, ...skills];
  }

  return skills.map((skill, index) =>
    index === existingIndex ? nextSkill : skill,
  );
};

const buildSkillsApiPath = (workspaceId?: string) => {
  const trimmedWorkspaceId = workspaceId?.trim();
  if (!trimmedWorkspaceId) {
    return SKILLS_API_ENDPOINT;
  }

  return `${SKILLS_API_ENDPOINT}?${new URLSearchParams({
    workspaceId: trimmedWorkspaceId,
  }).toString()}`;
};

const parseSkillsFromPayload = (payload: unknown): AssistantSkill[] => {
  try {
    if (typeof payload !== "object" || payload === null) return [];
    const maybePayload = payload as Record<string, unknown>;
    if (!Array.isArray(maybePayload.skills)) return [];

    return maybePayload.skills
      .map(parseSkillFromUnknown)
      .filter((skill): skill is AssistantSkill => skill !== null);
  } catch {
    return [];
  }
};

const buildSkillsInstruction = (skills: AssistantSkill[]) => {
  const blocks = skills.map((skill, index) => {
    const description = skill.description.trim();
    const instructions = skill.instructions.trim();

    return [
      `Skill ${index + 1}: ${skill.name}`,
      description ? `Description: ${description}` : null,
      instructions ? `Instructions:\n${instructions}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });
  const brandingRule = [
    "Branding guidelines are mandatory constraints for this conversation.",
    "Always apply branding rules when generating copy, structure, naming, colors, and style-related output.",
    "When producing spreadsheet models/reports/tables (for example DCF, LBO, budget, dashboards), apply a branding pass before completion.",
    "Branding pass means: align labels and wording with brand voice, and apply brand-aligned formatting/colors where formatting tools are available.",
    "Do not treat branding as optional unless the user explicitly asks for raw/unformatted output.",
    "Only deviate if the user explicitly asks to override a branding rule.",
    "",
  ].join("\n");

  return [
    "Branding and style consistency rules are always in effect.",
    brandingRule,
    ...(skills.length > 0
      ? [
          "User-defined custom skills are available for this conversation.",
          "Apply any relevant active skills when planning or executing responses.",
          "If multiple skills conflict, prefer the most specific skill and continue; ask only if conflict blocks safe execution.",
          "",
        ]
      : []),
    ...blocks,
  ].join("\n");
};

type StreamingTextPart = {
  type: "text" | "reasoning";
  text: string;
};

type StreamingToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  argsText: string;
  result?: unknown;
};

type StreamingContentPart = StreamingTextPart | StreamingToolCallPart;

const TOOL_INPUT_UNAVAILABLE_MARKER = "__rnc_tool_input_unavailable__";

const createUnavailableToolArgs = () => ({
  [TOOL_INPUT_UNAVAILABLE_MARKER]: true,
});

const isUnavailableToolArgs = (value: unknown) =>
  isRecord(value) && value[TOOL_INPUT_UNAVAILABLE_MARKER] === true;

const appendStreamingDelta = (
  parts: StreamingContentPart[],
  type: StreamingTextPart["type"],
  delta: string,
) => {
  if (!delta) return;
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.type === type) {
    lastPart.text += delta;
    return;
  }

  parts.push({ type, text: delta });
};

const upsertStreamingToolCall = (
  parts: StreamingContentPart[],
  indexByToolCallId: Map<string, number>,
  toolCallId: string,
  toolName: string,
  args: unknown,
) => {
  const existingIndex = indexByToolCallId.get(toolCallId);
  if (existingIndex === undefined) {
    const nextIndex =
      parts.push({
        type: "tool-call",
        toolCallId,
        toolName,
        args,
        argsText: JSON.stringify(args, null, 2),
      }) - 1;
    indexByToolCallId.set(toolCallId, nextIndex);
    return;
  }

  const existingPart = parts[existingIndex];
  if (!existingPart || existingPart.type !== "tool-call") {
    return;
  }

  parts[existingIndex] = {
    ...existingPart,
    toolName,
    args,
    argsText: JSON.stringify(args, null, 2),
  };
};

const stringifyUnknown = (value: unknown) => {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const normalizeStreamingToolResult = (result: unknown, isError: boolean) => {
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

const findLatestPendingToolCallIndexByName = (
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

const setStreamingToolResult = (
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
    const nextIndex =
      parts.push({
        type: "tool-call",
        toolCallId,
        toolName,
        args: args ?? createUnavailableToolArgs(),
        argsText: JSON.stringify(args ?? createUnavailableToolArgs(), null, 2),
        result: normalizedResult,
      }) - 1;
    indexByToolCallId.set(toolCallId, nextIndex);
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

const snapshotStreamingContent = (parts: StreamingContentPart[]) =>
  parts.map((part) => {
    if (part.type !== "tool-call") {
      return { ...part };
    }

    return {
      ...part,
      args: isRecord(part.args)
        ? { ...part.args }
        : Array.isArray(part.args)
          ? [...part.args]
          : part.args,
    };
  }) as any[];

const hasTextContentParts = (parts: StreamingContentPart[]) =>
  parts.some((part) => part.type === "text" && part.text.trim().length > 0);

const getFallbackAssistantText = (message?: string) =>
  message?.trim() || "I do not have a response yet.";

const buildCompletionContent = (
  parts: StreamingContentPart[],
  fallbackMessage?: string,
) => {
  const content = snapshotStreamingContent(parts);
  if (hasTextContentParts(parts)) {
    return content;
  }

  // If tools ran but no visible text was streamed, preserve the final
  // completion message as a text part so acknowledgement text is not lost.
  return [
    ...content,
    {
      type: "text" as const,
      text: getFallbackAssistantText(fallbackMessage),
    },
  ];
};

const buildStreamingYield = (
  parts: StreamingContentPart[],
  threadId: string,
  status?: { type: "complete"; reason: "stop" },
  fallbackMessage?: string,
) => ({
  content: status
    ? buildCompletionContent(parts, fallbackMessage)
    : snapshotStreamingContent(parts),
  ...(status ? { status } : {}),
  metadata: {
    custom: {
      threadId,
    },
  },
});

async function* streamAssistantResponse(
  stream: ReadableStream<Uint8Array>,
  threadId: string,
) {
  // Single event-to-UI pipeline used by both assistant runtime entry points.
  const streamingParts: StreamingContentPart[] = [];
  const toolPartIndexById = new Map<string, number>();

  for await (const event of parseChatStream(stream)) {
    if (event.type === "reasoning.start") {
      yield buildStreamingYield(streamingParts, threadId);
      continue;
    }

    if (event.type === "reasoning.delta") {
      appendStreamingDelta(streamingParts, "reasoning", event.delta);
      yield buildStreamingYield(streamingParts, threadId);
      continue;
    }

    if (event.type === "message.delta") {
      appendStreamingDelta(streamingParts, "text", event.delta);
      yield buildStreamingYield(streamingParts, threadId);
      continue;
    }

    if (event.type === "tool.call") {
      const toolCallId = event.toolCallId ?? event.toolName;
      upsertStreamingToolCall(
        streamingParts,
        toolPartIndexById,
        toolCallId,
        event.toolName,
        event.args ?? {},
      );
      yield buildStreamingYield(streamingParts, threadId);
      continue;
    }

    if (event.type === "tool.result") {
      const toolCallId = event.toolCallId ?? event.toolName;
      setStreamingToolResult(
        streamingParts,
        toolPartIndexById,
        toolCallId,
        event.toolName,
        event.result,
        event.args,
        event.isError === true,
      );
      yield buildStreamingYield(streamingParts, threadId);
      continue;
    }

    if (event.type === "message.complete") {
      yield buildStreamingYield(
        streamingParts,
        threadId,
        { type: "complete", reason: "stop" },
        event.message,
      );
      return;
    }

    if (event.type === "error") {
      const errorMessage = normalizeAssistantErrorMessage(
        event.error ?? "",
        "Assistant request failed.",
      );
      appendStreamingDelta(streamingParts, "text", `\n\n${errorMessage}`);
      yield buildStreamingYield(
        streamingParts,
        threadId,
        { type: "complete", reason: "stop" },
        errorMessage,
      );
      return;
    }
  }

  yield buildStreamingYield(streamingParts, threadId, {
    type: "complete",
    reason: "stop",
  });
}

const isAbortError = (error: unknown) =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error && error.name === "AbortError");

const normalizeAssistantClientError = (error: unknown) => {
  if (error instanceof Error) {
    if (error.message.toLowerCase().includes("unauthorized")) {
      return "Your session expired. Please sign in again.";
    }

    if (error.message.trim()) {
      return normalizeAssistantErrorMessage(
        error.message,
        "Assistant request failed.",
      );
    }
  }

  return "Unable to reach the assistant service. Please retry.";
};

const getAssistantRequestErrorMessage = (
  status: number,
  payload: AssistantChatErrorPayload | null,
) => {
  if (status === 402 || payload?.code === INSUFFICIENT_CREDITS_ERROR_CODE) {
    return OUT_OF_CREDITS_MESSAGE;
  }

  if (typeof payload?.error === "string" && payload.error.trim().length > 0) {
    return normalizeAssistantErrorMessage(payload.error, "Assistant request failed.");
  }

  return "Assistant request failed.";
};

const buildTerminalAssistantMessage = (text: string) => ({
  content: [{ type: "text" as const, text }],
  status: { type: "complete" as const, reason: "stop" as const },
});

const parsePersistedThreadHistoryContentPart = (
  value: unknown,
  index: number,
) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const part = value as {
    type?: unknown;
    text?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    args?: unknown;
    result?: unknown;
    isError?: unknown;
  };

  if (part.type === "text") {
    if (typeof part.text !== "string" || part.text.trim().length === 0) {
      return null;
    }

    return {
      type: "text" as const,
      text: part.text,
    };
  }

  if (part.type === "reasoning") {
    if (typeof part.text !== "string" || part.text.trim().length === 0) {
      return null;
    }

    return {
      type: "reasoning" as const,
      text: part.text,
    };
  }

  if (part.type === "tool-call") {
    if (typeof part.toolName !== "string" || part.toolName.trim().length === 0) {
      return null;
    }

    const toolCallId =
      typeof part.toolCallId === "string" && part.toolCallId.trim().length > 0
        ? part.toolCallId
        : `${part.toolName}:${index}`;
    const normalizedArgs = toReadonlyJsonValue(part.args);
    const args =
      normalizedArgs &&
      typeof normalizedArgs === "object" &&
      !Array.isArray(normalizedArgs)
        ? (normalizedArgs as ReadonlyJSONObject)
        : undefined;

    return {
      type: "tool-call" as const,
      toolCallId,
      toolName: part.toolName,
      ...(args ? { args } : {}),
      ...(part.result !== undefined ? { result: part.result } : {}),
      ...(typeof part.isError === "boolean" ? { isError: part.isError } : {}),
    };
  }

  return null;
};

const toReadonlyJsonValue = (value: unknown): ReadonlyJSONValue | undefined => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => toReadonlyJsonValue(item))
      .filter((item): item is ReadonlyJSONValue => item !== undefined);
  }

  if (value && typeof value === "object") {
    const record: Record<string, ReadonlyJSONValue> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedValue = toReadonlyJsonValue(nestedValue);
      if (normalizedValue === undefined) {
        continue;
      }
      record[key] = normalizedValue;
    }
    return record;
  }

  return undefined;
};

const parsePersistedThreadHistoryMessage = (
  value: unknown,
): ThreadMessageLike | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeMessage = value as {
    role?: unknown;
    content?: unknown;
  };
  const role = maybeMessage.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return null;
  }

  if (typeof maybeMessage.content === "string") {
    if (!maybeMessage.content.trim()) {
      return null;
    }

    return {
      role,
      content: maybeMessage.content,
    };
  }

  if (!Array.isArray(maybeMessage.content)) {
    return null;
  }

  const contentParts = maybeMessage.content
    .map((part, index) => parsePersistedThreadHistoryContentPart(part, index))
    .filter((part): part is NonNullable<typeof part> => part !== null);
  if (contentParts.length === 0) {
    return null;
  }

  return {
    role,
    content: contentParts,
  };
};

const parsePersistedThreadHistoryPayload = (
  value: unknown,
): ThreadMessageLike[] => {
  if (!value || typeof value !== "object") {
    return [];
  }

  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map(parsePersistedThreadHistoryMessage)
    .filter((message): message is ThreadMessageLike => message !== null);
};

const fetchPersistedThreadHistory = async (
  threadId: string,
  signal: AbortSignal,
) => {
  const response = await fetch(
    `${CHAT_HISTORY_API_ENDPOINT}?threadId=${encodeURIComponent(threadId)}`,
    {
      method: "GET",
      cache: "no-store",
      signal,
    },
  );

  if (!response.ok) {
    return [] as ThreadMessageLike[];
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  return parsePersistedThreadHistoryPayload(payload);
};

const useHydratePersistedThreadHistory = ({
  runtime,
  threadId,
  enabled = true,
}: {
  runtime: ReturnType<typeof useLocalRuntime>;
  threadId: string;
  enabled?: boolean;
}) => {
  const hydratedThreadIdRef = React.useRef<string | null>(null);
  const [isHydratingSession, setIsHydratingSession] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) {
      setIsHydratingSession(false);
      return;
    }

    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) {
      setIsHydratingSession(false);
      return;
    }

    if (hydratedThreadIdRef.current === normalizedThreadId) {
      setIsHydratingSession(false);
      return;
    }

    hydratedThreadIdRef.current = normalizedThreadId;

    const controller = new AbortController();
    const currentThreadState = runtime.thread.getState();
    if (currentThreadState.messages.length > 0) {
      setIsHydratingSession(false);
      return;
    }

    setIsHydratingSession(true);

    const hydrate = async () => {
      try {
        const history = await fetchPersistedThreadHistory(
          normalizedThreadId,
          controller.signal,
        );
        if (controller.signal.aborted) {
          return;
        }

        const threadState = runtime.thread.getState();
        if (threadState.messages.length > 0) {
          return;
        }

        runtime.thread.reset(history);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        console.error("[assistant] Failed to hydrate thread history", error);
      } finally {
        if (!controller.signal.aborted) {
          setIsHydratingSession(false);
        }
      }
    };

    void hydrate();

    return () => {
      controller.abort();
      setIsHydratingSession(false);
    };
  }, [enabled, runtime, threadId]);

  return isHydratingSession;
};

/**
 * Hook to create the assistant runtime with model selection state.
 * This can be used at a higher level to wrap multiple components with AssistantRuntimeProvider.
 */
export function useSpreadsheetAssistantRuntime({ docId }: { docId?: string }) {
  const { threadId, persistInUrl, markThreadStarted, startNewThread } =
    useThreadIdFromUrl();

  const [selectedModel, setSelectedModel] =
    React.useState<string>(DEFAULT_MODEL);
  const [isModelPickerOpen, setIsModelPickerOpen] = React.useState(false);
  const [reasoningEnabled, setReasoningEnabled] = React.useState(false);
  const selectedModelRef = React.useRef(selectedModel);
  const reasoningEnabledRef = React.useRef(reasoningEnabled);
  const docIdRef = React.useRef(docId);

  React.useEffect(() => {
    docIdRef.current = docId;
  }, [docId]);

  React.useEffect(() => {
    try {
      const storedModel = window.localStorage
        .getItem(MODEL_STORAGE_KEY)
        ?.trim();
      if (storedModel && MODEL_OPTION_VALUES.has(storedModel)) {
        setSelectedModel(storedModel);
        selectedModelRef.current = storedModel;
      }
    } catch {
      // Ignore localStorage read failures
    }
  }, []);

  React.useEffect(() => {
    try {
      const storedReasoningEnabled = window.localStorage
        .getItem(REASONING_STORAGE_KEY)
        ?.trim()
        .toLowerCase();
      if (storedReasoningEnabled === "true" || storedReasoningEnabled === "1") {
        setReasoningEnabled(true);
        reasoningEnabledRef.current = true;
      }
      if (
        storedReasoningEnabled === "false" ||
        storedReasoningEnabled === "0"
      ) {
        setReasoningEnabled(false);
        reasoningEnabledRef.current = false;
      }
    } catch {
      // Ignore localStorage read failures
    }
  }, []);

  React.useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  React.useEffect(() => {
    reasoningEnabledRef.current = reasoningEnabled;
  }, [reasoningEnabled]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
    } catch {
      // Ignore localStorage write failures
    }
  }, [selectedModel]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(
        REASONING_STORAGE_KEY,
        String(reasoningEnabled),
      );
    } catch {
      // Ignore localStorage write failures
    }
  }, [reasoningEnabled]);

  const selectedModelLabel =
    MODEL_OPTIONS.find((option) => option.value === selectedModel)?.label ??
    selectedModel;

  const handleSelectModel = React.useCallback((model: string) => {
    setSelectedModel(model);
    selectedModelRef.current = model;
    setIsModelPickerOpen(false);
  }, []);

  const chatAdapter = React.useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const latestUserMessage = [...messages]
          .reverse()
          .find((message) => message.role === "user");
        const message = getMessageText(latestUserMessage);

        if (!message) {
          yield {
            content: [
              { type: "text", text: "I need a prompt before I can help." },
            ],
            status: { type: "complete", reason: "stop" },
          };
          return;
        }

        try {
          markThreadStarted();
          const response = await requestAssistantChat({
            threadId,
            docId: docIdRef.current,
            message,
            reasoningEnabled: reasoningEnabledRef.current,
            signal: abortSignal,
          });

          if (!response.ok) {
            const payload = (await response
              .json()
              .catch(() => null)) as AssistantChatErrorPayload | null;
            throw new Error(
              getAssistantRequestErrorMessage(response.status, payload),
            );
          }

          if (!response.body) {
            throw new Error("Assistant stream is unavailable.");
          }

          yield* streamAssistantResponse(response.body, threadId);
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }

          yield buildTerminalAssistantMessage(
            normalizeAssistantClientError(error),
          );
        }
      },
    }),
    [markThreadStarted, threadId],
  );

  const runtime = useLocalRuntime(chatAdapter, { maxSteps: 1 });
  const isHydratingSession = useHydratePersistedThreadHistory({
    runtime,
    threadId,
    enabled: persistInUrl,
  });

  return {
    runtime,
    threadId,
    isHydratingSession,
    startNewThread,
    selectedModel,
    setSelectedModel: handleSelectModel,
    isModelPickerOpen,
    setIsModelPickerOpen,
    reasoningEnabled,
    setReasoningEnabled,
    reasoningEnabledRef,
    selectedModelLabel,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const deepParseJsonValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return deepParseJsonValue(parsed);
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map(deepParseJsonValue);
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepParseJsonValue(val);
    }
    return result;
  }

  return value;
};

const getRangeFromParsedToolArgs = (value: unknown): string | null => {
  if (!isRecord(value)) return null;

  if (typeof value.range === "string" && value.range.trim().length > 0) {
    return value.range;
  }

  if (isRecord(value.input)) {
    const nestedRange = value.input.range;
    if (typeof nestedRange === "string" && nestedRange.trim().length > 0) {
      return nestedRange;
    }
  }

  return null;
};

const getSheetIdFromParsedToolArgs = (value: unknown): number | null => {
  if (!isRecord(value)) return null;

  if (typeof value.sheetId === "number" && Number.isFinite(value.sheetId)) {
    return value.sheetId;
  }

  if (isRecord(value.input)) {
    const nestedSheetId = value.input.sheetId;
    if (typeof nestedSheetId === "number" && Number.isFinite(nestedSheetId)) {
      return nestedSheetId;
    }
  }

  return null;
};

const getCreatedSheetIdFromToolResult = (value: unknown): number | null => {
  if (!isRecord(value)) return null;

  if (typeof value.sheetId === "number" && Number.isFinite(value.sheetId)) {
    return value.sheetId;
  }

  if (
    isRecord(value.sheet) &&
    typeof value.sheet.sheetId === "number" &&
    Number.isFinite(value.sheet.sheetId)
  ) {
    return value.sheet.sheetId;
  }

  return null;
};

type ParsedToolResult = {
  success?: boolean;
  error?: string;
  range?: string;
  [key: string]: unknown;
};

const extractParsedToolResult = (result: unknown): ParsedToolResult | null => {
  if (!result) return null;

  // Handle LangChain ToolMessage object: result.kwargs.content
  if (isRecord(result)) {
    const r = result;
    if (r.kwargs && typeof r.kwargs === "object") {
      const kwargs = r.kwargs as Record<string, unknown>;
      if (typeof kwargs.content === "string") {
        try {
          const parsed = JSON.parse(kwargs.content);
          return isRecord(parsed) ? (parsed as ParsedToolResult) : null;
        } catch {
          return { error: kwargs.content };
        }
      }
    }
    // Direct object with success property
    if ("success" in r) {
      return r as ParsedToolResult;
    }
  }

  // Handle string result
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return isRecord(parsed) ? (parsed as ParsedToolResult) : null;
    } catch {
      return null;
    }
  }

  return null;
};

const getMessageText = (message: ThreadMessage | undefined) => {
  if (!message) {
    return "";
  }

  return message.content
    .map((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return part.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
};

type ToolCopy = {
  running: string;
  success: string;
  failed: string;
};

const TOOL_UI_COPY: Record<string, ToolCopy> = {
  spreadsheet_changeBatch: {
    running: "Updating spreadsheet data",
    success: "Updated spreadsheet data",
    failed: "Failed to update spreadsheet data",
  },
  spreadsheet_createSheet: {
    running: "Creating sheet",
    success: "Created sheet",
    failed: "Failed to create sheet",
  },
  spreadsheet_updateSheet: {
    running: "Updating sheet settings",
    success: "Updated sheet settings",
    failed: "Failed to update sheet settings",
  },
  spreadsheet_formatRange: {
    running: "Applying formatting",
    success: "Applied formatting",
    failed: "Failed to apply formatting",
  },
  spreadsheet_insertRows: {
    running: "Inserting rows",
    success: "Inserted rows",
    failed: "Failed to insert rows",
  },
  spreadsheet_insertColumns: {
    running: "Inserting columns",
    success: "Inserted columns",
    failed: "Failed to insert columns",
  },
  spreadsheet_queryRange: {
    running: "Reading spreadsheet data",
    success: "Read spreadsheet data",
    failed: "Failed to read spreadsheet data",
  },
  spreadsheet_setIterativeMode: {
    running: "Updating iterative mode",
    success: "Updated iterative mode",
    failed: "Failed to update iterative mode",
  },
  spreadsheet_readDocument: {
    running: "Reading document",
    success: "Read document",
    failed: "Failed to read document",
  },
  spreadsheet_setRowColDimensions: {
    running: "Setting row/column dimensions",
    success: "Set row/column dimensions",
    failed: "Failed to set row/column dimensions",
  },
  spreadsheet_duplicateSheet: {
    running: "Duplicating sheet",
    success: "Duplicated sheet",
    failed: "Failed to duplicate sheet",
  },
  spreadsheet_deleteCells: {
    running: "Deleting cells",
    success: "Deleted cells",
    failed: "Failed to delete cells",
  },
  spreadsheet_clearFormatting: {
    running: "Clearing formatting",
    success: "Cleared formatting",
    failed: "Failed to clear formatting",
  },
  spreadsheet_applyFill: {
    running: "Applying fill",
    success: "Applied fill",
    failed: "Failed to apply fill",
  },
  spreadsheet_insertNote: {
    running: "Inserting note",
    success: "Inserted note",
    failed: "Failed to insert note",
  },
  spreadsheet_deleteRows: {
    running: "Deleting rows",
    success: "Deleted rows",
    failed: "Failed to delete rows",
  },
  spreadsheet_deleteColumns: {
    running: "Deleting columns",
    success: "Deleted columns",
    failed: "Failed to delete columns",
  },
};

const formatToolNameFallback = (toolName: string) =>
  toolName
    .replace(/^spreadsheet_/, "")
    .replace(/_/g, " ")
    .trim();

const getToolCopy = (toolName: string): ToolCopy => {
  const mapped = TOOL_UI_COPY[toolName];
  if (mapped) {
    return mapped;
  }

  const fallbackName = formatToolNameFallback(toolName) || toolName;
  return {
    running: `Running ${fallbackName}`,
    success: `Completed ${fallbackName}`,
    failed: `Failed ${fallbackName}`,
  };
};

function ReasoningBlock({
  children,
  forceOpen,
}: {
  children: React.ReactNode;
  forceOpen: boolean;
}) {
  const [isOpen, setIsOpen] = React.useState(forceOpen);

  React.useEffect(() => {
    if (forceOpen) {
      setIsOpen(true);
      return;
    }

    setIsOpen(false);
  }, [forceOpen]);

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Trigger className="flex w-full items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-left text-xs font-medium text-purple-700 transition hover:bg-purple-100">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Thinking</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse data-[state=open]:animate-expand">
        {children as any}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

function MarkdownText() {
  return <MarkdownTextPrimitive remarkPlugins={MARKDOWN_REMARK_PLUGINS} />;
}

function AssistantTextPart() {
  const textPart = useMessagePartText();
  if (!textPart.text?.trim()) return null;

  return (
    <Card className="rnc-assistant-bubble-ai w-fit max-w-[92%] border-black/10 bg-[#fff7f1]">
      <CardContent className="py-2 px-3">
        <div className="prose text-sm text-foreground overflow-hidden">
          <MarkdownText />
        </div>
      </CardContent>
    </Card>
  );
}

function ToolCallDisplay({
  toolName,
  args,
  result,
}: {
  toolName: string;
  args: unknown;
  result?: unknown;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [copiedTab, setCopiedTab] = React.useState<"input" | "output" | null>(
    null,
  );
  const hasResult = result !== undefined;
  const navigateToSheetRange = useNavigateToSheetRange();

  const handleCopy = React.useCallback(
    async (content: string, tab: "input" | "output") => {
      try {
        await navigator.clipboard.writeText(content);
        setCopiedTab(tab);
        setTimeout(() => setCopiedTab(null), 2000);
      } catch {
        // Ignore clipboard errors
      }
    },
    [],
  );

  // Extract the actual content from various result formats
  const extractedResult = React.useMemo(
    () => extractParsedToolResult(result),
    [result],
  );

  const isParsedError =
    extractedResult?.success === false ||
    (typeof extractedResult?.error === "string" &&
      extractedResult.error.trim().length > 0 &&
      extractedResult.success !== true);
  const isError = isParsedError;
  const errorMessage = extractedResult?.error;
  const isComplete = hasResult && !isError;
  const isRunning = !hasResult;
  const toolCopy = React.useMemo(() => getToolCopy(toolName), [toolName]);
  const titleText = isRunning
    ? toolCopy.running
    : isError
      ? toolCopy.failed
      : toolCopy.success;
  const parsedArgs = React.useMemo(() => deepParseJsonValue(args), [args]);
  const rangeFromArgs = getRangeFromParsedToolArgs(parsedArgs);
  const rangeFromResult =
    typeof extractedResult?.range === "string" ? extractedResult.range : null;
  const sheetIdFromArgs = getSheetIdFromParsedToolArgs(parsedArgs);
  const sheetIdFromResult = getSheetIdFromParsedToolArgs(extractedResult);
  const sheetRange = React.useMemo(() => {
    const rangeForNavigation = rangeFromArgs || rangeFromResult;
    const sheetId = sheetIdFromArgs ?? sheetIdFromResult;

    if (!rangeForNavigation || sheetId === null) {
      return null;
    }

    return addressToSheetRange(rangeForNavigation, sheetId) ?? null;
  }, [rangeFromArgs, rangeFromResult, sheetIdFromArgs, sheetIdFromResult]);

  const canNavigateToRange = Boolean(navigateToSheetRange && sheetRange);

  const navigateToRange = React.useCallback(() => {
    if (!navigateToSheetRange || !sheetRange) {
      return;
    }

    navigateToSheetRange(sheetRange, {
      allowSelection: false,
      enableFlash: true,
    });
  }, [navigateToSheetRange, sheetRange]);

  const handleNavigateIconClick = React.useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      navigateToRange();
    },
    [navigateToRange],
  );

  const handleNavigateIconKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLSpanElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToRange();
    },
    [navigateToRange],
  );

  const range =
    rangeFromArgs ||
    rangeFromResult ||
    (toolName === "spreadsheet_changeBatch" ? "cells" : "");
  const explanation = React.useMemo(() => {
    if (!isRecord(parsedArgs)) return null;

    const parsedInput = parsedArgs.input;
    if (
      isRecord(parsedInput) &&
      typeof parsedInput.explanation === "string" &&
      parsedInput.explanation.trim().length > 0
    ) {
      return parsedInput.explanation.trim();
    }

    if (
      typeof parsedArgs.explanation === "string" &&
      parsedArgs.explanation.trim().length > 0
    ) {
      return parsedArgs.explanation.trim();
    }

    return null;
  }, [parsedArgs]);
  const formattedArgs = React.useMemo(() => {
    if (isUnavailableToolArgs(parsedArgs)) {
      return "Input unavailable: tool call failed before execution and runtime did not emit tool arguments.";
    }

    try {
      const serialized = JSON.stringify(parsedArgs, null, 2);
      return typeof serialized === "string" ? serialized : String(args);
    } catch {
      return String(args);
    }
  }, [args, parsedArgs]);
  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition",
          isRunning
            ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
            : isError
              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100",
        )}
      >
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isError ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        <Table2 className="h-3.5 w-3.5" />
        <div className="min-w-0 flex-1">
          <div>
            {titleText}
            {range && (
              <span className="text-[10px] opacity-70 ml-1">({range})</span>
            )}
            . {explanation}
          </div>
        </div>

        {isComplete && canNavigateToRange && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Navigate to affected range"
            title="Navigate to affected range"
            onClick={handleNavigateIconClick}
            onKeyDown={handleNavigateIconKeyDown}
            className="ml-auto shrink-0 rounded p-1 cursor-pointer text-green-600 hover:bg-green-100"
          >
            <Navigation className="h-3.5 w-3.5" />
          </span>
        )}

        <ChevronDown
          className={cn(
            "ml-1 h-3.5 w-3.5 shrink-0 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse data-[state=open]:animate-expand">
        {isError && (
          <div className="mt-1 rounded border border-red-200 bg-red-100 p-2 text-red-800 text-xs">
            <div className="font-medium">Error</div>
            <div className="mt-1 font-mono text-[11px]">
              {errorMessage || "Unknown error"}
            </div>
          </div>
        )}
        <Tabs defaultValue="input" className="mt-1">
          <TabsList className="h-7 gap-1 bg-transparent p-0">
            <TabsTrigger
              value="input"
              className={cn(
                "h-6 rounded px-2 py-0.5 text-[10px] font-medium",
                isRunning
                  ? "data-[state=active]:bg-blue-100 data-[state=active]:text-blue-700"
                  : isError
                    ? "data-[state=active]:bg-red-100 data-[state=active]:text-red-700"
                    : "data-[state=active]:bg-green-100 data-[state=active]:text-green-700",
              )}
            >
              Input
            </TabsTrigger>
            <TabsTrigger
              value="output"
              className={cn(
                "h-6 rounded px-2 py-0.5 text-[10px] font-medium",
                isRunning
                  ? "data-[state=active]:bg-blue-100 data-[state=active]:text-blue-700"
                  : isError
                    ? "data-[state=active]:bg-red-100 data-[state=active]:text-red-700"
                    : "data-[state=active]:bg-green-100 data-[state=active]:text-green-700",
              )}
            >
              Output
            </TabsTrigger>
          </TabsList>
          <TabsContent value="input" className="mt-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => handleCopy(formattedArgs, "input")}
                className={cn(
                  "absolute right-1 top-1 rounded p-1 transition-colors",
                  isRunning
                    ? "text-blue-600 hover:bg-blue-100"
                    : isError
                      ? "text-red-600 hover:bg-red-100"
                      : "text-green-600 hover:bg-green-100",
                )}
                title="Copy to clipboard"
              >
                {copiedTab === "input" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <pre
                className={cn(
                  "max-h-64 overflow-y-auto overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-md p-2 pr-8 font-mono text-[11px] leading-relaxed",
                  isRunning
                    ? "bg-blue-50/70 text-blue-900"
                    : isError
                      ? "bg-red-50/70 text-red-900"
                      : "bg-green-50/70 text-green-900",
                )}
              >
                {formattedArgs}
              </pre>
            </div>
          </TabsContent>
          <TabsContent value="output" className="mt-1.5">
            <div className="relative">
              {hasResult && (
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      JSON.stringify(extractedResult, null, 2),
                      "output",
                    )
                  }
                  className={cn(
                    "absolute right-1 top-1 rounded p-1 transition-colors",
                    isError
                      ? "text-red-600 hover:bg-red-100"
                      : "text-green-600 hover:bg-green-100",
                  )}
                  title="Copy to clipboard"
                >
                  {copiedTab === "output" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {hasResult ? (
                <pre
                  className={cn(
                    "max-h-64 overflow-y-auto overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-md p-2 pr-8 font-mono text-[11px] leading-relaxed",
                    isError
                      ? "bg-red-50/70 text-red-900"
                      : "bg-green-50/70 text-green-900",
                  )}
                >
                  {JSON.stringify(extractedResult, null, 2)}
                </pre>
              ) : (
                <div className="rounded-md bg-blue-50/70 p-2 text-[11px] text-blue-600 italic">
                  Waiting for result...
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function SpreadsheetCreateSheetSideEffect({ result }: { result?: unknown }) {
  const spreadsheetApi = useSpreadsheetApi();
  const hasResult = result !== undefined;
  const parsedResult = React.useMemo(
    () => extractParsedToolResult(result),
    [result],
  );
  const createdSheetId = React.useMemo(
    () => getCreatedSheetIdFromToolResult(parsedResult),
    [parsedResult],
  );
  const hasResultRef = React.useRef(hasResult);

  React.useEffect(() => {
    const hadResult = hasResultRef.current;
    hasResultRef.current = hasResult;

    if (hadResult || !hasResult || createdSheetId === null) {
      return;
    }

    spreadsheetApi?.setActiveSheet(createdSheetId);
  }, [createdSheetId, hasResult, spreadsheetApi]);

  return null;
}

const SPREADSHEET_TOOL_NAMES = [
  "spreadsheet_changeBatch",
  "spreadsheet_createSheet",
  "spreadsheet_updateSheet",
  "spreadsheet_formatRange",
  "spreadsheet_insertRows",
  "spreadsheet_insertColumns",
  "spreadsheet_queryRange",
  "spreadsheet_setIterativeMode",
  "spreadsheet_readDocument",
  "spreadsheet_setRowColDimensions",
  "spreadsheet_duplicateSheet",
  "spreadsheet_deleteCells",
  "spreadsheet_clearFormatting",
  "spreadsheet_applyFill",
  "spreadsheet_insertNote",
  "spreadsheet_deleteRows",
  "spreadsheet_deleteColumns",
] as const;

function SpreadsheetToolUIRegistration({
  toolName,
}: {
  toolName: (typeof SPREADSHEET_TOOL_NAMES)[number];
}) {
  const toolUI = React.useMemo<
    AssistantToolUIProps<Record<string, any>, unknown>
  >(
    () => ({
      toolName,
      render(
        toolPartProps: ToolCallMessagePartProps<Record<string, any>, unknown>,
      ) {
        const { toolName: renderedToolName, args, result } = toolPartProps;

        return (
          <div className="w-full maxx-w-md">
            {renderedToolName === "spreadsheet_createSheet" && (
              <SpreadsheetCreateSheetSideEffect result={result} />
            )}
            <ToolCallDisplay
              toolName={renderedToolName}
              args={args}
              result={result}
            />
          </div>
        );
      },
    }),
    [toolName],
  );

  useAssistantToolUI(toolUI);
  return null;
}

function SpreadsheetToolUIRegistry() {
  return SPREADSHEET_TOOL_NAMES.map((toolName) => (
    <SpreadsheetToolUIRegistration key={toolName} toolName={toolName} />
  ));
}

function AssistantMessage() {
  const { isAdmin } = React.useContext(AssistantDebugAccessContext);
  const role = useMessage((message) => message.role);
  const userMessageText = useMessage((message) =>
    message.role !== "user"
      ? ""
      : message.content
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("")
          .trim(),
  );
  const isMessageRunning = useAuiState(
    ({ message }) => message.status?.type === "running",
  );
  const isLastMessage = useAuiState(({ message }) => message.isLast);
  const isThreadRunning = useThread((thread) => thread.isRunning);
  const isComplete = useMessage(
    (message) => message.status?.type === "complete",
  );
  const hasAnyVisibleReasoning = useAuiState(({ message }) =>
    message.content.some(
      (part) =>
        part.type === "reasoning" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0,
    ),
  );
  const hasAnyToolCall = useAuiState(({ message }) =>
    message.content.some((part) => part.type === "tool-call"),
  );
  const hasAnyVisibleText = useAuiState(({ message }) =>
    message.content.some(
      (part) =>
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0,
    ),
  );
  const threadId = useMessage(
    (message) =>
      (message.metadata?.custom as { threadId?: string } | undefined)?.threadId,
  );
  const debugUrl = React.useMemo(() => {
    if (!threadId) return null;
    const orgId = process.env.NEXT_PUBLIC_LANGCHAIN_ORG_ID;
    const projectId = process.env.NEXT_PUBLIC_LANGCHAIN_PROJECT_ID;
    if (!orgId || !projectId) return null;
    return `https://smith.langchain.com/o/${orgId}/projects/p/${projectId}/t/${threadId}`;
  }, [threadId]);
  const showTypingIndicatorBeforeText =
    role === "assistant" &&
    isLastMessage &&
    isThreadRunning &&
    !hasAnyVisibleReasoning &&
    !hasAnyToolCall &&
    !hasAnyVisibleText;
  const showRunningLoadingSpinner =
    role === "assistant" &&
    isLastMessage &&
    isThreadRunning &&
    !showTypingIndicatorBeforeText &&
    (hasAnyVisibleReasoning || hasAnyToolCall || hasAnyVisibleText);
  const showDebugIcon =
    (process.env.NODE_ENV !== "production" || isAdmin) &&
    role === "assistant" &&
    debugUrl &&
    !isMessageRunning;
  const [isUserCopySuccess, setIsUserCopySuccess] = React.useState(false);
  const handleCopyUserMessage = React.useCallback(async () => {
    if (!userMessageText) return;
    try {
      await navigator.clipboard.writeText(userMessageText);
      setIsUserCopySuccess(true);
      setTimeout(() => setIsUserCopySuccess(false), 1500);
    } catch {
      // Ignore clipboard failures
    }
  }, [userMessageText]);

  return (
    <MessagePrimitive.Root
      className={
        role === "user" ? "ml-8 flex justify-end" : "mr-8 flex justify-start"
      }
    >
      <div
        className={cn(
          "flex w-full flex-col gap-2",
          role === "user" ? "items-end" : "",
        )}
      >
        {role === "assistant" &&
          (hasAnyVisibleReasoning || hasAnyVisibleText || hasAnyToolCall) && (
            <MessagePrimitive.Content
              components={{
                Text: AssistantTextPart,
                Reasoning: () => (
                  <div className="mt-2 rounded-lg border border-purple-100 bg-purple-50/50 p-3 text-xs text-purple-900/80">
                    <MarkdownText />
                  </div>
                ),
                ReasoningGroup: ({ children }: React.PropsWithChildren) => (
                  <div className="w-fit max-w-[92%]">
                    <ReasoningBlock forceOpen={!isComplete}>
                      {children}
                    </ReasoningBlock>
                  </div>
                ),
                ToolGroup: ({ children }: React.PropsWithChildren) => (
                  <div className="w-full space-y-2">{children}</div>
                ),
              }}
            />
          )}
        {role === "assistant" && showTypingIndicatorBeforeText && (
          <Card className="rnc-assistant-bubble-ai w-fit border-black/10 bg-[#fff7f1]">
            <CardContent className="py-2 px-3">
              <div className="prose text-sm text-foreground overflow-hidden">
                <TypingIndicator />
              </div>
            </CardContent>
          </Card>
        )}
        {role === "assistant" && showRunningLoadingSpinner && (
          <Card className="rnc-assistant-bubble-ai w-fit border-black/10 bg-[#fff7f1]">
            <CardContent className="py-2 px-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </CardContent>
          </Card>
        )}
        {role === "user" && (
          <div className="flex max-w-[85%] flex-col items-end gap-1">
            <Card className="rnc-assistant-bubble-user w-fit max-w-full border-black/10 bg-foreground text-white">
              <CardContent className="py-2 px-3">
                <div className="whitespace-normal break-words text-sm leading-6 text-white/90">
                  <MessagePrimitive.Content
                    components={{
                      Text: MarkdownText,
                    }}
                  />
                </div>
              </CardContent>
            </Card>
            <IconButton
              tooltip="Copy"
              type="button"
              onClick={handleCopyUserMessage}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-black/5 hover:text-foreground"
              title="Copy message"
              aria-label="Copy message"
            >
              {isUserCopySuccess ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </IconButton>
          </div>
        )}
        {showDebugIcon && (
          <a
            href={debugUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="View in LangSmith"
          >
            <Bug className="h-3 w-3" />
            <span>Debug</span>
          </a>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

// Re-export for convenience
export { AssistantRuntimeProvider };

type UseFrontendReadableOptions = {
  description: string;
  value: unknown;
  disabled?: boolean;
};

function convertToJSON(description: string, value: any): string {
  return `${description}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
}
export function useFrontendReadable({
  description,
  value,
  disabled,
}: UseFrontendReadableOptions) {
  const instruction = React.useMemo(
    () => convertToJSON(description, value),
    [description, value],
  );

  useAssistantInstructions({ instruction, disabled });
}

/**
 * Injects sheets context into the assistant using useAssistantInstructions.
 * Must be used inside an AssistantRuntimeProvider.
 */
export function SheetsInstructions({
  documentId,
  sheets,
  activeSheetId,
  activeCell,
  cellXfs,
  tables,
  theme,
  getSheetName,
  getSheetProperties,
}: {
  documentId: string;
  sheets?: Sheet[];
  activeSheetId?: number;
  activeCell: CellInterface;
  cellXfs?: CellXfs | null;
  tables?: TableView[] | null;
  theme?: SpreadsheetTheme;
  getSheetName?: ReturnType<typeof useSpreadsheetState>["getSheetName"];
  getSheetProperties?: ReturnType<
    typeof useSpreadsheetState
  >["getSheetProperties"];
}) {
  const sheetSummary = React.useMemo(
    () =>
      sheets?.map((s) => ({
        title: s.title,
        sheetId: s.sheetId,
      })) ?? [],
    [sheets],
  );
  const activeCellA1Address = React.useMemo(
    () =>
      selectionToAddress({
        range: {
          startRowIndex: activeCell.rowIndex,
          endRowIndex: activeCell.rowIndex,
          startColumnIndex: activeCell.columnIndex,
          endColumnIndex: activeCell.columnIndex,
        },
      }),
    [activeCell],
  );

  useFrontendReadable({
    description: `You are helping the user edit a spreadsheet. \nDocument ID
`,
    value: documentId,
  });

  useFrontendReadable({
    description: `Available sheets in the current workbook
`,
    value: sheetSummary,
  });

  useFrontendReadable({
    description: "The user is focused on sheetId: ",
    value: activeSheetId,
  });

  useFrontendReadable({
    description: `The user's currently focussed / active cell in the spreadsheet.
IMPORTANT INDEXING RULE:
- rowIndex and columnIndex are 1-based (NOT zero-based)
- A1 is rowIndex=1, columnIndex=1
- Never interpret rowIndex=1,columnIndex=1 as B2
`,
    value: {
      ...activeCell,
      a1Address: activeCellA1Address,
    },
  });

  useFrontendReadable({
    description: `This object represents the cell formatting applied in the spreadsheet.
Each cell format is identified by a "sid" in the styles.
The formats are stored in a cellXfs registry map, where the key is the format ID and the value describes the formatting details
`,
    value: cellXfs ? Object.fromEntries([...cellXfs]) : {},
  });

  // Tables
  const tableValue = tables?.map(({ bandedRange, ...table }) => {
    const sheetProps = getSheetProperties?.(table.sheetId);
    const address = selectionToAddress(
      { range: table.range },
      getSheetName?.(table.sheetId),
      undefined,
      sheetProps?.rowCount ?? MAX_ROW_COUNT,
      sheetProps?.columnCount ?? MAX_COLUMN_COUNT,
    );

    return {
      ...table,
      ref: address,
    };
  });

  useFrontendReadable({
    description: `The Spreadsheet has the following tables. Tables have a title and and array of columns. Tables ranges do not overlap. Tables are always referenced using table name and ID. User cannot change the ID, but they can change the columns, table name and range.

List of tables:
`,
    value: tableValue,
  });

  // Map theme colors for Agent to comprehend
  const themeColorMapping = React.useMemo(() => {
    const activeTheme = theme ?? defaultSpreadsheetTheme;
    const themeColorKeysByIndex: Record<number, string> = {};
    const themeColorsByIndex: Record<number, string | undefined> = {};

    for (const [index, key] of colorKeys) {
      themeColorKeysByIndex[index] = key;
      themeColorsByIndex[index] = activeTheme.themeColors[key];
    }

    return {
      name: activeTheme.name,
      primaryFontFamily: activeTheme.primaryFontFamily,
      themeColorKeysByIndex,
      themeColorsByIndex,
      darkThemeColors: activeTheme.darkThemeColors ?? null,
    };
  }, [theme]);

  useFrontendReadable({
    description: `The current active theme of the spreadsheet has the following colors. Theme colors are mapped by this dictionary.
`,
    value: themeColorMapping,
  });

  return null;
}

const NEW_SKILL_EDITOR_ID = "__new__";

function SkillsManagerButton({
  workspaceId,
  iconOnly = false,
}: {
  workspaceId?: string;
  iconOnly?: boolean;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [skills, setSkills] = React.useState<AssistantSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = React.useState(false);
  const [skillsError, setSkillsError] = React.useState("");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [editorSkillId, setEditorSkillId] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftDescription, setDraftDescription] = React.useState("");
  const [draftInstructions, setDraftInstructions] = React.useState("");
  const [draftIsActive, setDraftIsActive] = React.useState(true);
  const [isSavingSkill, setIsSavingSkill] = React.useState(false);
  const [updatingSkillId, setUpdatingSkillId] = React.useState<string | null>(
    null,
  );
  const [deletingSkillId, setDeletingSkillId] = React.useState<string | null>(
    null,
  );
  const [pendingDeleteSkill, setPendingDeleteSkill] =
    React.useState<AssistantSkill | null>(null);
  const [formError, setFormError] = React.useState("");

  const loadSkills = React.useCallback(async () => {
    setIsLoadingSkills(true);
    setSkillsError("");
    try {
      const response = await fetch(buildSkillsApiPath(workspaceId), {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        skills?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load skills.");
      }

      setSkills(parseSkillsFromPayload(payload));
    } catch (error) {
      setSkills([]);
      setSkillsError(
        error instanceof Error ? error.message : "Failed to load skills.",
      );
    } finally {
      setIsLoadingSkills(false);
    }
  }, [workspaceId]);

  React.useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  React.useEffect(() => {
    if (!isOpen) {
      setPendingDeleteSkill(null);
    }
  }, [isOpen]);

  const activeSkills = React.useMemo(
    () => skills.filter((skill) => skill.active),
    [skills],
  );
  const skillsInstruction = React.useMemo(
    () => buildSkillsInstruction(activeSkills),
    [activeSkills],
  );

  useAssistantInstructions({
    instruction: skillsInstruction,
    disabled: skillsInstruction.length === 0,
  });

  const filteredSkills = React.useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return skills;

    return skills.filter((skill) =>
      [skill.name, skill.description, skill.instructions]
        .join("\n")
        .toLowerCase()
        .includes(query),
    );
  }, [skills, searchTerm]);
  const isEditingView = editorSkillId !== null;

  const resetEditor = React.useCallback(() => {
    setEditorSkillId(null);
    setDraftName("");
    setDraftDescription("");
    setDraftInstructions("");
    setDraftIsActive(true);
    setFormError("");
  }, []);

  const beginCreateSkill = React.useCallback(() => {
    setEditorSkillId(NEW_SKILL_EDITOR_ID);
    setDraftName("");
    setDraftDescription("");
    setDraftInstructions("");
    setDraftIsActive(true);
    setFormError("");
  }, []);

  const beginEditSkill = React.useCallback((skill: AssistantSkill) => {
    setEditorSkillId(skill.id);
    setDraftName(skill.name);
    setDraftDescription(skill.description);
    setDraftInstructions(skill.instructions);
    setDraftIsActive(skill.active);
    setFormError("");
  }, []);

  const saveSkill = React.useCallback(async () => {
    const name = draftName.trim();
    const instructions = draftInstructions.trim();
    const description = draftDescription.trim();

    if (!name) {
      setFormError("Skill name is required.");
      return;
    }

    if (!instructions) {
      setFormError("Skill instructions are required.");
      return;
    }

    setIsSavingSkill(true);
    setFormError("");
    setSkillsError("");

    try {
      const isCreating = editorSkillId === NEW_SKILL_EDITOR_ID;
      const response = await fetch(SKILLS_API_ENDPOINT, {
        method: isCreating ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          isCreating
            ? {
                workspaceId,
                name,
                description,
                instructions,
                active: draftIsActive,
              }
            : {
                workspaceId,
                skillId: editorSkillId,
                name,
                description,
                instructions,
                active: draftIsActive,
              },
        ),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        skill?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save skill.");
      }

      const nextSkill = parseSkillFromUnknown(payload?.skill);
      if (!nextSkill) {
        throw new Error("Skill response was invalid.");
      }

      setSkills((previous) => upsertSkillPreservingOrder(previous, nextSkill));
      resetEditor();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setIsSavingSkill(false);
    }
  }, [
    draftDescription,
    draftInstructions,
    draftIsActive,
    draftName,
    editorSkillId,
    resetEditor,
    workspaceId,
  ]);

  const deleteSkill = React.useCallback(
    async (skillId: string) => {
      setSkillsError("");
      setDeletingSkillId(skillId);
      try {
        const response = await fetch(SKILLS_API_ENDPOINT, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId,
            skillId,
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete skill.");
        }

        setSkills((previous) =>
          previous.filter((skill) => skill.id !== skillId),
        );
        setEditorSkillId((previous) =>
          previous === skillId ? null : previous,
        );
        setPendingDeleteSkill((current) =>
          current?.id === skillId ? null : current,
        );
      } catch (error) {
        setSkillsError(
          error instanceof Error ? error.message : "Failed to delete skill.",
        );
      } finally {
        setDeletingSkillId((current) => (current === skillId ? null : current));
      }
    },
    [workspaceId],
  );

  const toggleSkillActive = React.useCallback(
    async (skillId: string, nextActive: boolean) => {
      setSkillsError("");
      setUpdatingSkillId(skillId);
      try {
        const response = await fetch(SKILLS_API_ENDPOINT, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId,
            skillId,
            active: nextActive,
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          skill?: unknown;
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update skill.");
        }

        const nextSkill = parseSkillFromUnknown(payload?.skill);
        if (!nextSkill) {
          throw new Error("Skill response was invalid.");
        }

        setSkills((previous) =>
          upsertSkillPreservingOrder(previous, nextSkill),
        );
        setEditorSkillId((previous) => {
          if (previous !== skillId) return previous;
          setDraftIsActive(nextSkill.active);
          return previous;
        });
      } catch (error) {
        setSkillsError(
          error instanceof Error ? error.message : "Failed to update skill.",
        );
      } finally {
        setUpdatingSkillId((current) => (current === skillId ? null : current));
      }
    },
    [workspaceId],
  );

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(true)}
        className={cn(
          "rnc-assistant-chip h-8 rounded-lg border border-black/10 bg-[#faf6f0] text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2]",
          iconOnly ? "" : "gap-1.5 px-2.5 whitespace-nowrap",
        )}
        aria-label="Manage skills"
        title="Manage skills"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {!iconOnly && <span>Skills</span>}
      </Button>

      {typeof document !== "undefined"
        ? createPortal(
            isOpen ? (
        <div
          className="fixed inset-0 z-[110] overflow-y-auto bg-black/35 px-4 backdrop-blur-[1px]"
          style={{
            paddingTop: "max(1.5rem, env(safe-area-inset-top))",
            paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false);
            }
          }}
        >
          <div className="mx-auto flex h-full max-h-[900px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-(--card-border) bg-(--card-bg-solid) shadow-xl">
            <div className="flex items-start justify-between border-b border-(--card-border) px-5 py-4">
              <div>
                <h3 className="text-xl font-semibold">Skills</h3>
                <p className="mt-1 text-sm text-(--muted-foreground)">
                  Create reusable custom skills for your account. Active skills
                  are automatically applied to agent instructions.
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-(--muted-foreground) transition hover:bg-(--nav-hover) hover:text-foreground"
                onClick={() => setIsOpen(false)}
                aria-label="Close skills manager"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!isEditingView ? (
              <>
                <div className="flex items-center gap-2 border-b border-(--card-border) px-5 py-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={beginCreateSkill}
                    className="rnc-assistant-chip h-8 gap-1.5 rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-(--assistant-chip-hover)"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>New Skill</span>
                  </Button>
                  <div className="min-w-0 flex-1">
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search skills..."
                      className="h-9 w-full rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none transition placeholder:text-(--muted-foreground) focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
                  {skillsError && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {skillsError}
                    </div>
                  )}
                  {isLoadingSkills && (
                    <div className="rounded-xl border border-dashed border-(--card-border) bg-(--card-bg-subtle) p-4 text-sm text-(--muted-foreground)">
                      Loading skills...
                    </div>
                  )}
                  {!isLoadingSkills && filteredSkills.length === 0 && (
                    <div className="rounded-xl border border-dashed border-(--card-border) bg-(--card-bg-subtle) p-4 text-sm text-(--muted-foreground)">
                      {skills.length === 0
                        ? "No skills yet. Create one to guide the assistant."
                        : "No matching skills found."}
                    </div>
                  )}
                  {filteredSkills.map((skill) => {
                    const isUpdatingThisSkill = updatingSkillId === skill.id;
                    const isDeletingThisSkill = deletingSkillId === skill.id;
                    return (
                      <Card
                        key={skill.id}
                        className="border-(--card-border) bg-(--card-bg-solid) shadow-none"
                      >
                        <CardContent className="space-y-3 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-base font-semibold text-foreground">
                                {skill.name}
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <Badge
                                  variant={skill.active ? "default" : "muted"}
                                  className="px-2 py-0.5 text-[10px] tracking-[0.12em]"
                                >
                                  {skill.active ? "Active" : "Inactive"}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => beginEditSkill(skill)}
                                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-(--muted-foreground) transition hover:bg-(--nav-hover) hover:text-foreground"
                                title="Edit skill"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span>Edit</span>
                              </button>
                              <div className="flex items-center gap-2 rounded-md px-2 py-1">
                                {isUpdatingThisSkill ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                ) : null}
                                <span
                                  className={cn(
                                    "text-xs",
                                    skill.active
                                      ? "text-green-700"
                                      : "text-(--muted-foreground)",
                                  )}
                                >
                                  {isUpdatingThisSkill
                                    ? "Updating..."
                                    : skill.active
                                      ? "Active"
                                      : "Inactive"}
                                </span>
                                <Switch
                                  checked={skill.active}
                                  onCheckedChange={(checked) => {
                                    void toggleSkillActive(skill.id, checked);
                                  }}
                                  disabled={
                                    isUpdatingThisSkill || isDeletingThisSkill
                                  }
                                  aria-label={`Toggle ${skill.name} skill`}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteSkill(skill)}
                                disabled={isDeletingThisSkill}
                                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-red-500 transition hover:bg-red-500/15"
                                title="Delete skill"
                              >
                                {isDeletingThisSkill ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                                <span>
                                  {isDeletingThisSkill
                                    ? "Deleting..."
                                    : "Delete"}
                                </span>
                              </button>
                            </div>
                          </div>
                          <p className="text-sm leading-6 text-(--muted-foreground) whitespace-pre-wrap break-words">
                            {skill.description || "No description provided."}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-(--card-border) px-5 py-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={resetEditor}
                    className="rnc-assistant-chip h-8 gap-1.5 rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-(--assistant-chip-hover)"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Back to Skills</span>
                  </Button>
                  <span className="text-xs text-(--muted-foreground)">
                    {editorSkillId === NEW_SKILL_EDITOR_ID
                      ? "Creating skill"
                      : "Editing skill"}
                  </span>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden p-4">
                  <Card className="mx-auto flex h-full w-full max-w-3xl flex-col border-(--card-border) bg-(--card-bg-solid) shadow-none">
                    <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                        <div>
                          <h4 className="text-base font-semibold text-foreground">
                            {editorSkillId === NEW_SKILL_EDITOR_ID
                              ? "Create Skill"
                              : "Edit Skill"}
                          </h4>
                          <p className="text-xs text-(--muted-foreground)">
                            Skills are stored in Postgres for your account.
                          </p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-(--muted-foreground)">
                            Name
                          </label>
                          <input
                            value={draftName}
                            onChange={(event) =>
                              setDraftName(event.target.value)
                            }
                            placeholder="my-skill"
                            className="h-9 w-full rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none transition placeholder:text-(--muted-foreground) focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-(--muted-foreground)">
                            Description
                          </label>
                          <Textarea
                            value={draftDescription}
                            onChange={(event) =>
                              setDraftDescription(event.target.value)
                            }
                            placeholder="What this skill is for"
                            className="min-h-20"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-(--muted-foreground)">
                            Instructions
                          </label>
                          <Textarea
                            value={draftInstructions}
                            onChange={(event) =>
                              setDraftInstructions(event.target.value)
                            }
                            placeholder="Detailed reusable instructions for the assistant"
                            className="min-h-64"
                          />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-(--card-border) bg-(--card-bg-subtle) px-3 py-2">
                          <label
                            htmlFor="skill-enabled-switch"
                            className="text-xs text-(--muted-foreground)"
                          >
                            Enabled
                          </label>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "text-xs",
                                draftIsActive
                                  ? "text-green-700"
                                  : "text-(--muted-foreground)",
                              )}
                            >
                              {draftIsActive ? "Active" : "Inactive"}
                            </span>
                            <Switch
                              id="skill-enabled-switch"
                              checked={draftIsActive}
                              onCheckedChange={setDraftIsActive}
                              disabled={isSavingSkill}
                              aria-label="Toggle skill enabled state"
                            />
                          </div>
                        </div>
                        {formError && (
                          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {formError}
                          </div>
                        )}
                        {!formError && skillsError && (
                          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {skillsError}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 border-t border-(--card-border) px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={resetEditor}
                            disabled={isSavingSkill}
                            className="rnc-assistant-chip h-8 rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) px-3 text-xs font-normal text-foreground shadow-none hover:bg-(--assistant-chip-hover)"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={saveSkill}
                            disabled={isSavingSkill}
                            className="h-8 rounded-lg bg-(--accent) px-3 text-xs text-(--accent-foreground) hover:bg-(--accent-strong)"
                          >
                            {isSavingSkill
                              ? "Saving..."
                              : editorSkillId === NEW_SKILL_EDITOR_ID
                                ? "Create"
                                : "Save"}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>
            ) : null,
            document.body,
          )
        : null}
      <AlertDialog
        open={pendingDeleteSkill !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteSkill(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this skill?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteSkill
                ? `This will permanently remove "${pendingDeleteSkill.name}". This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDeleteSkill) return;
                void deleteSkill(pendingDeleteSkill.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Button to start a new chat session by switching to a new thread.
 * Must be used inside an AssistantRuntimeProvider.
 */
function NewSessionButton({
  iconOnly = false,
  onNewSession,
}: {
  iconOnly?: boolean;
  onNewSession?: () => void;
}) {
  const runtime = useAssistantRuntime();

  const handleNewSession = React.useCallback(() => {
    onNewSession?.();
    runtime.switchToNewThread();
    // Focus the composer input after a brief delay to ensure the thread has switched
    setTimeout(() => {
      const composerInput = document.querySelector<HTMLTextAreaElement>(
        "[data-composer-input], .aui-composer-input, textarea[placeholder]",
      );
      composerInput?.focus();
    }, 50);
  }, [onNewSession, runtime]);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={handleNewSession}
      className={cn(
        "rnc-assistant-chip h-8 rounded-lg border border-black/10 bg-[#faf6f0] text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2]",
        iconOnly ? "" : "gap-1.5 px-2.5 whitespace-nowrap",
      )}
      aria-label="New session"
      title="Start new session"
    >
      <RotateCcw className="h-3.5 w-3.5" />
      {!iconOnly && <span>New session</span>}
    </Button>
  );
}

/**
 * Shared props for assistant panel rendering.
 */
type WorkspaceAssistantPanelProps = {
  prompts: string[];
  docId?: string;
  isAdmin?: boolean;
  onNewSession?: () => void;
  isHydratingSession?: boolean;
  selectedModel: string;
  selectedModelLabel: string;
  isModelPickerOpen: boolean;
  setIsModelPickerOpen: (open: boolean) => void;
  setSelectedModel: (model: string) => void;
  reasoningEnabled: boolean;
  setReasoningEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  reasoningEnabledRef: React.MutableRefObject<boolean>;
  forceCompactHeader?: boolean;
};

const ASSISTANT_TAGLINE =
  "Plan edits, formulas, and workbook changes without leaving your sheet.";
const ASSISTANT_HEADER_COMPACT_WIDTH = 560;
const MODEL_PICKER_HIDE_WIDTH = 460;

type CreditsApiResponse = {
  credits?: {
    balance?: number;
    dailyLimit?: number;
    unlimited?: boolean;
    updatedAt?: string;
  };
};

type QueuedComposerMessage = {
  id: string;
  text: string;
};

type AssistantComposerProps = Omit<WorkspaceAssistantPanelProps, "prompts"> & {
  remainingCredits: number | null;
  isUnlimitedCredits: boolean;
  isCreditsLoading: boolean;
};

const AssistantDebugAccessContext = React.createContext<{ isAdmin: boolean }>({
  isAdmin: false,
});

function AssistantComposer({
  selectedModel,
  selectedModelLabel,
  isModelPickerOpen,
  setIsModelPickerOpen,
  setSelectedModel,
  reasoningEnabled,
  setReasoningEnabled,
  reasoningEnabledRef,
  forceCompactHeader = false,
  remainingCredits,
  isUnlimitedCredits,
  isCreditsLoading,
}: AssistantComposerProps) {
  const composerFooterRef = React.useRef<HTMLDivElement | null>(null);
  const [isComposerCompact, setIsComposerCompact] =
    React.useState(forceCompactHeader);
  const handleSelectModel = React.useCallback(
    (model: string) => {
      setSelectedModel(model);
      setIsModelPickerOpen(false);
    },
    [setIsModelPickerOpen, setSelectedModel],
  );
  const composerRuntime = useComposerRuntime();
  const threadRuntime = useThreadRuntime();
  const isThreadRunning = useThread((thread) => thread.isRunning);
  const hasCredits =
    isUnlimitedCredits ||
    remainingCredits === null ||
    remainingCredits >= MIN_CREDITS_PER_RUN;
  const canSendFromComposer = useComposer(
    (composer) => composer.isEditing && !composer.isEmpty,
  );
  const [queuedMessages, setQueuedMessages] = React.useState<
    QueuedComposerMessage[]
  >([]);
  const queuedMessagesRef = React.useRef<QueuedComposerMessage[]>([]);
  const hasQueuedDispatchRef = React.useRef(false);

  React.useEffect(() => {
    queuedMessagesRef.current = queuedMessages;
  }, [queuedMessages]);

  React.useEffect(() => {
    if (forceCompactHeader) {
      setIsComposerCompact(true);
      return;
    }

    const footer = composerFooterRef.current;
    if (!footer) {
      return;
    }

    const updateComposerWidthState = () => {
      const { width } = footer.getBoundingClientRect();
      setIsComposerCompact(width < MODEL_PICKER_HIDE_WIDTH);
    };

    updateComposerWidthState();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateComposerWidthState);
      return () => {
        window.removeEventListener("resize", updateComposerWidthState);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateComposerWidthState();
    });
    resizeObserver.observe(footer);

    return () => {
      resizeObserver.disconnect();
    };
  }, [forceCompactHeader]);

  const enqueueCurrentComposerMessage = React.useCallback(() => {
    const message = composerRuntime.getState().text.trim();
    if (!message) {
      return false;
    }

    setQueuedMessages((previous) => [
      { id: uuidString(), text: message },
      ...previous,
    ]);
    composerRuntime.setText("");
    return true;
  }, [composerRuntime]);

  const handleRemoveQueuedMessage = React.useCallback((messageId: string) => {
    setQueuedMessages((previous) =>
      previous.filter((queuedMessage) => queuedMessage.id !== messageId),
    );
  }, []);

  const handleSendOrQueue = React.useCallback(() => {
    if (isThreadRunning) {
      enqueueCurrentComposerMessage();
      return;
    }

    if (!canSendFromComposer || !hasCredits) {
      return;
    }

    composerRuntime.send();
  }, [
    canSendFromComposer,
    composerRuntime,
    enqueueCurrentComposerMessage,
    hasCredits,
    isThreadRunning,
  ]);

  const handleStopRun = React.useCallback(() => {
    if (!isThreadRunning) {
      return;
    }

    threadRuntime.cancelRun();
  }, [isThreadRunning, threadRuntime]);

  const handleQueueOnEnter = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isThreadRunning) {
        return;
      }

      if (
        event.nativeEvent.isComposing ||
        event.key !== "Enter" ||
        event.shiftKey
      ) {
        return;
      }

      event.preventDefault();
      enqueueCurrentComposerMessage();
    },
    [enqueueCurrentComposerMessage, isThreadRunning],
  );

  React.useEffect(() => {
    if (isThreadRunning) {
      hasQueuedDispatchRef.current = false;
      return;
    }

    if (hasQueuedDispatchRef.current) {
      return;
    }

    const nextMessage = queuedMessagesRef.current.at(-1);
    if (!nextMessage) {
      return;
    }

    const remainingMessages = queuedMessagesRef.current.slice(0, -1);
    hasQueuedDispatchRef.current = true;
    queuedMessagesRef.current = remainingMessages;
    setQueuedMessages(remainingMessages);
    threadRuntime.append({
      content: [{ type: "text", text: nextMessage.text }],
      runConfig: composerRuntime.getState().runConfig,
      startRun: true,
    });
  }, [composerRuntime, isThreadRunning, threadRuntime]);

  return (
    <ComposerPrimitive.Root className="rnc-assistant-composer overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
      {queuedMessages.length > 0 && (
        <div className="rnc-assistant-muted-surface max-h-32 overflow-y-auto border-b border-black/8 bg-[#fff9f4] px-3 py-2">
          <div className="space-y-2">
            {queuedMessages.map((queuedMessage) => (
              <div
                key={queuedMessage.id}
                className="rnc-assistant-item flex items-center gap-2 rounded-lg border border-black/10 bg-white px-2 py-1.5"
              >
                <p className="flex-1 text-xs leading-5 text-foreground">
                  {queuedMessage.text}
                </p>
                <IconButton
                  tooltip="Remove queued message"
                  type="button"
                  onClick={() => handleRemoveQueuedMessage(queuedMessage.id)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-black/5 hover:text-foreground"
                  title="Remove queued message"
                  aria-label="Remove queued message"
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="px-4 pt-4">
        <ComposerPrimitive.Input
          rows={3}
          onKeyDown={handleQueueOnEnter}
          placeholder="Type to start sending a message"
          className="min-h-10 sm:min-h-14 w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-foreground outline-none transition placeholder:text-[#7e8da7] focus-visible:ring-0"
        />
      </div>
      <div
        ref={composerFooterRef}
        className="flex items-center justify-between border-t border-black/8 px-3 py-2"
      >
        <div className="flex items-center gap-2">
          {isComposerCompact ? (
            <Popover
              open={isModelPickerOpen}
              onOpenChange={setIsModelPickerOpen}
            >
              <PopoverTrigger asChild>
                <IconButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  role="combobox"
                  aria-expanded={isModelPickerOpen}
                  aria-label={`Select model. Current model: ${selectedModelLabel}`}
                  title={`Model: ${selectedModelLabel}`}
                  className="rnc-assistant-chip h-8 justify-between rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2] "
                >
                  <Cpu className="h-3.5 w-3.5" />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-0">
                <Command>
                  <CommandInput placeholder="Search model..." />
                  <CommandList>
                    <CommandEmpty>No model found.</CommandEmpty>
                    {MODEL_OPTION_GROUPS.map((group) => (
                      <CommandGroup key={group.label} heading={group.label}>
                        {group.options.map((option) => (
                          <CommandItem
                            key={option.value}
                            value={`${option.label} ${option.value} ${group.label}`}
                            onSelect={() => handleSelectModel(option.value)}
                            className="text-xs"
                          >
                            <Check
                              className={cn(
                                "h-3.5 w-3.5 shrink-0",
                                selectedModel === option.value
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <span className="truncate">{option.label}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          ) : (
            <label className="flex items-center gap-2 text-xs text-(--muted-foreground)">
              <span className="uppercase tracking-[0.16em]">Model</span>
              <Popover
                open={isModelPickerOpen}
                onOpenChange={setIsModelPickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    role="combobox"
                    aria-expanded={isModelPickerOpen}
                    aria-label="Select model"
                    className="rnc-assistant-chip h-8 min-w-40 justify-between rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2]"
                  >
                    <span className="truncate">{selectedModelLabel}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-0">
                  <Command>
                    <CommandInput placeholder="Search model..." />
                    <CommandList>
                      <CommandEmpty>No model found.</CommandEmpty>
                      {MODEL_OPTION_GROUPS.map((group) => (
                        <CommandGroup key={group.label} heading={group.label}>
                          {group.options.map((option) => (
                            <CommandItem
                              key={option.value}
                              value={`${option.label} ${option.value} ${group.label}`}
                              onSelect={() => handleSelectModel(option.value)}
                              className="text-xs"
                            >
                              <Check
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0",
                                  selectedModel === option.value
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <span className="truncate">{option.label}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </label>
          )}
          <IconButton
            tooltip={reasoningEnabled ? "Reasoning On" : "Reasoning Off"}
            variant="unstyled"
            type="button"
            onClick={() =>
              setReasoningEnabled((previous) => {
                const next = !previous;
                reasoningEnabledRef.current = next;
                return next;
              })
            }
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-none transition",
              reasoningEnabled
                ? "border-(--panel-border-strong) bg-(--assistant-chip-hover) text-foreground hover:bg-(--assistant-suggestion-hover) hover:text-foreground"
                : "rnc-assistant-chip border-(--panel-border) bg-(--assistant-chip-bg) text-(--muted-foreground) hover:bg-(--assistant-chip-hover) hover:text-foreground",
            )}
            aria-label={`Reasoning ${reasoningEnabled ? "on" : "off"}`}
            title={reasoningEnabled ? "Reasoning On" : "Reasoning Off"}
          >
            <Sparkles
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                reasoningEnabled
                  ? "text-(--accent)"
                  : "text-(--muted-foreground)",
              )}
            />
          </IconButton>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rnc-assistant-chip inline-flex h-8 items-center rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-[10px] uppercase tracking-[0.12em] text-(--muted-foreground)"
            title="Remaining credits"
          >
            {isCreditsLoading
              ? "Credits ..."
              : isUnlimitedCredits
                ? "Credits Unlimited"
                : `Credits ${remainingCredits ?? 0}/${INITIAL_CREDITS}`}
          </span>
          {isThreadRunning && (
            <IconButton
              tooltip="Stop"
              onClick={handleStopRun}
              className="rnc-assistant-stop inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-[#fff1ee] text-[#c23f2c] shadow-none transition hover:bg-[#ffe5df]"
              title="Stop"
              aria-label="Stop"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </IconButton>
          )}
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={handleSendOrQueue}
            aria-label={isThreadRunning ? "Queue message" : "Send message"}
            disabled={!canSendFromComposer || !hasCredits}
            className={cn(
              "h-9 w-9 rounded-xl bg-(--accent) p-0 text-(--accent-foreground) shadow-[0_8px_20px_rgba(255,109,52,0.22)] hover:bg-(--accent-strong) focus-visible:ring-(--ring)",
              "disabled:bg-(--assistant-chip-bg) disabled:text-(--muted-foreground) disabled:shadow-none disabled:opacity-100",
            )}
          >
            <SendHorizontal
              aria-hidden="true"
              className="h-4 w-4 shrink-0 stroke-[2.2]"
            />
          </Button>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

function WorkspaceAssistantPanel({
  prompts,
  docId,
  isAdmin = false,
  onNewSession,
  isHydratingSession = false,
  selectedModel,
  selectedModelLabel,
  isModelPickerOpen,
  setIsModelPickerOpen,
  setSelectedModel,
  reasoningEnabled,
  setReasoningEnabled,
  reasoningEnabledRef,
  forceCompactHeader = false,
}: WorkspaceAssistantPanelProps) {
  const assistantHeaderRef = React.useRef<HTMLDivElement | null>(null);
  const [isAssistantHeaderCompact, setIsAssistantHeaderCompact] =
    React.useState(forceCompactHeader);
  const isThreadEmpty = useThread((thread) => thread.messages.length === 0);
  const isThreadRunning = useThread((thread) => thread.isRunning);
  const [remainingCredits, setRemainingCredits] = React.useState<number | null>(
    null,
  );
  const [isUnlimitedCredits, setIsUnlimitedCredits] = React.useState(false);
  const [isCreditsLoading, setIsCreditsLoading] = React.useState(true);

  const loadCredits = React.useCallback(async () => {
    try {
      setIsCreditsLoading(true);
      const response = await fetch("/api/credits", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        setRemainingCredits(null);
        setIsUnlimitedCredits(false);
        return;
      }

      const payload = (await response.json()) as CreditsApiResponse;
      const balance = payload.credits?.balance;
      const isUnlimited = payload.credits?.unlimited === true;
      setRemainingCredits(typeof balance === "number" ? balance : null);
      setIsUnlimitedCredits(isUnlimited);
    } catch {
      setRemainingCredits(null);
      setIsUnlimitedCredits(false);
    } finally {
      setIsCreditsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadCredits();
  }, [loadCredits]);

  const previousThreadRunningRef = React.useRef(isThreadRunning);
  React.useEffect(() => {
    const wasRunning = previousThreadRunningRef.current;
    previousThreadRunningRef.current = isThreadRunning;

    if (!wasRunning || isThreadRunning) return;
    void loadCredits();
  }, [isThreadRunning, loadCredits]);

  React.useEffect(() => {
    if (forceCompactHeader) {
      setIsAssistantHeaderCompact(true);
      return;
    }

    const header = assistantHeaderRef.current;
    if (!header) {
      return;
    }

    const updateHeaderWidthState = () => {
      const { width } = header.getBoundingClientRect();
      setIsAssistantHeaderCompact(width < ASSISTANT_HEADER_COMPACT_WIDTH);
    };

    updateHeaderWidthState();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeaderWidthState);
      return () => {
        window.removeEventListener("resize", updateHeaderWidthState);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateHeaderWidthState();
    });
    resizeObserver.observe(header);

    return () => {
      resizeObserver.disconnect();
    };
  }, [forceCompactHeader]);

  return (
    <Card className="rnc-assistant-panel flex h-full min-h-128 flex-col overflow-hidden border-(--card-border) bg-(--assistant-panel-bg) rounded-none">
      <div
        ref={assistantHeaderRef}
        className="rnc-assistant-divider border-b border-black/8 px-5 py-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display-font mt-1 text-2xl font-semibold tracking-[-0.03em]">
              Spreadsheet Agent
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <NewSessionButton
              iconOnly={isAssistantHeaderCompact}
              onNewSession={onNewSession}
            />
            <SkillsManagerButton
              workspaceId={docId}
              iconOnly={isAssistantHeaderCompact}
            />
          </div>
        </div>
        <p className="mt-1 text-sm leading-6 text-(--muted-foreground)">
          {ASSISTANT_TAGLINE}
        </p>
      </div>

      <AssistantDebugAccessContext.Provider value={{ isAdmin }}>
        <ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col">
          <SpreadsheetToolUIRegistry />
          <ThreadPrimitive.Viewport
            className={cn(
              "min-h-0 overflow-y-auto px-5",
              isThreadEmpty ? "h-0 flex-none py-0" : "flex-1 py-5",
            )}
          >
            <div className="space-y-4">
              <ThreadPrimitive.Messages
                components={{
                  UserMessage: AssistantMessage,
                  AssistantMessage,
                }}
              />
            </div>
          </ThreadPrimitive.Viewport>

          <div
            className={cn(
              "rnc-assistant-divider w-full px-5 py-4",
              isThreadEmpty ? "my-auto border-t-0" : "border-t border-black/8",
            )}
          >
            <div className={cn("w-full", isThreadEmpty ? "space-y-3" : "")}>
              <AssistantComposer
                selectedModel={selectedModel}
                selectedModelLabel={selectedModelLabel}
                isModelPickerOpen={isModelPickerOpen}
                setIsModelPickerOpen={setIsModelPickerOpen}
                setSelectedModel={setSelectedModel}
                reasoningEnabled={reasoningEnabled}
                setReasoningEnabled={setReasoningEnabled}
                reasoningEnabledRef={reasoningEnabledRef}
                forceCompactHeader={forceCompactHeader}
                remainingCredits={remainingCredits}
                isUnlimitedCredits={isUnlimitedCredits}
                isCreditsLoading={isCreditsLoading}
              />
              <ThreadPrimitive.If empty>
                <div className="gap-2 flex flex-wrap flex-row min-w-0 items-center justify-center">
                  <TooltipProvider delayDuration={200}>
                    {prompts.map((prompt) => (
                      <Tooltip key={prompt}>
                        <TooltipTrigger asChild>
                          <ThreadPrimitive.Suggestion
                            prompt={prompt}
                            send
                            className="rnc-assistant-suggestion w-56 rounded-xl border border-black/10 bg-[#fff9f2] px-4 py-3 text-left text-sm leading-5 text-foreground transition hover:border-black/20 hover:bg-[#fff2e3]"
                          >
                            <span
                              className="block overflow-hidden"
                              style={{
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {prompt}
                            </span>
                          </ThreadPrimitive.Suggestion>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="center">
                          {prompt}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </TooltipProvider>
                </div>
              </ThreadPrimitive.If>
            </div>
          </div>
          {isHydratingSession && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
              <div className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-(--muted-foreground) shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Restoring session...
              </div>
            </div>
          )}
        </ThreadPrimitive.Root>
      </AssistantDebugAccessContext.Provider>
    </Card>
  );
}

/**
 * UI-only component for the workspace assistant.
 * Must be used inside an AssistantRuntimeProvider.
 * Use this when you want to lift the runtime to a higher level.
 */
export function WorkspaceAssistantUI({
  prompts,
  docId,
  isAdmin,
  onNewSession,
  isHydratingSession,
  selectedModel,
  selectedModelLabel,
  isModelPickerOpen,
  setIsModelPickerOpen,
  setSelectedModel,
  reasoningEnabled,
  setReasoningEnabled,
  reasoningEnabledRef,
  forceCompactHeader,
}: WorkspaceAssistantUIProps) {
  return (
    <WorkspaceAssistantPanel
      prompts={prompts}
      docId={docId}
      isAdmin={isAdmin}
      onNewSession={onNewSession}
      isHydratingSession={isHydratingSession}
      selectedModel={selectedModel}
      selectedModelLabel={selectedModelLabel}
      isModelPickerOpen={isModelPickerOpen}
      setIsModelPickerOpen={setIsModelPickerOpen}
      setSelectedModel={setSelectedModel}
      reasoningEnabled={reasoningEnabled}
      setReasoningEnabled={setReasoningEnabled}
      reasoningEnabledRef={reasoningEnabledRef}
      forceCompactHeader={forceCompactHeader}
    />
  );
}

export function WorkspaceAssistant({
  prompts,
  docId,
  sheets,
  activeSheetId,
  isAdmin,
}: WorkspaceAssistantProps) {
  const { threadId, persistInUrl, markThreadStarted, startNewThread } =
    useThreadIdFromUrl();
  const [selectedModel, setSelectedModel] =
    React.useState<string>(DEFAULT_MODEL);
  const [isModelPickerOpen, setIsModelPickerOpen] = React.useState(false);
  const [reasoningEnabled, setReasoningEnabled] = React.useState(true);
  const selectedModelRef = React.useRef(selectedModel);
  const reasoningEnabledRef = React.useRef(reasoningEnabled);
  const docIdRef = React.useRef(docId);
  React.useEffect(() => {
    docIdRef.current = docId;
  }, [docId]);

  React.useEffect(() => {
    try {
      const storedModel = window.localStorage
        .getItem(MODEL_STORAGE_KEY)
        ?.trim();
      if (storedModel && MODEL_OPTION_VALUES.has(storedModel)) {
        setSelectedModel(storedModel);
        selectedModelRef.current = storedModel;
      }
    } catch {
      // Ignore localStorage read failures (private mode / blocked storage)
    }
  }, []);

  React.useEffect(() => {
    try {
      const storedReasoningEnabled = window.localStorage
        .getItem(REASONING_STORAGE_KEY)
        ?.trim()
        .toLowerCase();

      if (storedReasoningEnabled === "true" || storedReasoningEnabled === "1") {
        setReasoningEnabled(true);
        reasoningEnabledRef.current = true;
      }

      if (
        storedReasoningEnabled === "false" ||
        storedReasoningEnabled === "0"
      ) {
        setReasoningEnabled(false);
        reasoningEnabledRef.current = false;
      }
    } catch {
      // Ignore localStorage read failures (private mode / blocked storage)
    }
  }, []);

  React.useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  React.useEffect(() => {
    reasoningEnabledRef.current = reasoningEnabled;
  }, [reasoningEnabled]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
    } catch {
      // Ignore localStorage write failures (private mode / blocked storage)
    }
  }, [selectedModel]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(
        REASONING_STORAGE_KEY,
        String(reasoningEnabled),
      );
    } catch {
      // Ignore localStorage write failures (private mode / blocked storage)
    }
  }, [reasoningEnabled]);

  const selectedModelLabel =
    MODEL_OPTIONS.find((option) => option.value === selectedModel)?.label ??
    selectedModel;

  const runtime = useLocalRuntime(
    React.useMemo<ChatModelAdapter>(
      () => ({
        async *run({ messages, abortSignal }) {
          const latestUserMessage = [...messages]
            .reverse()
            .find((message) => message.role === "user");
          const message = getMessageText(latestUserMessage);

          if (!message) {
            yield {
              content: [
                {
                  type: "text",
                  text: "I need a prompt before I can help.",
                },
              ],
              status: {
                type: "complete",
                reason: "stop",
              },
            };
            return;
          }

          try {
            markThreadStarted();
            const response = await requestAssistantChat({
              threadId,
              docId: docIdRef.current,
              message,
              reasoningEnabled: reasoningEnabledRef.current,
              signal: abortSignal,
            });

            if (!response.ok) {
              const payload = (await response
                .json()
                .catch(() => null)) as AssistantChatErrorPayload | null;

              throw new Error(
                getAssistantRequestErrorMessage(response.status, payload),
              );
            }

            if (!response.body) {
              throw new Error("Assistant stream is unavailable.");
            }

            yield* streamAssistantResponse(response.body, threadId);
          } catch (error) {
            if (isAbortError(error)) {
              return;
            }

            yield buildTerminalAssistantMessage(
              normalizeAssistantClientError(error),
            );
          }
        },
      }),
      [markThreadStarted, threadId],
    ),
    {
      maxSteps: 1,
    },
  );
  const isHydratingSession = useHydratePersistedThreadHistory({
    runtime,
    threadId,
    enabled: persistInUrl,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <WorkspaceAssistantPanel
        prompts={prompts}
        docId={docId}
        isAdmin={isAdmin}
        onNewSession={startNewThread}
        isHydratingSession={isHydratingSession}
        selectedModel={selectedModel}
        selectedModelLabel={selectedModelLabel}
        isModelPickerOpen={isModelPickerOpen}
        setIsModelPickerOpen={setIsModelPickerOpen}
        setSelectedModel={setSelectedModel}
        reasoningEnabled={reasoningEnabled}
        setReasoningEnabled={setReasoningEnabled}
        reasoningEnabledRef={reasoningEnabledRef}
      />
    </AssistantRuntimeProvider>
  );
}
