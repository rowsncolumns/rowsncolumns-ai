"use client";

import type {
  AssistantToolUIProps,
  ChatModelAdapter,
  ThreadAssistantMessagePart,
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
  useMessagePartText,
  useLocalRuntime,
  useMessage,
  useAssistantToolUI,
  useInlineRender,
  useThread,
  useThreadRuntime,
  useAuiState,
  useMessagePartImage,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
  colorKeys,
  defaultSpreadsheetTheme,
  EmbeddedChart,
  NamedRange,
  scrollSubscriber,
  Sheet,
  SpreadsheetTheme,
  TableView,
  ToolbarIconButton,
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
  ChevronDown,
  ChevronLeft,
  ChevronsUpDown,
  Copy,
  Cpu,
  FileText,
  GitFork,
  Info,
  Loader2,
  Image as ImageIcon,
  Minus,
  Navigation,
  Paperclip,
  Pencil,
  Plus,
  Square,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";
import remarkGfm from "remark-gfm";
import { useShallow } from "zustand/shallow";

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
import { ContextUsageTooltipTrigger } from "@/components/workspace-assistant/context-usage-tooltip-trigger";
import { CreditsPopoverButton } from "@/components/workspace-assistant/credits-popover-button";
import {
  getImageFilesFromDataTransfer,
  hasImageFilesInDataTransfer,
  isHeicLikeFile,
  isSupportedImageFile,
  resizeImageForAssistant,
  uploadAssistantImage,
} from "@/components/workspace-assistant/image-utils";
import {
  NewSessionButton,
  SessionPickerButton,
} from "@/components/workspace-assistant/session-controls";
import { useIsTouchInputDevice } from "@/components/workspace-assistant/touch-input-device";
import { normalizeAssistantErrorMessage } from "@/lib/chat/errors";
import { buildSkillsInstruction } from "@/lib/chat/instructions";
import {
  getStablePartRenderKeyFromSignature,
  getStablePartSignature,
  getStablePartTypeFromSignature,
  getStableThreadMessageRenderKey,
  groupStableMessageParts,
} from "@/lib/assistant/stable-rendering";
import { setStreamingToolResult } from "@/lib/assistant/tool-call-stream";
import {
  clearThreadContextUsage,
  getLatestContextUsageFromRunEvents,
  parseAssistantContextUsageEvent,
  getThreadContextUsage,
  setThreadContextUsage,
  type AssistantContextUsage,
  type AssistantContextUsageByThread,
} from "@/lib/assistant/context-usage-state";
import {
  CHAT_EXTERNAL_API_ENABLED,
  CHAT_HISTORY_API_ENDPOINT,
  DEFAULT_MODE,
  DEFAULT_MODEL,
  FORK_BUTTON_ENABLED,
  getChatRequestUrl,
  getChatResumeUrl,
  INSUFFICIENT_CREDITS_ERROR_CODE,
  MODE_OPTIONS,
  MODE_OPTION_VALUES,
  MODE_STORAGE_KEY,
  MODEL_OPTIONS,
  MODEL_OPTION_GROUPS,
  MODEL_OPTION_VALUES,
  MODEL_STORAGE_KEY,
  OUT_OF_CREDITS_MESSAGE,
  REASONING_STORAGE_KEY,
  SKILLS_API_ENDPOINT,
} from "@/lib/assistant/workspace-assistant-config";
import type {
  SpreadsheetAssistantContext,
  ChartSummary,
  NamedRangeSummary,
  TableSummary,
  ViewPortProps,
} from "@/lib/chat/context";
import { parseChatStream, type ChatStreamEvent } from "@/lib/chat/protocol";
import { INITIAL_CREDITS, MIN_CREDITS_PER_RUN } from "@/lib/credits/pricing";
import { cn } from "@/lib/utils";
import { IconButton } from "@rowsncolumns/ui";
import { useSpreadsheetState } from "@rowsncolumns/spreadsheet-state";
import { useNetworkStatus } from "@/hooks/use-network-status";

type WorkspaceAssistantProps = {
  prompts: string[];
  docId?: string;
  sheets?: Sheet[];
  activeSheetId?: number;
  isAdmin?: boolean;
};

type AssistantMode = "action" | "plan" | "ask";

/**
 * Props for the UI-only WorkspaceAssistantUI component.
 * Used when AssistantRuntimeProvider is provided at a higher level.
 */
export type WorkspaceAssistantUIProps = {
  prompts: string[];
  docId?: string;
  isAdmin?: boolean;
  threadId?: string;
  onNewSession?: () => void;
  onSelectSession?: (threadId: string) => void | Promise<void>;
  onForkConversation?: (atMessageIndex: number) => Promise<void>;
  isForkingRef?: React.MutableRefObject<boolean>;
  isHydratingSession: boolean;
  isResumingRun?: boolean;
  isReconnecting?: boolean;
  contextUsage?: AssistantContextUsage | null;
  selectedModel: string;
  selectedModelLabel: string;
  isModelPickerOpen: boolean;
  setIsModelPickerOpen: (open: boolean) => void;
  setSelectedModel: (model: string) => void;
  selectedMode: AssistantMode;
  selectedModeLabel: string;
  isModePickerOpen: boolean;
  setIsModePickerOpen: (open: boolean) => void;
  setSelectedMode: (mode: AssistantMode) => void;
  reasoningEnabled: boolean;
  setReasoningEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  reasoningEnabledRef: React.MutableRefObject<boolean>;
  forceCompactHeader?: boolean;
  onClose?: () => void;
};
type AssistantChatErrorPayload = {
  error?: string;
  code?: string;
};
const ASSISTANT_CONTEXT_BY_DOCUMENT_ID = new Map<
  string,
  SpreadsheetAssistantContext
>();

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
const ASSISTANT_MAX_COMPOSER_IMAGES = 5;
const ASSISTANT_CONTEXT_USAGE_STORAGE_KEY =
  "rnc.ai.workspace-assistant.context-usage-v1";

type ChatImageInput = {
  url: string;
  filename?: string;
};

type ComposerImageAttachment = {
  id: string;
  filename: string;
  status: "uploading" | "ready" | "error";
  uploadProgress?: number;
  previewUrl?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  contentType?: string;
  sizeBytes?: number;
  error?: string;
};

type ChatRunResumeResponse = {
  run: {
    runId: string;
    threadId: string;
    status: "running" | "completed" | "failed";
    startedAt: string;
    completedAt?: string;
    errorMessage?: string;
  };
  events: Array<{
    id: number;
    type: string;
    data: {
      type: string;
      delta?: string;
      message?: string;
      threadId?: string;
      toolName?: string;
      toolCallId?: string;
      args?: unknown;
      result?: unknown;
      isError?: boolean;
      error?: string;
      [key: string]: unknown;
    };
  }>;
  hasMore: boolean;
};

const fetchChatRunResume = async (input: {
  threadId: string;
  runId?: string;
  lastEventId?: number;
  signal?: AbortSignal;
}): Promise<ChatRunResumeResponse | null> => {
  const params = new URLSearchParams();
  params.set("threadId", input.threadId);
  if (input.runId) params.set("runId", input.runId);
  if (input.lastEventId) params.set("lastEventId", String(input.lastEventId));

  try {
    const response = await fetch(`${getChatResumeUrl()}?${params}`, {
      method: "GET",
      credentials: CHAT_EXTERNAL_API_ENABLED ? "include" : "same-origin",
      signal: input.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ChatRunResumeResponse;
  } catch {
    return null;
  }
};

const parsePersistedContextUsageByThread = (
  raw: string | null,
): AssistantContextUsageByThread => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const next: AssistantContextUsageByThread = {};
    for (const [threadId, value] of Object.entries(parsed)) {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        continue;
      }
      const usage = parseAssistantContextUsageEvent(value);
      if (usage) {
        next[normalizedThreadId] = usage;
      }
    }
    return next;
  } catch {
    return {};
  }
};

const setAssistantContextSnapshot = (
  documentId: string,
  context: SpreadsheetAssistantContext,
) => {
  ASSISTANT_CONTEXT_BY_DOCUMENT_ID.set(documentId, context);
};

const clearAssistantContextSnapshot = (documentId: string) => {
  ASSISTANT_CONTEXT_BY_DOCUMENT_ID.delete(documentId);
};

const getAssistantContextSnapshot = (documentId?: string) => {
  if (!documentId) {
    return undefined;
  }
  return ASSISTANT_CONTEXT_BY_DOCUMENT_ID.get(documentId);
};

const getProviderForModel = (model: string | undefined) => {
  if (!model) {
    return "openai" as const;
  }
  return /^claude/i.test(model) ? ("anthropic" as const) : ("openai" as const);
};

const requestAssistantChat = async (input: {
  threadId: string;
  docId?: string;
  message: string;
  images?: ChatImageInput[];
  model?: string;
  mode?: AssistantMode;
  provider?: "openai" | "anthropic";
  reasoningEnabled?: boolean;
  context?: SpreadsheetAssistantContext;
  signal: AbortSignal;
}) => {
  const requestBody = JSON.stringify({
    threadId: input.threadId,
    docId: input.docId,
    message: input.message,
    ...(input.images && input.images.length > 0
      ? { images: input.images }
      : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(typeof input.reasoningEnabled === "boolean"
      ? { reasoningEnabled: input.reasoningEnabled }
      : {}),
    ...(input.context ? { context: input.context } : {}),
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch(getChatRequestUrl(), {
    method: "POST",
    headers,
    body: requestBody,
    signal: input.signal,
    cache: "no-store",
    credentials: CHAT_EXTERNAL_API_ENABLED ? "include" : "same-origin",
  });

  return response;
};

const useThreadIdFromUrl = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams.get("session_id")?.trim() || null;
  const [initialSessionIdOnMount] = React.useState<string | null>(
    () => sessionIdFromUrl,
  );
  const [threadId, setThreadId] = React.useState(
    () => initialSessionIdOnMount ?? uuidString(),
  );

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
  }, [pushSessionIdToHistory, threadId]);

  const startNewThread = React.useCallback(() => {
    const nextThreadId = uuidString();
    pushSessionIdToHistory(null);
    setThreadId(nextThreadId);
  }, [pushSessionIdToHistory]);

  const selectThread = React.useCallback(
    (nextThreadId: string) => {
      const normalizedThreadId = nextThreadId.trim();
      if (!normalizedThreadId) {
        return;
      }

      pushSessionIdToHistory(normalizedThreadId);
      setThreadId((previousThreadId) =>
        previousThreadId === normalizedThreadId
          ? previousThreadId
          : normalizedThreadId,
      );
    },
    [pushSessionIdToHistory],
  );

  return {
    initialSessionId: initialSessionIdOnMount,
    sessionIdFromUrl,
    threadId,
    markThreadStarted,
    startNewThread,
    selectThread,
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

const snapshotStreamingContent = (
  parts: StreamingContentPart[],
): ThreadAssistantMessagePart[] =>
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
  }) as unknown as ThreadAssistantMessagePart[];

/**
 * Marks any pending tool calls (those without results) as incomplete.
 * This ensures tool calls don't show as "running" forever when the stream ends
 * before their results arrive.
 */
const finalizePendingToolCalls = (parts: StreamingContentPart[]) => {
  for (const part of parts) {
    if (part.type === "tool-call" && part.result === undefined) {
      part.result = { success: false, error: "Tool call incomplete" };
    }
  }
};

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

type StreamingState = {
  runId: string | null;
  parts: StreamingContentPart[];
  toolPartIndexById: Map<string, number>;
};
type ContextUsageStreamEvent = Extract<
  ChatStreamEvent,
  { type: "context.usage" }
>;

const processStreamEvent = (
  event: { type: string; [key: string]: unknown },
  state: StreamingState,
  threadId: string,
): { yield: ReturnType<typeof buildStreamingYield>; done: boolean } | null => {
  if (event.type === "message.start" && "runId" in event) {
    state.runId = (event.runId as string) ?? null;
    return { yield: buildStreamingYield(state.parts, threadId), done: false };
  }

  if (event.type === "reasoning.start") {
    return { yield: buildStreamingYield(state.parts, threadId), done: false };
  }

  if (event.type === "reasoning.delta" && "delta" in event) {
    appendStreamingDelta(state.parts, "reasoning", event.delta as string);
    return { yield: buildStreamingYield(state.parts, threadId), done: false };
  }

  if (event.type === "message.delta" && "delta" in event) {
    appendStreamingDelta(state.parts, "text", event.delta as string);
    return { yield: buildStreamingYield(state.parts, threadId), done: false };
  }

  if (event.type === "tool.call") {
    const toolCallId =
      (event.toolCallId as string) ?? (event.toolName as string);
    upsertStreamingToolCall(
      state.parts,
      state.toolPartIndexById,
      toolCallId,
      event.toolName as string,
      (event.args as Record<string, unknown>) ?? {},
    );
    return { yield: buildStreamingYield(state.parts, threadId), done: false };
  }

  if (event.type === "tool.result") {
    const toolCallId =
      (event.toolCallId as string) ?? (event.toolName as string);
    setStreamingToolResult(
      state.parts,
      state.toolPartIndexById,
      toolCallId,
      event.toolName as string,
      event.result,
      event.args as Record<string, unknown> | undefined,
      event.isError === true,
    );
    return { yield: buildStreamingYield(state.parts, threadId), done: false };
  }

  if (event.type === "message.complete") {
    finalizePendingToolCalls(state.parts);
    return {
      yield: buildStreamingYield(
        state.parts,
        threadId,
        { type: "complete", reason: "stop" },
        event.message as string,
      ),
      done: true,
    };
  }

  if (event.type === "error") {
    const errorMessage = normalizeAssistantErrorMessage(
      (event.error as string) ?? "",
      "Assistant request failed.",
    );
    appendStreamingDelta(state.parts, "text", `\n\n${errorMessage}`);
    finalizePendingToolCalls(state.parts);
    return {
      yield: buildStreamingYield(
        state.parts,
        threadId,
        { type: "complete", reason: "stop" },
        errorMessage,
      ),
      done: true,
    };
  }

  return null;
};

async function* streamAssistantResponse(
  stream: ReadableStream<Uint8Array>,
  threadId: string,
  onRunId?: (runId: string) => void,
  onContextUsage?: (event: ContextUsageStreamEvent) => void,
) {
  const state: StreamingState = {
    runId: null,
    parts: [],
    toolPartIndexById: new Map(),
  };

  for await (const event of parseChatStream(stream)) {
    // Capture runId from message.start for reconnection
    if (event.type === "message.start" && "runId" in event && event.runId) {
      state.runId = event.runId as string;
      onRunId?.(state.runId);
    }
    if (event.type === "context.usage") {
      onContextUsage?.(event);
      continue;
    }

    const result = processStreamEvent(event, state, threadId);
    if (result) {
      yield result.yield;
      if (result.done) return;
    }
  }

  finalizePendingToolCalls(state.parts);
  yield buildStreamingYield(state.parts, threadId, {
    type: "complete",
    reason: "stop",
  });
}

// Standard SSE reconnection with exponential backoff
const SSE_RECONNECT_MAX_RETRIES = 3;
const SSE_RECONNECT_BASE_DELAY_MS = 1000;
const SSE_RECONNECT_MAX_DELAY_MS = 8000;

const computeReconnectDelay = (attempt: number): number => {
  const exponential = SSE_RECONNECT_BASE_DELAY_MS * 2 ** attempt;
  const capped = Math.min(exponential, SSE_RECONNECT_MAX_DELAY_MS);
  // Add jitter to prevent thundering herd
  const jitter = Math.floor(Math.random() * 500);
  return capped + jitter;
};

const isNetworkError = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof Error &&
    (error.message.includes("Load failed") ||
      error.message.includes("network") ||
      error.message.includes("fetch") ||
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError")));

async function* resumeStreamWithRetry(
  threadId: string,
  runId: string,
  signal?: AbortSignal,
  onContextUsage?: (event: ContextUsageStreamEvent) => void,
): AsyncGenerator<ReturnType<typeof buildStreamingYield>, void, unknown> {
  for (let attempt = 0; attempt < SSE_RECONNECT_MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      return;
    }

    // Wait with exponential backoff before retry (except first attempt)
    if (attempt > 0) {
      const delay = computeReconnectDelay(attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (signal?.aborted) {
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set("threadId", threadId);
      params.set("runId", runId);
      params.set("stream", "true");

      const response = await fetch(`${getChatResumeUrl()}?${params}`, {
        method: "GET",
        credentials: CHAT_EXTERNAL_API_ENABLED ? "include" : "same-origin",
        signal,
      });

      if (!response.ok) {
        // Server error - don't retry, let caller handle
        throw new Error(`Resume failed with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error("Resume stream is unavailable.");
      }

      // Successfully reconnected - stream the response
      yield* streamAssistantResponse(
        response.body,
        threadId,
        undefined,
        onContextUsage,
      );
      return; // Success - exit retry loop
    } catch (error) {
      if (signal?.aborted) {
        return;
      }

      // Only retry on network errors
      if (!isNetworkError(error)) {
        throw error;
      }

      // Last attempt failed - propagate the error
      if (attempt === SSE_RECONNECT_MAX_RETRIES - 1) {
        throw error;
      }

      // Will retry on next iteration
    }
  }
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
    return normalizeAssistantErrorMessage(
      payload.error,
      "Assistant request failed.",
    );
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
    image?: unknown;
    filename?: unknown;
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

  if (part.type === "image") {
    if (typeof part.image !== "string" || part.image.trim().length === 0) {
      return null;
    }

    return {
      type: "image" as const,
      image: part.image.trim(),
      ...(typeof part.filename === "string" && part.filename.trim().length > 0
        ? { filename: part.filename.trim() }
        : {}),
    };
  }

  if (part.type === "tool-call") {
    if (
      typeof part.toolName !== "string" ||
      part.toolName.trim().length === 0
    ) {
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
  const messages = parsePersistedThreadHistoryPayload(payload);

  // Add threadId metadata to restored messages for debug icon
  return messages.map((message) => ({
    ...message,
    metadata: {
      custom: {
        threadId,
      },
    },
  }));
};

/**
 * Hook to create the assistant runtime with model selection state.
 * This can be used at a higher level to wrap multiple components with AssistantRuntimeProvider.
 */
export function useSpreadsheetAssistantRuntime({ docId }: { docId?: string }) {
  const {
    initialSessionId,
    sessionIdFromUrl,
    threadId,
    markThreadStarted: markThreadStartedInUrl,
    startNewThread: startNewThreadInUrl,
    selectThread: selectThreadInUrl,
  } = useThreadIdFromUrl();

  const [selectedModel, setSelectedModel] =
    React.useState<string>(DEFAULT_MODEL);
  const [selectedMode, setSelectedMode] =
    React.useState<AssistantMode>(DEFAULT_MODE);
  const [isModelPickerOpen, setIsModelPickerOpen] = React.useState(false);
  const [isModePickerOpen, setIsModePickerOpen] = React.useState(false);
  const [reasoningEnabled, setReasoningEnabled] = React.useState(false);
  const [contextUsageByThread, setContextUsageByThread] =
    React.useState<AssistantContextUsageByThread>({});
  const hasHydratedContextUsageRef = React.useRef(false);
  const selectedModelRef = React.useRef(selectedModel);
  const selectedModeRef = React.useRef<AssistantMode>(selectedMode);
  const reasoningEnabledRef = React.useRef(reasoningEnabled);
  const docIdRef = React.useRef(docId);
  const pendingLocalSessionIdRef = React.useRef<string | null | undefined>(
    undefined,
  );

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
    try {
      const persisted = parsePersistedContextUsageByThread(
        window.localStorage.getItem(ASSISTANT_CONTEXT_USAGE_STORAGE_KEY),
      );
      if (Object.keys(persisted).length === 0) {
        return;
      }
      setContextUsageByThread((previous) => ({ ...persisted, ...previous }));
    } catch {
      // Ignore localStorage read failures
    } finally {
      hasHydratedContextUsageRef.current = true;
    }
  }, []);

  React.useEffect(() => {
    try {
      const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY)?.trim();
      if (storedMode && MODE_OPTION_VALUES.has(storedMode as AssistantMode)) {
        const nextMode = storedMode as AssistantMode;
        setSelectedMode(nextMode);
        selectedModeRef.current = nextMode;
      }
    } catch {
      // Ignore localStorage read failures
    }
  }, []);

  React.useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  React.useEffect(() => {
    selectedModeRef.current = selectedMode;
  }, [selectedMode]);

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

  React.useEffect(() => {
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, selectedMode);
    } catch {
      // Ignore localStorage write failures
    }
  }, [selectedMode]);

  React.useEffect(() => {
    if (!hasHydratedContextUsageRef.current) {
      return;
    }

    try {
      const entries = Object.entries(contextUsageByThread);
      if (entries.length === 0) {
        window.localStorage.removeItem(ASSISTANT_CONTEXT_USAGE_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(
        ASSISTANT_CONTEXT_USAGE_STORAGE_KEY,
        JSON.stringify(contextUsageByThread),
      );
    } catch {
      // Ignore localStorage write failures
    }
  }, [contextUsageByThread]);

  const selectedModelLabel =
    MODEL_OPTIONS.find((option) => option.value === selectedModel)?.label ??
    selectedModel;
  const selectedModeLabel =
    MODE_OPTIONS.find((option) => option.value === selectedMode)?.label ??
    selectedMode;

  const handleSelectModel = React.useCallback((model: string) => {
    setSelectedModel(model);
    selectedModelRef.current = model;
    setIsModelPickerOpen(false);
  }, []);

  const handleSelectMode = React.useCallback((mode: AssistantMode) => {
    setSelectedMode(mode);
    selectedModeRef.current = mode;
    setIsModePickerOpen(false);
  }, []);

  const markThreadStarted = React.useCallback(() => {
    pendingLocalSessionIdRef.current = threadId;
    markThreadStartedInUrl();
  }, [markThreadStartedInUrl, threadId]);
  const setContextUsageForThread = React.useCallback(
    (targetThreadId: string, usage: AssistantContextUsage | null) => {
      setContextUsageByThread((previous) =>
        usage
          ? setThreadContextUsage(previous, targetThreadId, usage)
          : clearThreadContextUsage(previous, targetThreadId),
      );
    },
    [],
  );
  const handleContextUsageEvent = React.useCallback(
    (event: ContextUsageStreamEvent) => {
      setContextUsageForThread(threadId, event);
    },
    [setContextUsageForThread, threadId],
  );
  const clearCurrentThreadContextUsage = React.useCallback(() => {
    setContextUsageForThread(threadId, null);
  }, [setContextUsageForThread, threadId]);
  const activeContextThreadId = sessionIdFromUrl ?? threadId;
  const contextUsage = React.useMemo(
    () => getThreadContextUsage(contextUsageByThread, activeContextThreadId),
    [activeContextThreadId, contextUsageByThread],
  );

  const chatAdapter = React.useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const latestUserMessage = [...messages]
          .reverse()
          .find((message) => message.role === "user");
        const message = getMessageText(latestUserMessage);
        const images = getMessageImages(latestUserMessage);

        if (!message && images.length === 0) {
          yield {
            content: [
              {
                type: "text",
                text: "I need a prompt or image before I can help.",
              },
            ],
            status: { type: "complete", reason: "stop" },
          };
          return;
        }

        let currentRunId: string | null = null;

        try {
          markThreadStarted();
          const model = selectedModelRef.current;
          const contextSnapshot = getAssistantContextSnapshot(docIdRef.current);
          const response = await requestAssistantChat({
            threadId,
            docId: docIdRef.current,
            message,
            images,
            model,
            mode: selectedModeRef.current,
            provider: getProviderForModel(model),
            reasoningEnabled: reasoningEnabledRef.current,
            context: contextSnapshot,
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

          yield* streamAssistantResponse(
            response.body,
            threadId,
            (runId) => {
              currentRunId = runId;
            },
            handleContextUsageEvent,
          );
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }

          // Auto-reconnect on network errors using standard SSE retry pattern
          if (isNetworkError(error) && currentRunId) {
            try {
              // Attempt to resume the stream with exponential backoff
              yield* resumeStreamWithRetry(
                threadId,
                currentRunId,
                abortSignal,
                handleContextUsageEvent,
              );
              return;
            } catch {
              // Resume failed after retries - show connection lost message
              yield buildTerminalAssistantMessage(
                "Connection lost. The response may still be generating. Please refresh to see the result.",
              );
              return;
            }
          }

          // Network error but no runId to resume with
          if (isNetworkError(error)) {
            yield buildTerminalAssistantMessage(
              "Connection lost. Please try again.",
            );
            return;
          }

          yield buildTerminalAssistantMessage(
            normalizeAssistantClientError(error),
          );
        }
      },
    }),
    [handleContextUsageEvent, markThreadStarted, threadId],
  );

  const runtime = useLocalRuntime(chatAdapter, { maxSteps: 1 });
  const [isHydratingSession, setIsHydratingSession] = React.useState(false);
  const [isResumingRun, setIsResumingRun] = React.useState(false);
  const { isOffline: isReconnecting } = useNetworkStatus();
  const hydrationControllerRef = React.useRef<AbortController | null>(null);
  const hydrationRequestIdRef = React.useRef(0);
  const didRestoreInitialSessionRef = React.useRef(false);
  const previousSessionIdFromUrlRef = React.useRef<string | null>(
    initialSessionId,
  );

  const cancelHydration = React.useCallback(() => {
    hydrationControllerRef.current?.abort();
    hydrationControllerRef.current = null;
    hydrationRequestIdRef.current += 1;
    setIsHydratingSession(false);
  }, []);

  const restoreThreadHistory = React.useCallback(
    async (targetThreadId: string) => {
      const normalizedThreadId = targetThreadId.trim();
      if (!normalizedThreadId) {
        return;
      }

      hydrationControllerRef.current?.abort();
      const controller = new AbortController();
      hydrationControllerRef.current = controller;
      const requestId = hydrationRequestIdRef.current + 1;
      hydrationRequestIdRef.current = requestId;
      setIsHydratingSession(true);

      try {
        runtime.thread.reset([]);
        const history = await fetchPersistedThreadHistory(
          normalizedThreadId,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          hydrationRequestIdRef.current !== requestId
        ) {
          return;
        }

        runtime.thread.reset(history);

        // Check if there's an active run that we need to wait for
        const resumeData = await fetchChatRunResume({
          threadId: normalizedThreadId,
          signal: controller.signal,
        });

        if (
          controller.signal.aborted ||
          hydrationRequestIdRef.current !== requestId
        ) {
          return;
        }

        if (resumeData) {
          const resumeEvents = Array.isArray(resumeData.events)
            ? resumeData.events
            : [];
          const latestContextUsage =
            getLatestContextUsageFromRunEvents(resumeEvents);
          if (latestContextUsage) {
            setContextUsageForThread(normalizedThreadId, latestContextUsage);
          }
        }

        if (resumeData?.run.status === "running") {
          setIsHydratingSession(false);
          setIsResumingRun(true);

          // Subscribe to SSE stream for remaining events
          const params = new URLSearchParams();
          params.set("threadId", normalizedThreadId);
          params.set("runId", resumeData.run.runId);
          params.set("stream", "true");

          try {
            const streamResponse = await fetch(
              `${getChatResumeUrl()}?${params}`,
              {
                method: "GET",
                credentials: CHAT_EXTERNAL_API_ENABLED
                  ? "include"
                  : "same-origin",
                signal: controller.signal,
              },
            );

            if (streamResponse.ok && streamResponse.body) {
              // Consume stream events and keep context usage synced while restoring.
              for await (const streamEvent of parseChatStream(
                streamResponse.body,
              )) {
                const usageEvent = parseAssistantContextUsageEvent(streamEvent);
                if (usageEvent) {
                  setContextUsageForThread(normalizedThreadId, usageEvent);
                }
              }
            }
          } catch (streamError) {
            if (!isAbortError(streamError)) {
              console.error("[assistant] Resume stream error:", streamError);
            }
          }

          // Run finished - refresh history to get the final result
          if (
            !controller.signal.aborted &&
            hydrationRequestIdRef.current === requestId
          ) {
            const updatedHistory = await fetchPersistedThreadHistory(
              normalizedThreadId,
              controller.signal,
            );
            if (
              !controller.signal.aborted &&
              hydrationRequestIdRef.current === requestId
            ) {
              runtime.thread.reset(updatedHistory);
            }
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        console.error("[assistant] Failed to restore thread history", error);
      } finally {
        if (hydrationRequestIdRef.current === requestId) {
          hydrationControllerRef.current = null;
          setIsHydratingSession(false);
          setIsResumingRun(false);
        }
      }
    },
    [runtime, setContextUsageForThread],
  );

  React.useEffect(() => {
    return () => {
      hydrationControllerRef.current?.abort();
      hydrationControllerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (didRestoreInitialSessionRef.current) {
      return;
    }
    didRestoreInitialSessionRef.current = true;

    if (!initialSessionId) {
      return;
    }

    void restoreThreadHistory(initialSessionId);
  }, [initialSessionId, restoreThreadHistory]);

  React.useEffect(() => {
    const previousSessionId = previousSessionIdFromUrlRef.current;
    if (previousSessionId === sessionIdFromUrl) {
      return;
    }
    previousSessionIdFromUrlRef.current = sessionIdFromUrl;

    if (pendingLocalSessionIdRef.current === sessionIdFromUrl) {
      pendingLocalSessionIdRef.current = undefined;
      return;
    }

    if (sessionIdFromUrl === threadId) {
      return;
    }

    cancelHydration();

    if (sessionIdFromUrl) {
      selectThreadInUrl(sessionIdFromUrl);
      void restoreThreadHistory(sessionIdFromUrl);
      return;
    }

    startNewThreadInUrl();
  }, [
    cancelHydration,
    restoreThreadHistory,
    selectThreadInUrl,
    sessionIdFromUrl,
    startNewThreadInUrl,
    threadId,
  ]);

  const startNewThread = React.useCallback(() => {
    pendingLocalSessionIdRef.current = null;
    cancelHydration();
    clearCurrentThreadContextUsage();
    startNewThreadInUrl();
  }, [cancelHydration, clearCurrentThreadContextUsage, startNewThreadInUrl]);

  const selectThread = React.useCallback(
    async (nextThreadId: string) => {
      const normalizedThreadId = nextThreadId.trim();
      if (!normalizedThreadId) {
        return;
      }

      pendingLocalSessionIdRef.current = normalizedThreadId;
      cancelHydration();
      selectThreadInUrl(normalizedThreadId);
      await restoreThreadHistory(normalizedThreadId);
    },
    [cancelHydration, restoreThreadHistory, selectThreadInUrl],
  );

  const isForkingRef = React.useRef(false);

  const forkConversation = React.useCallback(
    async (atMessageIndex: number) => {
      if (isForkingRef.current) {
        return;
      }

      isForkingRef.current = true;
      try {
        const response = await fetch(`/api/chat/history?action=fork`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceThreadId: threadId,
            atMessageIndex,
            docId: docIdRef.current,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            (errorData as { error?: string }).error ||
              "Failed to fork conversation",
          );
        }

        const data = await response.json();
        const newThreadId = (data as { newThreadId?: string }).newThreadId;

        if (!newThreadId) {
          throw new Error("No thread ID returned from fork");
        }

        // Switch to the new forked thread
        await selectThread(newThreadId);
      } finally {
        isForkingRef.current = false;
      }
    },
    [threadId, selectThread],
  );

  return {
    runtime,
    threadId,
    isHydratingSession,
    isResumingRun,
    isReconnecting,
    contextUsage,
    startNewThread,
    selectThread,
    forkConversation,
    isForkingRef,
    selectedModel,
    setSelectedModel: handleSelectModel,
    isModelPickerOpen,
    setIsModelPickerOpen,
    selectedMode,
    setSelectedMode: handleSelectMode,
    isModePickerOpen,
    setIsModePickerOpen,
    reasoningEnabled,
    setReasoningEnabled,
    reasoningEnabledRef,
    selectedModelLabel,
    selectedModeLabel,
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

const getMessageImages = (
  message: ThreadMessage | undefined,
): ChatImageInput[] => {
  if (!message) {
    return [];
  }

  return message.content
    .map((part) => {
      if (part.type !== "image" || typeof part.image !== "string") {
        return null;
      }

      const url = part.image.trim();
      if (!url) {
        return null;
      }

      return {
        url,
        ...(typeof part.filename === "string" && part.filename.trim().length > 0
          ? { filename: part.filename.trim() }
          : {}),
      };
    })
    .filter((part): part is ChatImageInput => part !== null);
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
  spreadsheet_getSheetMetadata: {
    running: "Reading sheet metadata",
    success: "Read sheet metadata",
    failed: "Failed to read sheet metadata",
  },
  spreadsheet_formatRange: {
    running: "Applying formatting",
    success: "Applied formatting",
    failed: "Failed to apply formatting",
  },
  spreadsheet_modifyRowsCols: {
    running: "Modifying rows/columns",
    success: "Modified rows/columns",
    failed: "Failed to modify rows/columns",
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
    running: "Reading spreadsheet",
    success: "Read spreadsheet",
    failed: "Failed to spreadsheet",
  },
  spreadsheet_getRowColMetadata: {
    running: "Reading row/column metadata",
    success: "Read row/column metadata",
    failed: "Failed to read row/column metadata",
  },
  spreadsheet_setRowColDimensions: {
    running: "Setting row/column dimensions",
    success: "Set row/column dimensions",
    failed: "Failed to set row/column dimensions",
  },
  spreadsheet_applyFill: {
    running: "Applying fill",
    success: "Applied fill",
    failed: "Failed to apply fill",
  },
  // Consolidated tools
  spreadsheet_clearCells: {
    running: "Clearing cells",
    success: "Cleared cells",
    failed: "Failed to clear cells",
  },
  spreadsheet_table: {
    running: "Managing table",
    success: "Table operation completed",
    failed: "Failed table operation",
  },
  spreadsheet_chart: {
    running: "Managing chart",
    success: "Chart operation completed",
    failed: "Failed chart operation",
  },
  spreadsheet_dataValidation: {
    running: "Managing data validation",
    success: "Data validation operation completed",
    failed: "Failed data validation operation",
  },
  spreadsheet_conditionalFormat: {
    running: "Managing conditional format",
    success: "Conditional format operation completed",
    failed: "Failed conditional format operation",
  },
  spreadsheet_getAuditSnapshot: {
    running: "Auditing spreadsheet",
    success: "Completed spreadsheet audit",
    failed: "Failed to audit spreadsheet",
  },
};

const formatToolNameFallback = (toolName: string) =>
  toolName
    .replace(/^spreadsheet_/, "")
    .replace(/_/g, " ")
    .trim();

// Dynamic copy generators for consolidated tools based on action
const CONSOLIDATED_TOOL_COPY: Record<
  string,
  Record<string, { running: string; success: string; failed: string }>
> = {
  spreadsheet_sheet: {
    create: {
      running: "Creating sheet",
      success: "Created sheet",
      failed: "Failed to create sheet",
    },
    update: {
      running: "Updating sheet",
      success: "Updated sheet",
      failed: "Failed to update sheet",
    },
    delete: {
      running: "Deleting sheet",
      success: "Deleted sheet",
      failed: "Failed to delete sheet",
    },
    duplicate: {
      running: "Duplicating sheet",
      success: "Duplicated sheet",
      failed: "Failed to duplicate sheet",
    },
  },
  spreadsheet_note: {
    set: {
      running: "Setting note",
      success: "Set note",
      failed: "Failed to set note",
    },
    delete: {
      running: "Deleting note",
      success: "Deleted note",
      failed: "Failed to delete note",
    },
  },
  spreadsheet_table: {
    create: {
      running: "Creating table",
      success: "Created table",
      failed: "Failed to create table",
    },
    update: {
      running: "Updating table",
      success: "Updated table",
      failed: "Failed to update table",
    },
    delete: {
      running: "Deleting table",
      success: "Deleted table",
      failed: "Failed to delete table",
    },
  },
  spreadsheet_chart: {
    create: {
      running: "Creating chart",
      success: "Created chart",
      failed: "Failed to create chart",
    },
    update: {
      running: "Updating chart",
      success: "Updated chart",
      failed: "Failed to update chart",
    },
    delete: {
      running: "Deleting chart",
      success: "Deleted chart",
      failed: "Failed to delete chart",
    },
  },
  spreadsheet_dataValidation: {
    create: {
      running: "Creating data validation",
      success: "Created data validation",
      failed: "Failed to create data validation",
    },
    update: {
      running: "Updating data validation",
      success: "Updated data validation",
      failed: "Failed to update data validation",
    },
    delete: {
      running: "Deleting data validation",
      success: "Deleted data validation",
      failed: "Failed to delete data validation",
    },
    query: {
      running: "Querying data validations",
      success: "Queried data validations",
      failed: "Failed to query data validations",
    },
  },
  spreadsheet_conditionalFormat: {
    create: {
      running: "Creating conditional format",
      success: "Created conditional format",
      failed: "Failed to create conditional format",
    },
    update: {
      running: "Updating conditional format",
      success: "Updated conditional format",
      failed: "Failed to update conditional format",
    },
    delete: {
      running: "Deleting conditional format",
      success: "Deleted conditional format",
      failed: "Failed to delete conditional format",
    },
    query: {
      running: "Querying conditional formats",
      success: "Queried conditional formats",
      failed: "Failed to query conditional formats",
    },
  },
  spreadsheet_clearCells: {
    values: {
      running: "Clearing cell values",
      success: "Cleared cell values",
      failed: "Failed to clear cell values",
    },
    formatting: {
      running: "Clearing cell formatting",
      success: "Cleared cell formatting",
      failed: "Failed to clear cell formatting",
    },
    all: {
      running: "Clearing cells",
      success: "Cleared cells",
      failed: "Failed to clear cells",
    },
  },
  spreadsheet_modifyRowsCols: {
    insert_row: {
      running: "Inserting rows",
      success: "Inserted rows",
      failed: "Failed to insert rows",
    },
    insert_column: {
      running: "Inserting columns",
      success: "Inserted columns",
      failed: "Failed to insert columns",
    },
    delete_row: {
      running: "Deleting rows",
      success: "Deleted rows",
      failed: "Failed to delete rows",
    },
    delete_column: {
      running: "Deleting columns",
      success: "Deleted columns",
      failed: "Failed to delete columns",
    },
  },
};

const getToolCopy = (
  toolName: string,
  parsedArgs?: Record<string, unknown>,
): ToolCopy => {
  // Check for consolidated tools with dynamic copy based on action
  const consolidatedCopy = CONSOLIDATED_TOOL_COPY[toolName];
  if (consolidatedCopy && parsedArgs) {
    // Args might be nested under 'input' property
    const args =
      typeof parsedArgs.input === "object" && parsedArgs.input !== null
        ? (parsedArgs.input as Record<string, unknown>)
        : parsedArgs;

    // For spreadsheet_clearCells, use the 'clear' field
    if (toolName === "spreadsheet_clearCells") {
      const clear = args.clear as string | undefined;
      if (clear && consolidatedCopy[clear]) {
        return consolidatedCopy[clear];
      }
    }
    // For spreadsheet_modifyRowsCols, combine action + dimension
    else if (toolName === "spreadsheet_modifyRowsCols") {
      const action = args.action as string | undefined;
      const dimension = args.dimension as string | undefined;
      if (action && dimension) {
        const key = `${action}_${dimension}`;
        if (consolidatedCopy[key]) {
          return consolidatedCopy[key];
        }
      }
    }
    // For other consolidated tools, use 'action' field
    else {
      const action = args.action as string | undefined;
      if (action && consolidatedCopy[action]) {
        return consolidatedCopy[action];
      }
    }
  }

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
      <Collapsible.Trigger className="inline-flex max-w-full items-center gap-2 rounded-md border border-(--card-border) bg-(--assistant-chip-bg) px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-(--assistant-chip-hover)">
        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
        <span>Thinking</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-(--muted-foreground) transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse data-[state=open]:animate-expand">
        {children}
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

function ImageLightbox({
  open,
  imageUrl,
  alt,
  onClose,
}: {
  open: boolean;
  imageUrl: string;
  alt: string;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/40 bg-black/75 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/90"
        aria-label="Close image preview"
        title="Close"
      >
        <X className="h-5 w-5 text-white" />
      </button>
      <img
        src={imageUrl}
        alt={alt}
        className="max-h-[90vh] max-w-[92vw] rounded-lg border border-white/20 bg-black object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-2.5 py-1 text-[11px] text-white/90">
        Press Esc to close
      </div>
    </div>,
    document.body,
  );
}

function UserImagePart() {
  const imagePart = useMessagePartImage();
  const imageUrl = imagePart.image?.trim();
  const [isLightboxOpen, setIsLightboxOpen] = React.useState(false);
  if (!imageUrl) {
    return null;
  }

  const altText = imagePart.filename || "Uploaded image";

  return (
    <div className="inline-flex max-w-full shrink-0">
      <ToolbarIconButton
        variant="ghost"
        type="button"
        onClick={() => setIsLightboxOpen(true)}
        aria-label="Open image preview"
        tooltip="Open image preview"
        className="p-0 border border-black/15 border-solid"
      >
        <img
          src={imageUrl}
          alt={altText}
          className="block h-16 w-auto max-w-[132px] rounded-lg object-contain"
          loading="lazy"
        />
      </ToolbarIconButton>
      <ImageLightbox
        open={isLightboxOpen}
        imageUrl={imageUrl}
        alt={altText}
        onClose={() => setIsLightboxOpen(false)}
      />
    </div>
  );
}

type MessageContentComponents = NonNullable<
  React.ComponentProps<typeof MessagePrimitive.Content>["components"]
>;

function StableMessageContent({
  components,
}: {
  components: MessageContentComponents;
}) {
  const partSignatures = useAuiState(
    useShallow((state) =>
      state.message.parts.map((part) => getStablePartSignature(part)),
    ),
  );

  const partTypes = React.useMemo(
    () =>
      partSignatures.map((signature) =>
        getStablePartTypeFromSignature(signature),
      ),
    [partSignatures],
  );
  const partKeys = React.useMemo(
    () =>
      partSignatures.map((signature, index) =>
        getStablePartRenderKeyFromSignature(signature, index),
      ),
    [partSignatures],
  );
  const ranges = React.useMemo(
    () => groupStableMessageParts(partTypes),
    [partTypes],
  );

  const ToolGroupComponent =
    "ToolGroup" in components && components.ToolGroup
      ? components.ToolGroup
      : ({ children }: React.PropsWithChildren) => children;
  const ReasoningGroupComponent =
    "ReasoningGroup" in components && components.ReasoningGroup
      ? components.ReasoningGroup
      : ({ children }: React.PropsWithChildren) => children;

  return (
    <>
      {ranges.map((range) => {
        if (range.type === "single") {
          return (
            <MessagePrimitive.PartByIndex
              key={partKeys[range.index] || `part:${range.index}`}
              index={range.index}
              components={components}
            />
          );
        }

        const indices = Array.from(
          { length: range.endIndex - range.startIndex + 1 },
          (_, offset) => range.startIndex + offset,
        );
        const groupKey = indices
          .map((index) => partKeys[index] || `part:${index}`)
          .join("|");

        if (range.type === "toolGroup") {
          return (
            <ToolGroupComponent
              key={`tool-group:${groupKey}`}
              startIndex={range.startIndex}
              endIndex={range.endIndex}
            >
              {indices.map((index) => (
                <MessagePrimitive.PartByIndex
                  key={partKeys[index] || `part:${index}`}
                  index={index}
                  components={components}
                />
              ))}
            </ToolGroupComponent>
          );
        }

        return (
          <ReasoningGroupComponent
            key={`reasoning-group:${groupKey}`}
            startIndex={range.startIndex}
            endIndex={range.endIndex}
          >
            {indices.map((index) => (
              <MessagePrimitive.PartByIndex
                key={partKeys[index] || `part:${index}`}
                index={index}
                components={components}
              />
            ))}
          </ReasoningGroupComponent>
        );
      })}
    </>
  );
}

function ToolCallDisplay({
  toolCallId,
  toolName,
  args,
  result,
}: {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
}) {
  const openStateKey = React.useMemo(() => `tool:${toolCallId}`, [toolCallId]);
  const [isOpen, setIsOpen] = React.useState(() => {
    return TOOL_CALL_OPEN_STATE.get(openStateKey) ?? false;
  });
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
  const parsedArgs = React.useMemo(() => deepParseJsonValue(args), [args]);
  const toolCopy = React.useMemo(
    () => getToolCopy(toolName, parsedArgs as Record<string, unknown>),
    [toolName, parsedArgs],
  );
  const titleText = isRunning
    ? toolCopy.running
    : isError
      ? toolCopy.failed
      : toolCopy.success;
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
  const handleNavigateInlineClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      navigateToRange();
    },
    [navigateToRange],
  );
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
      TOOL_CALL_OPEN_STATE.set(openStateKey, nextOpen);
    },
    [openStateKey],
  );

  React.useEffect(() => {
    setIsOpen(TOOL_CALL_OPEN_STATE.get(openStateKey) ?? false);
  }, [openStateKey]);

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
    <Collapsible.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Collapsible.Trigger asChild>
        <div
          className={cn(
            "inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors",
            isRunning
              ? "border-(--card-border) bg-(--assistant-chip-bg) text-foreground hover:bg-(--assistant-chip-hover)"
              : isError
                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                : "border-(--card-border) bg-(--assistant-chip-bg) text-foreground hover:bg-(--assistant-chip-hover)",
          )}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-violet-500" />
          <div className="min-w-0 flex-1 truncate">{titleText}</div>
          {range && (
            <span
              className="max-w-28 shrink-0 truncate rounded border border-(--card-border) bg-(--assistant-chip-hover) px-1.5 py-0.5 font-mono text-[10px] text-(--muted-foreground)"
              title={`Range: ${range}`}
            >
              {range}
            </span>
          )}
          {explanation && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-(--muted-foreground)">
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                className="max-w-xs text-xs whitespace-pre-wrap break-words"
              >
                {explanation}
              </TooltipContent>
            </Tooltip>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-(--muted-foreground) transition-transform",
              isOpen && "rotate-180",
            )}
          />
          <span className="h-3.5 w-px shrink-0 bg-(--card-border)" />
          {isComplete && canNavigateToRange && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleNavigateInlineClick}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-(--muted-foreground) transition-colors hover:bg-(--assistant-chip-hover) hover:text-foreground"
                  aria-label="Go to range"
                >
                  <Navigation className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" align="center" className="text-xs">
                Go to range
              </TooltipContent>
            </Tooltip>
          )}
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-(--muted-foreground)" />
          ) : isError ? (
            <X className="h-3.5 w-3.5 shrink-0 text-red-600" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          )}
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse data-[state=open]:animate-expand">
        {explanation && (
          <div className="mt-1.5 rounded-md border border-(--panel-border) bg-(--assistant-suggestion-bg) px-2 py-1.5">
            <p className="text-xs leading-relaxed text-foreground">
              {explanation}
            </p>
          </div>
        )}
        {isError && (
          <div className="mt-1 rounded border border-red-200 bg-red-100 p-2 text-red-800 text-xs">
            <div className="font-medium">Error</div>
            <div className="mt-1 font-mono text-[11px]">
              {errorMessage || "Unknown error"}
            </div>
          </div>
        )}
        <Tabs defaultValue="input" className="mt-2">
          <TabsList className="inline-flex h-7 gap-1 rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) p-0.5">
            <TabsTrigger
              value="input"
              className="h-6 rounded-md px-2.5 py-0.5 text-[10px] font-medium text-(--muted-foreground) transition-colors data-[state=active]:bg-(--assistant-tabs-active-bg) data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_2px_var(--card-shadow)]"
            >
              Input
            </TabsTrigger>
            <TabsTrigger
              value="output"
              className="h-6 rounded-md px-2.5 py-0.5 text-[10px] font-medium text-(--muted-foreground) transition-colors data-[state=active]:bg-(--assistant-tabs-active-bg) data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_2px_var(--card-shadow)]"
            >
              Output
            </TabsTrigger>
          </TabsList>
          <TabsContent value="input" className="mt-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => handleCopy(formattedArgs, "input")}
                className="absolute right-1 top-1 rounded p-1 text-(--muted-foreground) transition-colors hover:bg-(--assistant-chip-hover) hover:text-foreground"
                title="Copy to clipboard"
              >
                {copiedTab === "input" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-md border border-(--card-border) bg-(--card-bg-subtle) p-2 pr-8 font-mono text-[11px] leading-relaxed text-foreground">
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
                    "text-(--muted-foreground) hover:bg-(--assistant-chip-hover) hover:text-foreground",
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
                <pre className="max-h-64 overflow-y-auto overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-md border border-(--card-border) bg-(--card-bg-subtle) p-2 pr-8 font-mono text-[11px] leading-relaxed text-foreground">
                  {JSON.stringify(extractedResult, null, 2)}
                </pre>
              ) : (
                <div className="rounded-md border border-(--card-border) bg-(--card-bg-subtle) p-2 text-[11px] text-(--muted-foreground) italic">
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
  "spreadsheet_sheet", // Consolidated: create/update/delete sheet
  "spreadsheet_getSheetMetadata",
  "spreadsheet_formatRange",
  "spreadsheet_modifyRowsCols",
  "spreadsheet_queryRange",
  "spreadsheet_setIterativeMode",
  "spreadsheet_readDocument",
  "spreadsheet_getRowColMetadata",
  "spreadsheet_setRowColDimensions",
  "spreadsheet_applyFill",
  // Consolidated tools
  "spreadsheet_note",
  "spreadsheet_clearCells",
  "spreadsheet_table",
  "spreadsheet_chart",
  "spreadsheet_dataValidation",
  "spreadsheet_conditionalFormat",
  "spreadsheet_getAuditSnapshot",
] as const;

const TOOL_CALL_OPEN_STATE = new Map<string, boolean>();

function SpreadsheetToolUIRegistration({
  toolName,
}: {
  toolName: (typeof SPREADSHEET_TOOL_NAMES)[number];
}) {
  const renderToolPart = useInlineRender(
    ({
      toolName: renderedToolName,
      args,
      result,
      toolCallId,
    }: ToolCallMessagePartProps<Record<string, unknown>, unknown>) => (
      <div className="w-full maxx-w-md">
        {renderedToolName === "spreadsheet_sheet" &&
          (args as { action?: string })?.action === "create" && (
            <SpreadsheetCreateSheetSideEffect result={result} />
          )}
        <ToolCallDisplay
          toolCallId={toolCallId}
          toolName={renderedToolName}
          args={args}
          result={result}
        />
      </div>
    ),
  );

  const toolUI = React.useMemo<
    AssistantToolUIProps<Record<string, unknown>, unknown>
  >(
    () => ({
      toolName,
      render: renderToolPart,
    }),
    [renderToolPart, toolName],
  );

  useAssistantToolUI(toolUI);
  return null;
}

function SpreadsheetToolUIRegistry() {
  return SPREADSHEET_TOOL_NAMES.map((toolName) => (
    <SpreadsheetToolUIRegistration key={toolName} toolName={toolName} />
  ));
}

type ThreadMessagesComponents = NonNullable<
  React.ComponentProps<typeof ThreadPrimitive.Messages>["components"]
>;

function StableThreadMessages({
  components,
}: {
  components: ThreadMessagesComponents;
}) {
  const messageKeys = useAuiState(
    useShallow((state) =>
      state.thread.messages.map((message, index) =>
        getStableThreadMessageRenderKey(message.id, index),
      ),
    ),
  );

  return messageKeys.map((messageKey, index) => (
    <ThreadPrimitive.MessageByIndex
      key={messageKey}
      index={index}
      components={components}
    />
  ));
}

function AssistantMessageBody() {
  const { isAdmin } = React.useContext(AssistantDebugAccessContext);
  const forkContext = React.useContext(ForkContext);
  const role = useMessage((message) => message.role);
  const messageId = useMessage((message) => message.id);
  const userMessageText = useMessage((message) =>
    message.role !== "user"
      ? ""
      : message.content
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("")
          .trim(),
  );
  const hasUserText = userMessageText.length > 0;
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
    isAdmin &&
    role === "assistant" &&
    debugUrl &&
    !isMessageRunning &&
    hasAnyVisibleText;
  const [isUserCopySuccess, setIsUserCopySuccess] = React.useState(false);
  const assistantContentComponents = React.useMemo<MessageContentComponents>(
    () => ({
      Text: AssistantTextPart,
      Reasoning: () => (
        <div className="mt-1.5 rounded-md border border-(--card-border) bg-(--card-bg-subtle) p-2 text-xs text-foreground">
          <MarkdownText />
        </div>
      ),
      ReasoningGroup: ({ children }: React.PropsWithChildren) => (
        <div className="w-fit max-w-[92%]">
          <ReasoningBlock forceOpen={!isComplete}>{children}</ReasoningBlock>
        </div>
      ),
      ToolGroup: ({ children }: React.PropsWithChildren) => (
        <div className="w-full space-y-2">{children}</div>
      ),
    }),
    [isComplete],
  );
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

  // Fork button: compute message index and show for non-running assistant messages
  const threadMessages = useThread((thread) => thread.messages);
  const messageIndex = React.useMemo(() => {
    if (!messageId) return -1;
    return threadMessages.findIndex((m) => m.id === messageId);
  }, [threadMessages, messageId]);
  // Show fork button for assistant messages with visible text (not tool-call-only messages)
  const showForkButton =
    FORK_BUTTON_ENABLED &&
    role === "assistant" &&
    !isMessageRunning &&
    messageIndex >= 0 &&
    hasAnyVisibleText;
  const [isForking, setIsForking] = React.useState(false);
  const handleFork = React.useCallback(async () => {
    if (messageIndex < 0 || isForking) return;
    if (!forkContext) {
      console.warn("Fork context not available");
      return;
    }
    setIsForking(true);
    try {
      await forkContext.forkConversation(messageIndex);
    } catch (error) {
      console.error("Fork failed:", error);
    } finally {
      setIsForking(false);
    }
  }, [forkContext, messageIndex, isForking]);

  return (
    <div
      className={cn(
        "flex w-full",
        role === "user" ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "flex w-full flex-col gap-2",
          role === "user" && "items-end",
        )}
      >
        {role === "assistant" &&
          (hasAnyVisibleReasoning || hasAnyVisibleText || hasAnyToolCall) && (
            <StableMessageContent components={assistantContentComponents} />
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
            <div className="flex w-full flex-wrap justify-end gap-2">
              <MessagePrimitive.Content
                components={{
                  Text: () => null,
                  Image: UserImagePart,
                }}
              />
            </div>
            {hasUserText && (
              <Card className="rnc-assistant-bubble-user w-fit max-w-full border-black/10 bg-foreground text-white">
                <CardContent className="py-2 px-3">
                  <div className="whitespace-normal break-words text-sm leading-6 text-white/90">
                    <MessagePrimitive.Content
                      components={{
                        Text: MarkdownText,
                        Image: () => null,
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
            {hasUserText && (
              <IconButton
                tooltip="Copy"
                type="button"
                onClick={handleCopyUserMessage}
                aria-label="Copy message"
              >
                {isUserCopySuccess ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </IconButton>
            )}
          </div>
        )}
        {showDebugIcon || showForkButton ? (
          <div className="flex message-action-button">
            {showDebugIcon && (
              <IconButton tooltip="View in LangSmith" asChild>
                <a href={debugUrl} target="_blank" rel="noopener noreferrer">
                  <Bug className="h-3 w-3" />
                </a>
              </IconButton>
            )}
            {showForkButton && (
              <IconButton
                tooltip="Forl conversation from here"
                type="button"
                onClick={handleFork}
                disabled={isForking}
                title="Fork conversation from this point"
              >
                {isForking ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <GitFork className="h-3 w-3" />
                )}
              </IconButton>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root>
      <AssistantMessageBody />
    </MessagePrimitive.Root>
  );
}

// Re-export for convenience
export { AssistantRuntimeProvider };

/**
 * Captures spreadsheet context for chat request payloads.
 * Must be used inside an AssistantRuntimeProvider.
 */
export function SheetsInstructions({
  documentId,
  sheets,
  activeSheetId,
  activeCell,
  getViewPort,
  cellXfs,
  tables,
  theme,
  charts,
  namedRanges,
  getSheetName,
  getSheetProperties,
}: {
  documentId: string;
  sheets?: Sheet[];
  activeSheetId?: number;
  activeCell: CellInterface;
  getViewPort?: () => ViewPortProps | null;
  cellXfs?: CellXfs | null;
  tables?: TableView[] | null;
  theme?: SpreadsheetTheme;
  charts?: EmbeddedChart[];
  namedRanges?: NamedRange[];
  getSheetName?: ReturnType<typeof useSpreadsheetState>["getSheetName"];
  getSheetProperties?: ReturnType<
    typeof useSpreadsheetState
  >["getSheetProperties"];
}) {
  // Track viewport state, updated via scrollSubscriber
  const [viewport, setViewport] = React.useState<ViewPortProps | undefined>(
    () => getViewPort?.() ?? undefined,
  );

  // Subscribe to scroll events to keep viewport updated
  React.useEffect(() => {
    const subscription = scrollSubscriber.subscribe(() => {
      const newViewport = getViewPort?.() ?? undefined;
      setViewport(newViewport);
    });
    return () => subscription.unsubscribe();
  }, [getViewPort]);

  const sheetSummary = React.useMemo(
    () =>
      sheets?.map((s) => ({
        title: s.title,
        sheetId: s.sheetId,
        frozenRowCount: s.frozenRowCount,
        frozenColumnCount: s.frozenColumnCount,
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

  // Transform tables to simplified summary for LLM context
  const tableSummaries = React.useMemo<TableSummary[]>(() => {
    if (!tables) return [];
    return tables.map((table) => {
      const sheetProps = getSheetProperties?.(table.sheetId);
      const ref = selectionToAddress(
        { range: table.range },
        getSheetName?.(table.sheetId),
        undefined,
        sheetProps?.rowCount ?? MAX_ROW_COUNT,
        sheetProps?.columnCount ?? MAX_COLUMN_COUNT,
      );
      return {
        tableId: table.id,
        title: table.title,
        sheetId: table.sheetId,
        ref: ref ?? "",
        columns: table.columns?.map((c) => c.name) ?? [],
      };
    });
  }, [tables, getSheetName, getSheetProperties]);

  // Transform charts to simplified summary for LLM context
  const chartSummaries = React.useMemo<ChartSummary[]>(() => {
    if (!charts) return [];
    return charts.map((chart) => {
      const { dataRange } = chart.spec;
      let dataRangeA1: string | null = null;
      if (dataRange) {
        const sheetName = getSheetName?.(chart.position.sheetId);
        dataRangeA1 =
          selectionToAddress({ range: dataRange }, sheetName) ?? null;
      }
      return {
        chartId: chart.chartId,
        sheetId: chart.position.sheetId,
        title: chart.spec.title ?? null,
        subtitle: chart.spec.subtitle ?? null,
        chartType: chart.spec.chartType,
        dataRange: dataRangeA1,
      };
    });
  }, [charts, getSheetName]);

  // Transform named ranges to simplified summary for LLM context
  const namedRangeSummaries = React.useMemo<NamedRangeSummary[]>(() => {
    if (!namedRanges) return [];
    return namedRanges.flatMap((nr) => {
      if (!nr.range) return [];
      const sheetName = getSheetName?.(nr.range.sheetId);
      const ref = selectionToAddress({ range: nr.range }, sheetName);
      if (!ref) return [];
      return [
        {
          name: nr.name,
          ref,
          sheetId: nr.range.sheetId,
        },
      ];
    });
  }, [namedRanges, getSheetName]);

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

  const contextSnapshot = React.useMemo<SpreadsheetAssistantContext>(
    () => ({
      documentId,
      sheets: sheetSummary,
      activeSheetId,
      activeCell: {
        rowIndex: activeCell.rowIndex,
        columnIndex: activeCell.columnIndex,
        a1Address: activeCellA1Address,
      },
      viewport,
      cellXfs: cellXfs ? Object.fromEntries([...cellXfs]) : {},
      tables: tableSummaries,
      charts: chartSummaries,
      namedRanges: namedRangeSummaries,
      theme: themeColorMapping,
    }),
    [
      documentId,
      sheetSummary,
      activeSheetId,
      activeCell.rowIndex,
      activeCell.columnIndex,
      activeCellA1Address,
      viewport,
      cellXfs,
      tableSummaries,
      chartSummaries,
      namedRangeSummaries,
      themeColorMapping,
    ],
  );

  React.useEffect(() => {
    setAssistantContextSnapshot(documentId, contextSnapshot);
  }, [contextSnapshot, documentId]);

  React.useEffect(
    () => () => {
      clearAssistantContextSnapshot(documentId);
    },
    [documentId],
  );

  return null;
}

const NEW_SKILL_EDITOR_ID = "__new__";

function SkillsManagerButton({ iconOnly = false }: { iconOnly?: boolean }) {
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
      const response = await fetch(SKILLS_API_ENDPOINT, {
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
  }, []);

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
                name,
                description,
                instructions,
                active: draftIsActive,
              }
            : {
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
  ]);

  const deleteSkill = React.useCallback(async (skillId: string) => {
    setSkillsError("");
    setDeletingSkillId(skillId);
    try {
      const response = await fetch(SKILLS_API_ENDPOINT, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          skillId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete skill.");
      }

      setSkills((previous) => previous.filter((skill) => skill.id !== skillId));
      setEditorSkillId((previous) => (previous === skillId ? null : previous));
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
  }, []);

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
    [],
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
          iconOnly ? "px-2" : "gap-1.5 px-2.5 whitespace-nowrap",
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
                        Create reusable custom skills for your account. Active
                        skills are automatically applied to agent instructions.
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
                            onChange={(event) =>
                              setSearchTerm(event.target.value)
                            }
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
                          const isUpdatingThisSkill =
                            updatingSkillId === skill.id;
                          const isDeletingThisSkill =
                            deletingSkillId === skill.id;
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
                                        variant={
                                          skill.active ? "default" : "muted"
                                        }
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
                                          void toggleSkillActive(
                                            skill.id,
                                            checked,
                                          );
                                        }}
                                        disabled={
                                          isUpdatingThisSkill ||
                                          isDeletingThisSkill
                                        }
                                        aria-label={`Toggle ${skill.name} skill`}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPendingDeleteSkill(skill)
                                      }
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
                                  {skill.description ||
                                    "No description provided."}
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
                                  Skills are stored in Postgres for your
                                  account.
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
 * Shared props for assistant panel rendering.
 */
type WorkspaceAssistantPanelProps = {
  prompts: string[];
  docId?: string;
  isAdmin?: boolean;
  threadId?: string;
  onNewSession?: () => void;
  onSelectSession?: (threadId: string) => void | Promise<void>;
  onForkConversation?: (atMessageIndex: number) => Promise<void>;
  isForkingRef?: React.MutableRefObject<boolean>;
  isHydratingSession?: boolean;
  isResumingRun?: boolean;
  isReconnecting?: boolean;
  contextUsage?: AssistantContextUsage | null;
  selectedModel: string;
  selectedModelLabel: string;
  isModelPickerOpen: boolean;
  setIsModelPickerOpen: (open: boolean) => void;
  setSelectedModel: (model: string) => void;
  selectedMode: AssistantMode;
  selectedModeLabel: string;
  isModePickerOpen: boolean;
  setIsModePickerOpen: (open: boolean) => void;
  setSelectedMode: (mode: AssistantMode) => void;
  reasoningEnabled: boolean;
  setReasoningEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  reasoningEnabledRef: React.MutableRefObject<boolean>;
  forceCompactHeader?: boolean;
  onClose?: () => void;
};

const ASSISTANT_TAGLINE =
  "Plan edits, formulas, and workbook changes without leaving your sheet.";
const ASSISTANT_HEADER_COMPACT_WIDTH = 560;
const ASSISTANT_COMPOSER_COMPACT_WIDTH = 480;
const CONTEXT_USAGE_WARNING_COPY =
  "Create a new chat when context runs low for better AI performance.";

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
  imageCount: number;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: string; filename?: string }
  >;
};

type PanelImageDropPayload = {
  id: string;
  files: File[];
};

type AssistantComposerProps = Omit<WorkspaceAssistantPanelProps, "prompts"> & {
  hasCredits: boolean;
  panelImageDrop: PanelImageDropPayload | null;
  onPanelImageDropHandled: (dropId: string) => void;
};

const AssistantDebugAccessContext = React.createContext<{ isAdmin: boolean }>({
  isAdmin: false,
});

type ForkContextValue = {
  forkConversation: (atMessageIndex: number) => Promise<void>;
  threadId: string | undefined;
  docId: string | undefined;
  isForkingRef: React.MutableRefObject<boolean>;
};

const ForkContext = React.createContext<ForkContextValue | null>(null);

function AssistantComposer({
  selectedModel,
  selectedModelLabel,
  isModelPickerOpen,
  setIsModelPickerOpen,
  setSelectedModel,
  selectedMode,
  selectedModeLabel,
  isModePickerOpen,
  setIsModePickerOpen,
  setSelectedMode,
  reasoningEnabled,
  setReasoningEnabled,
  reasoningEnabledRef,
  contextUsage,
  forceCompactHeader = false,
  hasCredits,
  panelImageDrop,
  onPanelImageDropHandled,
}: AssistantComposerProps) {
  const composerFooterRef = React.useRef<HTMLDivElement | null>(null);
  const isTouchInput = useIsTouchInputDevice();
  const [isComposerCompact, setIsComposerCompact] =
    React.useState(forceCompactHeader);
  const handleSelectModel = React.useCallback(
    (model: string) => {
      setSelectedModel(model);
      setIsModelPickerOpen(false);
    },
    [setIsModelPickerOpen, setSelectedModel],
  );
  const handleSelectMode = React.useCallback(
    (mode: AssistantMode) => {
      setSelectedMode(mode);
      setIsModePickerOpen(false);
    },
    [setIsModePickerOpen, setSelectedMode],
  );
  const composerRuntime = useComposerRuntime();
  const threadRuntime = useThreadRuntime();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const dragDepthRef = React.useRef(0);
  const isThreadRunning = useThread((thread) => thread.isRunning);
  const composerText = useComposer((composer) => composer.text);
  const [composerImages, setComposerImages] = React.useState<
    ComposerImageAttachment[]
  >([]);
  const [composerLightboxImage, setComposerLightboxImage] = React.useState<{
    url: string;
    alt: string;
  } | null>(null);
  const composerImagesRef = React.useRef<ComposerImageAttachment[]>([]);
  const uploadAbortControllersRef = React.useRef<Map<string, AbortController>>(
    new Map(),
  );
  const [isDragActive, setIsDragActive] = React.useState(false);
  const [queuedMessages, setQueuedMessages] = React.useState<
    QueuedComposerMessage[]
  >([]);
  const [isReasoningPickerOpen, setIsReasoningPickerOpen] =
    React.useState(false);
  const queuedMessagesRef = React.useRef<QueuedComposerMessage[]>([]);
  const hasQueuedDispatchRef = React.useRef(false);
  const lastHandledPanelDropIdRef = React.useRef<string | null>(null);

  const releasePreviewUrl = React.useCallback((url?: string) => {
    if (url && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }, []);

  const abortAllComposerUploads = React.useCallback(() => {
    uploadAbortControllersRef.current.forEach((controller) => {
      controller.abort();
    });
    uploadAbortControllersRef.current.clear();
  }, []);

  const clearComposerImages = React.useCallback(() => {
    setComposerImages((previous) => {
      previous.forEach((image) => {
        const controller = uploadAbortControllersRef.current.get(image.id);
        if (controller) {
          controller.abort();
          uploadAbortControllersRef.current.delete(image.id);
        }
        releasePreviewUrl(image.previewUrl);
      });
      return [];
    });
  }, [releasePreviewUrl]);

  React.useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages]);

  React.useEffect(() => {
    queuedMessagesRef.current = queuedMessages;
  }, [queuedMessages]);

  React.useEffect(() => {
    return () => {
      abortAllComposerUploads();
      composerImagesRef.current.forEach((image) => {
        releasePreviewUrl(image.previewUrl);
      });
    };
  }, [abortAllComposerUploads, releasePreviewUrl]);

  React.useEffect(() => {
    if (forceCompactHeader) {
      setIsComposerCompact(true);
      return;
    }

    const footer = composerFooterRef.current;
    if (!footer) {
      setIsComposerCompact(isThreadRunning);
      return;
    }

    const updateComposerCompactState = () => {
      const { width } = footer.getBoundingClientRect();
      setIsComposerCompact(
        isThreadRunning || width < ASSISTANT_COMPOSER_COMPACT_WIDTH,
      );
    };

    updateComposerCompactState();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateComposerCompactState);
      return () => {
        window.removeEventListener("resize", updateComposerCompactState);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateComposerCompactState();
    });
    resizeObserver.observe(footer);

    return () => {
      resizeObserver.disconnect();
    };
  }, [forceCompactHeader, isThreadRunning]);

  const getReadyComposerImageParts = React.useCallback(() => {
    return composerImagesRef.current
      .filter(
        (image): image is ComposerImageAttachment & { imageUrl: string } =>
          image.status === "ready" &&
          typeof image.imageUrl === "string" &&
          image.imageUrl.trim().length > 0,
      )
      .map((image) => ({
        type: "image" as const,
        image: image.imageUrl.trim(),
        ...(image.filename ? { filename: image.filename } : {}),
      }));
  }, []);

  const getCurrentComposerPayload = React.useCallback(() => {
    const text = composerRuntime.getState().text.trim();
    const imageParts = getReadyComposerImageParts();
    const content: QueuedComposerMessage["content"] = [];
    if (text) {
      content.push({ type: "text", text });
    }
    content.push(...imageParts);
    return {
      text,
      imageParts,
      content,
    };
  }, [composerRuntime, getReadyComposerImageParts]);

  const addImageFilesToComposer = React.useCallback(async (files: File[]) => {
    const imageFiles = files.filter((file) => isSupportedImageFile(file));
    if (imageFiles.length === 0) {
      return;
    }

    const slotsRemaining = Math.max(
      0,
      ASSISTANT_MAX_COMPOSER_IMAGES - composerImagesRef.current.length,
    );
    const filesToProcess = imageFiles.slice(0, slotsRemaining);
    if (filesToProcess.length === 0) {
      return;
    }

    const pendingAttachments = filesToProcess.map((file) => ({
      id: uuidString(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setComposerImages((previous) => [
      ...pendingAttachments.map(({ id, file, previewUrl }) => ({
        id,
        filename: file.name,
        status: "uploading" as const,
        uploadProgress: 0,
        previewUrl,
        contentType: file.type || undefined,
        sizeBytes: file.size,
      })),
      ...previous,
    ]);

    void Promise.allSettled(
      pendingAttachments.map(async ({ id, file }) => {
        const uploadController = new AbortController();
        uploadAbortControllersRef.current.set(id, uploadController);
        try {
          setComposerImages((previous) =>
            previous.map((image) =>
              image.id === id
                ? {
                    ...image,
                    uploadProgress: Math.max(5, image.uploadProgress ?? 0),
                  }
                : image,
            ),
          );

          let uploadFile = file;
          try {
            const resizedImage = await resizeImageForAssistant(file);
            uploadFile = resizedImage.file;
            setComposerImages((previous) =>
              previous.map((image) =>
                image.id === id
                  ? {
                      ...image,
                      uploadProgress: Math.max(15, image.uploadProgress ?? 0),
                      width: resizedImage.width,
                      height: resizedImage.height,
                      contentType: resizedImage.contentType,
                      sizeBytes: resizedImage.sizeBytes,
                    }
                  : image,
              ),
            );
          } catch (resizeError) {
            if (!isHeicLikeFile(file)) {
              throw resizeError;
            }
            // Some browsers cannot decode HEIC for canvas resizing.
            // Upload raw HEIC/HEIF and let the server convert + resize.
            setComposerImages((previous) =>
              previous.map((image) =>
                image.id === id
                  ? {
                      ...image,
                      uploadProgress: Math.max(15, image.uploadProgress ?? 0),
                      contentType: file.type || image.contentType,
                      sizeBytes: file.size,
                    }
                  : image,
              ),
            );
          }

          let lastProgressPercent = 15;
          const uploadedImage = await uploadAssistantImage({
            file: uploadFile,
            signal: uploadController.signal,
            onProgress: (fraction) => {
              const nextProgressPercent = Math.min(
                99,
                Math.max(15, Math.round(fraction * 100)),
              );
              if (nextProgressPercent === lastProgressPercent) {
                return;
              }
              lastProgressPercent = nextProgressPercent;
              setComposerImages((previous) =>
                previous.map((image) =>
                  image.id === id
                    ? {
                        ...image,
                        uploadProgress: nextProgressPercent,
                      }
                    : image,
                ),
              );
            },
          });
          setComposerImages((previous) =>
            previous.map((image) =>
              image.id === id
                ? {
                    ...image,
                    status: "ready",
                    uploadProgress: 100,
                    filename:
                      uploadedImage.filename?.trim() ||
                      image.filename ||
                      uploadFile.name,
                    imageUrl: uploadedImage.url,
                    contentType: uploadedImage.contentType || image.contentType,
                    sizeBytes: uploadedImage.sizeBytes ?? image.sizeBytes,
                  }
                : image,
            ),
          );
        } catch (error) {
          setComposerImages((previous) =>
            previous.map((image) =>
              image.id === id
                ? {
                    ...image,
                    status: "error",
                    error: normalizeAssistantClientError(error),
                  }
                : image,
            ),
          );
        } finally {
          uploadAbortControllersRef.current.delete(id);
        }
      }),
    );
  }, []);

  const hasUploadingImages = composerImages.some(
    (image) => image.status === "uploading",
  );
  const hasReadyImages = composerImages.some(
    (image) => image.status === "ready",
  );
  const canSendFromComposer =
    (composerText.trim().length > 0 || hasReadyImages) && !hasUploadingImages;

  const enqueueCurrentComposerMessage = React.useCallback(() => {
    if (
      composerImagesRef.current.some((image) => image.status === "uploading")
    ) {
      return false;
    }

    const payload = getCurrentComposerPayload();
    if (payload.content.length === 0) {
      return false;
    }

    setQueuedMessages((previous) => [
      {
        id: uuidString(),
        text: payload.text,
        imageCount: payload.imageParts.length,
        content: payload.content,
      },
      ...previous,
    ]);
    composerRuntime.setText("");
    clearComposerImages();
    return true;
  }, [clearComposerImages, composerRuntime, getCurrentComposerPayload]);

  const sendCurrentComposerMessage = React.useCallback(() => {
    if (
      composerImagesRef.current.some((image) => image.status === "uploading")
    ) {
      return false;
    }

    const payload = getCurrentComposerPayload();
    if (payload.content.length === 0) {
      return false;
    }

    threadRuntime.append({
      content: payload.content,
      runConfig: composerRuntime.getState().runConfig,
      startRun: true,
    });
    composerRuntime.setText("");
    clearComposerImages();
    return true;
  }, [
    clearComposerImages,
    composerRuntime,
    getCurrentComposerPayload,
    threadRuntime,
  ]);

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

    sendCurrentComposerMessage();
  }, [
    canSendFromComposer,
    enqueueCurrentComposerMessage,
    hasCredits,
    isThreadRunning,
    sendCurrentComposerMessage,
  ]);

  const handleStopRun = React.useCallback(() => {
    if (!isThreadRunning) {
      return;
    }

    threadRuntime.cancelRun();
  }, [isThreadRunning, threadRuntime]);

  const handleQueueOnEnter = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.nativeEvent.isComposing ||
        event.key !== "Enter" ||
        event.shiftKey
      ) {
        return;
      }

      event.preventDefault();
      handleSendOrQueue();
    },
    [handleSendOrQueue],
  );

  const handleComposerInputPaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedFiles = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(
          (file): file is File => file !== null && isSupportedImageFile(file),
        );

      if (pastedFiles.length === 0) {
        return;
      }

      event.preventDefault();
      void addImageFilesToComposer(pastedFiles);
    },
    [addImageFilesToComposer],
  );

  const handleFileInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length === 0) {
        return;
      }

      void addImageFilesToComposer(files);
    },
    [addImageFilesToComposer],
  );

  const handleAttachClick = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRemoveComposerImage = React.useCallback(
    (imageId: string) => {
      const controller = uploadAbortControllersRef.current.get(imageId);
      if (controller) {
        controller.abort();
        uploadAbortControllersRef.current.delete(imageId);
      }
      setComposerImages((previous) => {
        const nextImages = previous.filter((image) => image.id !== imageId);
        const removedImage = previous.find((image) => image.id === imageId);
        releasePreviewUrl(removedImage?.previewUrl);
        return nextImages;
      });
    },
    [releasePreviewUrl],
  );

  const handleComposerDragEnter = React.useCallback(
    (event: React.DragEvent<HTMLFormElement>) => {
      if (
        !hasImageFilesInDataTransfer(event.dataTransfer, {
          allowUnknownFiles: true,
        })
      ) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragActive(true);
    },
    [],
  );

  const handleComposerDragOver = React.useCallback(
    (event: React.DragEvent<HTMLFormElement>) => {
      if (
        !hasImageFilesInDataTransfer(event.dataTransfer, {
          allowUnknownFiles: true,
        })
      ) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const handleComposerDragLeave = React.useCallback(
    (event: React.DragEvent<HTMLFormElement>) => {
      if (!isDragActive) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragActive(false);
      }
    },
    [isDragActive],
  );

  const handleComposerDrop = React.useCallback(
    (event: React.DragEvent<HTMLFormElement>) => {
      if (
        !hasImageFilesInDataTransfer(event.dataTransfer, {
          allowUnknownFiles: true,
        })
      ) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragActive(false);
    },
    [],
  );

  React.useEffect(() => {
    if (!panelImageDrop || panelImageDrop.files.length === 0) {
      return;
    }
    if (lastHandledPanelDropIdRef.current === panelImageDrop.id) {
      return;
    }

    lastHandledPanelDropIdRef.current = panelImageDrop.id;
    void addImageFilesToComposer(panelImageDrop.files);
    onPanelImageDropHandled(panelImageDrop.id);
  }, [addImageFilesToComposer, onPanelImageDropHandled, panelImageDrop]);

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
      content: nextMessage.content,
      runConfig: composerRuntime.getState().runConfig,
      startRun: true,
    });
  }, [composerRuntime, isThreadRunning, threadRuntime]);

  return (
    <ComposerPrimitive.Root
      onDragEnter={handleComposerDragEnter}
      onDragOver={handleComposerDragOver}
      onDragLeave={handleComposerDragLeave}
      onDrop={handleComposerDrop}
      className={cn(
        "rnc-assistant-composer overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)]",
        isDragActive &&
          "border-(--accent) ring-2 ring-(--accent)/30 ring-offset-0",
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      {queuedMessages.length > 0 && (
        <div className="rnc-assistant-muted-surface max-h-32 overflow-y-auto border-b border-black/8 bg-[#fff9f4] px-3 py-2">
          <div className="space-y-2">
            {queuedMessages.map((queuedMessage) => (
              <div
                key={queuedMessage.id}
                className="rnc-assistant-item flex items-center gap-2 rounded-lg border border-black/10 bg-white px-2 py-1.5"
              >
                <p className="flex-1 text-xs leading-5 text-foreground">
                  {queuedMessage.text ||
                    `${queuedMessage.imageCount} image${queuedMessage.imageCount === 1 ? "" : "s"}`}
                  {queuedMessage.text && queuedMessage.imageCount > 0
                    ? ` (${queuedMessage.imageCount} image${queuedMessage.imageCount === 1 ? "" : "s"})`
                    : ""}
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
      {composerImages.length > 0 && (
        <div className="rnc-assistant-muted-surface max-h-40 border-b border-black/8 bg-[#fff9f4] px-3 py-2">
          <div className="flex flex-wrap gap-2">
            {composerImages.map((image) => (
              <div
                key={image.id}
                className="group relative flex h-12 w-12 items-center justify-center rounded-lg border border-(--card-border) bg-(--card-bg-solid)"
                title={
                  image.status === "error"
                    ? image.error || "Upload failed"
                    : image.filename
                }
              >
                {image.previewUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      setComposerLightboxImage({
                        url: image.previewUrl as string,
                        alt: image.filename || "Attached image",
                      })
                    }
                    className="p-0 cursor-zoom-in w-full h-full"
                    aria-label="Open image preview"
                    title="Open image preview"
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.filename}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ) : (
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                )}
                <IconButton
                  type="button"
                  onClick={() => handleRemoveComposerImage(image.id)}
                  className={cn(
                    "absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full",
                    "border border-white/20 bg-black/55 text-white shadow-sm backdrop-blur-sm",
                    "opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100",
                    "hover:border-[#fca5a5] hover:bg-[#d94848]",
                  )}
                  aria-label="Remove image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
                {image.status === "uploading" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-white">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="mt-1 text-[9px] font-medium">
                      {Math.min(
                        99,
                        Math.max(0, Math.round(image.uploadProgress ?? 0)),
                      )}
                      %
                    </span>
                    <div className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-white/30">
                      <div
                        className="h-full rounded-full bg-white transition-[width] duration-150 ease-out"
                        style={{
                          width: `${Math.min(99, Math.max(4, Math.round(image.uploadProgress ?? 0)))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {image.status === "error" && (
                  <div className="absolute inset-x-0 bottom-0 bg-[#7a1e1e]/90 px-1 py-0.5 text-[9px] text-white">
                    Error
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <ImageLightbox
        open={composerLightboxImage !== null}
        imageUrl={composerLightboxImage?.url ?? ""}
        alt={composerLightboxImage?.alt ?? "Attached image"}
        onClose={() => setComposerLightboxImage(null)}
      />
      <div className="px-4 pt-4">
        <ComposerPrimitive.Input
          rows={3}
          onKeyDown={handleQueueOnEnter}
          submitMode="none"
          onPaste={handleComposerInputPaste}
          addAttachmentOnPaste={false}
          placeholder="Type to start sending a message"
          className={cn(
            "min-h-10 sm:min-h-14 max-h-48 w-full resize-none border-0 bg-transparent px-0 py-0 leading-6 text-foreground outline-none transition placeholder:text-[#7e8da7] focus-visible:ring-0",
            isTouchInput ? "text-base" : "text-sm",
          )}
        />
      </div>
      <div
        ref={composerFooterRef}
        className="flex items-center justify-between border-t border-black/8 px-3 py-2"
      >
        <div className="flex items-center gap-2">
          <IconButton
            tooltip="Attach image"
            type="button"
            onClick={handleAttachClick}
            className="rnc-assistant-chip inline-flex h-8 w-8 items-center justify-center rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) text-(--muted-foreground) shadow-none transition hover:bg-(--assistant-chip-hover) hover:text-foreground"
            aria-label="Attach image"
            title="Attach image"
            disabled={composerImages.length >= ASSISTANT_MAX_COMPOSER_IMAGES}
          >
            <Paperclip className="h-3.5 w-3.5" />
          </IconButton>
          <Popover open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
            <PopoverTrigger asChild>
              {isComposerCompact ? (
                <IconButton
                  tooltip={`Model: ${selectedModelLabel}`}
                  type="button"
                  variant="secondary"
                  size="sm"
                  role="combobox"
                  aria-expanded={isModelPickerOpen}
                  aria-label={`Select model. Current model: ${selectedModelLabel}`}
                  title={`Model: ${selectedModelLabel}`}
                  className="rnc-assistant-chip h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-[#faf6f0] px-0 text-foreground shadow-none hover:bg-[#f6ede2]"
                >
                  <Cpu className="h-3.5 w-3.5" />
                </IconButton>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  role="combobox"
                  aria-expanded={isModelPickerOpen}
                  aria-label="Select model"
                  className="rnc-assistant-chip h-8 min-w-36 sm:min-w-44 justify-between rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2]"
                >
                  <span className="truncate">{selectedModelLabel}</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
                </Button>
              )}
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72 p-0"
              onOpenAutoFocus={(event) => {
                if (isTouchInput) {
                  event.preventDefault();
                }
              }}
            >
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
          <Popover open={isModePickerOpen} onOpenChange={setIsModePickerOpen}>
            <PopoverTrigger asChild>
              <IconButton
                tooltip={`Mode: ${selectedModeLabel}`}
                type="button"
                variant="secondary"
                size="sm"
                role="combobox"
                aria-expanded={isModePickerOpen}
                aria-label={`Select mode. Current mode: ${selectedModeLabel}`}
                title={`Mode: ${selectedModeLabel}`}
                className="rnc-assistant-chip h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-[#faf6f0] px-0 text-foreground shadow-none hover:bg-[#f6ede2]"
              >
                <FileText className="h-3.5 w-3.5" />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-0">
              <Command>
                <CommandList>
                  <CommandEmpty>No mode found.</CommandEmpty>
                  <CommandGroup>
                    {MODE_OPTIONS.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={`${option.label} ${option.value}`}
                        onSelect={() => handleSelectMode(option.value)}
                        className="text-xs"
                      >
                        <Check
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            selectedMode === option.value
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <span className="truncate">{option.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <ContextUsageTooltipTrigger
            contextUsage={contextUsage}
            warningCopy={CONTEXT_USAGE_WARNING_COPY}
          />
          <Popover
            open={isReasoningPickerOpen}
            onOpenChange={setIsReasoningPickerOpen}
          >
            <PopoverTrigger asChild>
              <IconButton
                tooltip={reasoningEnabled ? "Reasoning On" : "Reasoning Off"}
                variant="unstyled"
                type="button"
                role="combobox"
                aria-expanded={isReasoningPickerOpen}
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
            </PopoverTrigger>
            <PopoverContent align="start" className="w-48 p-0">
              <Command>
                <CommandList>
                  <CommandGroup>
                    <CommandItem
                      value="Reasoning on"
                      onSelect={() => {
                        reasoningEnabledRef.current = true;
                        setReasoningEnabled(true);
                        setIsReasoningPickerOpen(false);
                      }}
                      className="text-xs"
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          reasoningEnabled ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">Reasoning on</span>
                    </CommandItem>
                    <CommandItem
                      value="Reasoning off"
                      onSelect={() => {
                        reasoningEnabledRef.current = false;
                        setReasoningEnabled(false);
                        setIsReasoningPickerOpen(false);
                      }}
                      className="text-xs"
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          reasoningEnabled ? "opacity-0" : "opacity-100",
                        )}
                      />
                      <span className="truncate">Reasoning off</span>
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2">
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

function AssistantStatusOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-(--assistant-overlay-backdrop) backdrop-blur-[1px]">
      <div className="inline-flex items-center gap-2 rounded-lg border border-(--panel-border) bg-background px-3 py-2 text-sm text-foreground shadow-lg">
        <Loader2 className="h-4 w-4 animate-spin text-(--accent)" />
        {label}
      </div>
    </div>
  );
}

function WorkspaceAssistantPanel({
  prompts,
  docId,
  isAdmin = false,
  threadId,
  onNewSession,
  onSelectSession,
  onForkConversation,
  isForkingRef,
  isHydratingSession = false,
  isResumingRun = false,
  isReconnecting = false,
  contextUsage,
  selectedModel,
  selectedModelLabel,
  isModelPickerOpen,
  setIsModelPickerOpen,
  setSelectedModel,
  selectedMode,
  selectedModeLabel,
  isModePickerOpen,
  setIsModePickerOpen,
  setSelectedMode,
  reasoningEnabled,
  setReasoningEnabled,
  reasoningEnabledRef,
  forceCompactHeader = false,
  onClose,
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
  const hasCredits =
    isUnlimitedCredits ||
    remainingCredits === null ||
    remainingCredits >= MIN_CREDITS_PER_RUN;
  const [isRestoringSessionFromPicker, setIsRestoringSessionFromPicker] =
    React.useState(false);
  const panelDragDepthRef = React.useRef(0);
  const [isPanelImageDragActive, setIsPanelImageDragActive] =
    React.useState(false);
  const [panelImageDrop, setPanelImageDrop] =
    React.useState<PanelImageDropPayload | null>(null);
  const clearPanelDragState = React.useCallback(() => {
    panelDragDepthRef.current = 0;
    setIsPanelImageDragActive(false);
  }, []);

  // Fork context: use provided ref or create a fallback
  const fallbackForkingRef = React.useRef(false);
  const actualForkingRef = isForkingRef ?? fallbackForkingRef;
  const forkContextValue = React.useMemo<ForkContextValue | null>(
    () =>
      onForkConversation
        ? {
            forkConversation: onForkConversation,
            threadId,
            docId,
            isForkingRef: actualForkingRef,
          }
        : null,
    [onForkConversation, threadId, docId, actualForkingRef],
  );

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

  const handleSessionRestoreStart = React.useCallback(() => {
    setIsRestoringSessionFromPicker(true);
  }, []);

  React.useEffect(() => {
    if (!isRestoringSessionFromPicker) {
      return;
    }
    if (isHydratingSession) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsRestoringSessionFromPicker(false);
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isHydratingSession, isRestoringSessionFromPicker]);

  const handlePanelDragEnter = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (
        !hasImageFilesInDataTransfer(event.dataTransfer, {
          allowUnknownFiles: true,
        })
      ) {
        return;
      }

      event.preventDefault();
      panelDragDepthRef.current += 1;
      setIsPanelImageDragActive(true);
    },
    [],
  );

  const handlePanelDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (
        !hasImageFilesInDataTransfer(event.dataTransfer, {
          allowUnknownFiles: true,
        })
      ) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const handlePanelDragLeave = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isPanelImageDragActive) {
        return;
      }

      event.preventDefault();
      const relatedTarget = event.relatedTarget as Node | null;
      if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
        return;
      }

      panelDragDepthRef.current = Math.max(0, panelDragDepthRef.current - 1);
      const bounds = event.currentTarget.getBoundingClientRect();
      const isPointerInsideBounds =
        event.clientX > bounds.left &&
        event.clientX < bounds.right &&
        event.clientY > bounds.top &&
        event.clientY < bounds.bottom;
      if (panelDragDepthRef.current === 0 || !isPointerInsideBounds) {
        clearPanelDragState();
      }
    },
    [clearPanelDragState, isPanelImageDragActive],
  );

  const handlePanelDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (
        !hasImageFilesInDataTransfer(event.dataTransfer, {
          allowUnknownFiles: true,
        })
      ) {
        return;
      }

      event.preventDefault();
      clearPanelDragState();
      const files = getImageFilesFromDataTransfer(event.dataTransfer);
      if (files.length === 0) {
        return;
      }

      setPanelImageDrop({
        id: uuidString(),
        files,
      });
    },
    [clearPanelDragState],
  );

  React.useEffect(() => {
    if (!isPanelImageDragActive) {
      return;
    }

    const handleGlobalDragEnd = () => {
      clearPanelDragState();
    };

    window.addEventListener("drop", handleGlobalDragEnd);
    window.addEventListener("dragend", handleGlobalDragEnd);
    window.addEventListener("blur", handleGlobalDragEnd);
    return () => {
      window.removeEventListener("drop", handleGlobalDragEnd);
      window.removeEventListener("dragend", handleGlobalDragEnd);
      window.removeEventListener("blur", handleGlobalDragEnd);
    };
  }, [clearPanelDragState, isPanelImageDragActive]);

  const handlePanelImageDropHandled = React.useCallback((dropId: string) => {
    setPanelImageDrop((current) => (current?.id === dropId ? null : current));
  }, []);

  return (
    <Card
      onDragEnter={handlePanelDragEnter}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
      className={cn(
        "rnc-assistant-panel relative flex h-full min-h-128 flex-col overflow-hidden rounded-lg border-(--card-border) bg-(--assistant-panel-bg) transition-colors",
        isPanelImageDragActive &&
          "border-(--accent) ring-2 ring-(--accent)/35 ring-offset-0",
      )}
    >
      <div
        ref={assistantHeaderRef}
        className="rnc-assistant-divider border-b border-black/8 px-5 py-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="display-font mt-1 whitespace-nowrap text-lg font-semibold tracking-[-0.03em] sm:text-2xl">
              Spreadsheet Agent
            </h2>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <SkillsManagerButton iconOnly={isAssistantHeaderCompact} />
            {onSelectSession && (
              <SessionPickerButton
                iconOnly
                currentThreadId={threadId}
                onSelectSession={onSelectSession}
                onSessionRestoreStart={handleSessionRestoreStart}
                onStartNewSession={onNewSession}
                onRestoreModel={setSelectedModel}
              />
            )}
            <NewSessionButton iconOnly onNewSession={onNewSession} />

            <CreditsPopoverButton
              isCreditsLoading={isCreditsLoading}
              isUnlimitedCredits={isUnlimitedCredits}
              remainingCredits={remainingCredits}
              dailyLimit={INITIAL_CREDITS}
            />
            {onClose && !forceCompactHeader && (
              <IconButton
                tooltip="Minimize Assistant"
                size="sm"
                onClick={onClose}
              >
                <Minus className="h-4 w-4" />
              </IconButton>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm leading-6 text-(--muted-foreground)">
          {ASSISTANT_TAGLINE}
        </p>
      </div>

      <AssistantDebugAccessContext.Provider value={{ isAdmin }}>
        <ForkContext.Provider value={forkContextValue}>
          <ThreadPrimitive.Root
            key={threadId || "active-thread"}
            className={cn("relative flex min-h-0 flex-1 flex-col")}
          >
            <SpreadsheetToolUIRegistry />
            <ThreadPrimitive.Viewport
              className={cn(
                "min-h-0 overflow-y-auto px-5",
                isThreadEmpty ? "h-0 flex-none py-0" : "flex-1 py-5",
              )}
            >
              <div className="space-y-4">
                <StableThreadMessages
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
                isThreadEmpty
                  ? "my-auto border-t-0"
                  : "border-t border-black/8",
              )}
            >
              <div className={cn("w-full", isThreadEmpty ? "space-y-3" : "")}>
                <AssistantComposer
                  selectedModel={selectedModel}
                  selectedModelLabel={selectedModelLabel}
                  isModelPickerOpen={isModelPickerOpen}
                  setIsModelPickerOpen={setIsModelPickerOpen}
                  setSelectedModel={setSelectedModel}
                  selectedMode={selectedMode}
                  selectedModeLabel={selectedModeLabel}
                  isModePickerOpen={isModePickerOpen}
                  setIsModePickerOpen={setIsModePickerOpen}
                  setSelectedMode={setSelectedMode}
                  reasoningEnabled={reasoningEnabled}
                  setReasoningEnabled={setReasoningEnabled}
                  reasoningEnabledRef={reasoningEnabledRef}
                  contextUsage={contextUsage}
                  forceCompactHeader={forceCompactHeader}
                  hasCredits={hasCredits}
                  panelImageDrop={panelImageDrop}
                  onPanelImageDropHandled={handlePanelImageDropHandled}
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
            {(isHydratingSession || isRestoringSessionFromPicker) && (
              <AssistantStatusOverlay label="Restoring session..." />
            )}
            {isResumingRun && (
              <AssistantStatusOverlay label="Continuing response..." />
            )}
            {isReconnecting && (
              <AssistantStatusOverlay label="Reconnecting..." />
            )}
          </ThreadPrimitive.Root>
        </ForkContext.Provider>
      </AssistantDebugAccessContext.Provider>
      {isPanelImageDragActive && (
        <div className="pointer-events-none absolute inset-0 z-15 flex items-center justify-center backdrop-blur-[1px] bg-(--assistant-overlay-backdrop)">
          <div className="absolute inset-2 rounded-xl border-2 border-dashed border-(--accent)/70" />
          <div className="mx-4 inline-flex items-center gap-2 rounded-xl border border-(--accent)/45 bg-background/90 px-4 py-2 text-sm text-foreground shadow-lg">
            <ImageIcon className="h-4 w-4 text-(--accent)" />
            <span>Drop images anywhere to attach</span>
          </div>
        </div>
      )}
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
  threadId,
  onNewSession,
  onSelectSession,
  onForkConversation,
  isForkingRef,
  isHydratingSession,
  isResumingRun,
  isReconnecting,
  contextUsage,
  selectedModel,
  selectedModelLabel,
  isModelPickerOpen,
  setIsModelPickerOpen,
  setSelectedModel,
  selectedMode,
  selectedModeLabel,
  isModePickerOpen,
  setIsModePickerOpen,
  setSelectedMode,
  reasoningEnabled,
  setReasoningEnabled,
  reasoningEnabledRef,
  forceCompactHeader,
  onClose,
}: WorkspaceAssistantUIProps) {
  return (
    <WorkspaceAssistantPanel
      prompts={prompts}
      docId={docId}
      isAdmin={isAdmin}
      threadId={threadId}
      onNewSession={onNewSession}
      onSelectSession={onSelectSession}
      onForkConversation={onForkConversation}
      isForkingRef={isForkingRef}
      isHydratingSession={isHydratingSession}
      isResumingRun={isResumingRun}
      isReconnecting={isReconnecting}
      contextUsage={contextUsage}
      selectedModel={selectedModel}
      selectedModelLabel={selectedModelLabel}
      isModelPickerOpen={isModelPickerOpen}
      setIsModelPickerOpen={setIsModelPickerOpen}
      setSelectedModel={setSelectedModel}
      selectedMode={selectedMode}
      selectedModeLabel={selectedModeLabel}
      isModePickerOpen={isModePickerOpen}
      setIsModePickerOpen={setIsModePickerOpen}
      setSelectedMode={setSelectedMode}
      reasoningEnabled={reasoningEnabled}
      setReasoningEnabled={setReasoningEnabled}
      reasoningEnabledRef={reasoningEnabledRef}
      forceCompactHeader={forceCompactHeader}
      onClose={onClose}
    />
  );
}

export function WorkspaceAssistant({
  prompts,
  docId,
  isAdmin,
}: WorkspaceAssistantProps) {
  const assistantRuntime = useSpreadsheetAssistantRuntime({ docId });

  return (
    <AssistantRuntimeProvider runtime={assistantRuntime.runtime}>
      <WorkspaceAssistantPanel
        prompts={prompts}
        docId={docId}
        isAdmin={isAdmin}
        threadId={assistantRuntime.threadId}
        onNewSession={assistantRuntime.startNewThread}
        onSelectSession={assistantRuntime.selectThread}
        onForkConversation={assistantRuntime.forkConversation}
        isForkingRef={assistantRuntime.isForkingRef}
        isHydratingSession={assistantRuntime.isHydratingSession}
        isResumingRun={assistantRuntime.isResumingRun}
        isReconnecting={assistantRuntime.isReconnecting}
        contextUsage={assistantRuntime.contextUsage}
        selectedModel={assistantRuntime.selectedModel}
        selectedModelLabel={assistantRuntime.selectedModelLabel}
        isModelPickerOpen={assistantRuntime.isModelPickerOpen}
        setIsModelPickerOpen={assistantRuntime.setIsModelPickerOpen}
        setSelectedModel={assistantRuntime.setSelectedModel}
        selectedMode={assistantRuntime.selectedMode}
        selectedModeLabel={assistantRuntime.selectedModeLabel}
        isModePickerOpen={assistantRuntime.isModePickerOpen}
        setIsModePickerOpen={assistantRuntime.setIsModePickerOpen}
        setSelectedMode={assistantRuntime.setSelectedMode}
        reasoningEnabled={assistantRuntime.reasoningEnabled}
        setReasoningEnabled={assistantRuntime.setReasoningEnabled}
        reasoningEnabledRef={assistantRuntime.reasoningEnabledRef}
      />
    </AssistantRuntimeProvider>
  );
}
