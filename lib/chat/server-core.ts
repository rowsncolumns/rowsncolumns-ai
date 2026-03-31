import { normalizeAssistantErrorMessage } from "@/lib/chat/errors";
import {
  persistAssistantFailureToCheckpoint,
  streamSpreadsheetAssistant,
} from "@/lib/chat/graph";
import type { ChatStreamEvent } from "@/lib/chat/protocol";
import {
  buildSpreadsheetContextInstructions,
  type SpreadsheetAssistantContext,
  sanitizeSpreadsheetAssistantContext,
} from "@/lib/chat/context";
import {
  buildSkillsInstruction,
  mergeSystemInstructions,
  normalizeInstructionText,
} from "@/lib/chat/instructions";
import { listAssistantSkills } from "@/lib/skills/repository";
import {
  chargeUserCreditsForRun,
  getUserCredits,
} from "@/lib/credits/repository";
import {
  calculateChatRunCredits,
  MIN_CREDITS_PER_RUN,
} from "@/lib/credits/pricing";
import { upsertAssistantSession } from "@/lib/chat/sessions-repository";
import {
  createChatRun,
  completeChatRun,
  appendChatRunEvent,
} from "@/lib/chat/runs-repository";
import { getUserBillingEntitlement } from "@/lib/billing/repository";
import { withOperationHistoryRuntimeContext } from "@/lib/operation-history/runtime-context";
import { withShareDbRuntimeContext } from "@/lib/sharedb/runtime-context";

export type ChatProvider = "openai" | "anthropic";
export type ChatMode = "action" | "plan" | "ask";

export const DEFAULT_CHAT_MODE: ChatMode = "action";
export const CHAT_MODE_VALUES = new Set<ChatMode>(["action", "plan", "ask"]);

export type ChatImageInput = {
  url: string;
  filename?: string;
};

export type ChatRequestBody = {
  threadId?: string;
  docId?: string;
  message?: string;
  images?: unknown;
  model?: string;
  mode?: string;
  provider?: string;
  reasoningEnabled?: boolean;
  systemInstructions?: string;
  context?: unknown;
};

export type ChatRequestDefaults = {
  model?: string;
  mode?: ChatMode;
  provider?: ChatProvider;
  reasoningEnabled?: boolean;
  systemInstructions?: string;
};

export type ResolvedChatRequest = {
  threadId: string;
  docId?: string;
  message: string;
  images: ChatImageInput[];
  model?: string;
  mode: ChatMode;
  provider?: ChatProvider;
  reasoningEnabled?: boolean;
  systemInstructions?: string;
  context?: SpreadsheetAssistantContext;
};

export type ChatErrorResponse = {
  status: number;
  payload: {
    error: string;
    code?: string;
    remainingCredits?: number;
  };
};

export type ChatAbortReason = {
  code: "SERVER_TIMEOUT" | "CLIENT_ABORT";
  message: string;
  timeoutMs?: number;
};

const DEFAULT_ALLOWED_MODELS = new Set<string>([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.2-chat-latest",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "o3",
  "o4-mini",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6-low",
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-5-20251101",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-1-20250805",
]);

const parseAllowedModelsFromEnv = () => {
  const value = process.env.CHAT_ALLOWED_MODELS?.trim();
  if (!value) {
    return DEFAULT_ALLOWED_MODELS;
  }

  const parsed = new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  return parsed.size > 0 ? parsed : DEFAULT_ALLOWED_MODELS;
};

const ALLOWED_MODELS = parseAllowedModelsFromEnv();
const ALLOW_ANY_MODEL = ALLOWED_MODELS.has("*");
const MAX_CHAT_IMAGES = 8;

const isAllowedModel = (model: string) =>
  ALLOW_ANY_MODEL || ALLOWED_MODELS.has(model);

const parseChatImages = (
  value: unknown,
):
  | { ok: true; images: ChatImageInput[] }
  | { ok: false; error: ChatErrorResponse } => {
  if (value === undefined || value === null) {
    return { ok: true, images: [] };
  }

  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: "images must be an array." },
      },
    };
  }

  if (value.length > MAX_CHAT_IMAGES) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: `A maximum of ${MAX_CHAT_IMAGES} images is allowed.` },
      },
    };
  }

  const images: ChatImageInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return {
        ok: false,
        error: {
          status: 400,
          payload: { error: "Each image must be an object." },
        },
      };
    }

    const candidate = item as { url?: unknown; filename?: unknown };
    const rawUrl = typeof candidate.url === "string" ? candidate.url.trim() : "";
    if (!rawUrl) {
      return {
        ok: false,
        error: {
          status: 400,
          payload: { error: "Each image requires a url." },
        },
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return {
        ok: false,
        error: {
          status: 400,
          payload: { error: "Each image url must be a valid URL." },
        },
      };
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return {
        ok: false,
        error: {
          status: 400,
          payload: { error: "Image urls must use http or https." },
        },
      };
    }

    const filename =
      typeof candidate.filename === "string" && candidate.filename.trim().length
        ? candidate.filename.trim()
        : undefined;

    images.push({
      url: parsedUrl.toString(),
      ...(filename ? { filename } : {}),
    });
  }

  return { ok: true, images };
};

const parseProvider = (
  value: string | undefined | null,
): ChatProvider | undefined | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "openai") return "openai";
  if (normalized === "anthropic") return "anthropic";
  return null;
};

export const parseChatMode = (
  value: string | undefined | null,
): ChatMode | undefined | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (CHAT_MODE_VALUES.has(normalized as ChatMode)) {
    return normalized as ChatMode;
  }
  return null;
};

const inferProviderFromModel = (
  model: string | undefined,
): ChatProvider | undefined => {
  if (!model) return undefined;
  return /^claude/i.test(model) ? "anthropic" : "openai";
};

export const isChatAbortReason = (value: unknown): value is ChatAbortReason => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as Partial<ChatAbortReason>;
  return (
    (maybe.code === "SERVER_TIMEOUT" || maybe.code === "CLIENT_ABORT") &&
    typeof maybe.message === "string"
  );
};

export const resolveChatRequest = (
  body: ChatRequestBody,
  defaults: ChatRequestDefaults = {},
):
  | { ok: true; value: ResolvedChatRequest }
  | { ok: false; error: ChatErrorResponse } => {
  const threadId = body.threadId?.trim();
  if (!threadId) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: "threadId is required." },
      },
    };
  }

  const message = body.message?.trim() ?? "";
  const parsedImages = parseChatImages(body.images);
  if (!parsedImages.ok) {
    return {
      ok: false,
      error: parsedImages.error,
    };
  }

  if (!message && parsedImages.images.length === 0) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: "message or images are required." },
      },
    };
  }

  const modelFromBody = body.model?.trim();
  if (modelFromBody && !isAllowedModel(modelFromBody)) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: "model is not allowed." },
      },
    };
  }

  const model = modelFromBody || defaults.model?.trim() || undefined;
  if (model && !isAllowedModel(model)) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: "Configured model is not allowed." },
      },
    };
  }

  const parsedMode = parseChatMode(body.mode);
  if (parsedMode === null) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: "mode must be 'action', 'plan', or 'ask'." },
      },
    };
  }

  const mode = parsedMode ?? defaults.mode ?? DEFAULT_CHAT_MODE;

  const parsedProvider = parseProvider(body.provider);
  if (parsedProvider === null) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: "provider must be 'openai' or 'anthropic'." },
      },
    };
  }

  const inferredProvider = inferProviderFromModel(model);
  if (
    parsedProvider &&
    inferredProvider &&
    parsedProvider !== inferredProvider
  ) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: "provider does not match the selected model." },
      },
    };
  }

  const provider = parsedProvider ?? inferredProvider ?? defaults.provider;
  const reasoningEnabled =
    typeof body.reasoningEnabled === "boolean"
      ? body.reasoningEnabled
      : defaults.reasoningEnabled;
  const systemInstructions = mergeSystemInstructions(
    normalizeInstructionText(body.systemInstructions),
    normalizeInstructionText(defaults.systemInstructions),
  );
  const context = sanitizeSpreadsheetAssistantContext(body.context);

  return {
    ok: true,
    value: {
      threadId,
      docId: body.docId?.trim() || undefined,
      message,
      images: parsedImages.images,
      model,
      mode,
      provider,
      reasoningEnabled,
      systemInstructions,
      context,
    },
  };
};

export const resolveRunSystemInstructions = async (input: {
  userId: string;
  request: ResolvedChatRequest;
  defaultSystemInstructions?: string;
}) => {
  let skillsInstruction = "";
  try {
    const skills = await listAssistantSkills({ userId: input.userId });
    skillsInstruction = buildSkillsInstruction(skills);
  } catch (error) {
    console.error("[chat] Failed to load skills for user", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const contextInstructions = buildSpreadsheetContextInstructions(
    input.request.context,
  );

  return mergeSystemInstructions(
    mergeSystemInstructions(
      mergeSystemInstructions(
        input.request.systemInstructions,
        contextInstructions,
      ),
      skillsInstruction,
    ),
    input.defaultSystemInstructions,
  );
};

export const ensureChatRunCredits = async (input: {
  isAdmin: boolean;
  userId: string;
  threadId: string;
  message: string;
}): Promise<{ ok: true } | { ok: false; error: ChatErrorResponse }> => {
  if (input.isAdmin) {
    return { ok: true };
  }

  const credits = await getUserCredits(input.userId);
  if (credits.availableCredits >= MIN_CREDITS_PER_RUN) {
    return { ok: true };
  }

  const outOfCreditsErrorMessage =
    "Insufficient credits. Buy a top-up in Billing or wait for the next free daily reset.";
  await persistAssistantFailureToCheckpoint({
    threadId: input.threadId,
    userId: input.userId,
    userMessage: input.message,
    errorMessage: outOfCreditsErrorMessage,
  });

  return {
    ok: false,
    error: {
      status: 402,
      payload: {
        error: outOfCreditsErrorMessage,
        code: "INSUFFICIENT_CREDITS",
        remainingCredits: credits.availableCredits,
      },
    },
  };
};

export type ChatRunResult = {
  runId: string;
  completed: boolean;
  error?: string;
};

export const executeChatRunStream = async (input: {
  request: ResolvedChatRequest;
  userId: string;
  isAdmin: boolean;
  shareDbWsHeaders?: Record<string, string>;
  abortSignal?: AbortSignal;
  onRunCreated?: (runId: string) => void | Promise<void>;
  persistEvents?: boolean;
  emitEvent: (
    event:
      | ChatStreamEvent
      | (Extract<ChatStreamEvent, { type: "message.complete" }> & {
          runId: string;
        }),
  ) => void;
}): Promise<ChatRunResult> => {
  let toolCallCount = 0;
  let messageDeltaChars = 0;
  let messageCompleteChars = 0;
  let isCompleted = false;
  let runError: string | undefined;
  const runId = crypto.randomUUID();
  const shouldPersistEvents = input.persistEvents ?? true;

  try {
    await input.onRunCreated?.(runId);
  } catch (error) {
    console.error("[chat] Failed to run onRunCreated callback", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (shouldPersistEvents) {
    try {
      await createChatRun({
        runId,
        threadId: input.request.threadId,
        userId: input.userId,
      });
    } catch (error) {
      console.error("[chat] Failed to create chat run record", {
        runId,
        threadId: input.request.threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const persistAndEmit = async (
    event:
      | ChatStreamEvent
      | (Extract<ChatStreamEvent, { type: "message.complete" }> & {
          runId: string;
        }),
  ) => {
    const shouldPersistThisEvent =
      shouldPersistEvents &&
      event.type !== "message.delta" &&
      event.type !== "reasoning.delta";

    if (shouldPersistThisEvent) {
      try {
        await appendChatRunEvent({ runId, event: event as ChatStreamEvent });
      } catch (error) {
        console.error("[chat] Failed to persist event", {
          runId,
          eventType: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    input.emitEvent(event);
  };

  try {
    await upsertAssistantSession({
      threadId: input.request.threadId,
      userId: input.userId,
      docId: input.request.docId,
      model: input.request.model,
    });
  } catch (error) {
    console.error("[chat] Failed to upsert assistant session", {
      threadId: input.request.threadId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const billingEntitlement = input.isAdmin
      ? null
      : await getUserBillingEntitlement(input.userId);
    const trackingAllowed =
      input.isAdmin || billingEntitlement?.plan === "max";

    await withShareDbRuntimeContext(
      {
        ...(input.shareDbWsHeaders ? { wsHeaders: input.shareDbWsHeaders } : {}),
      },
      async () =>
        withOperationHistoryRuntimeContext(
          {
            userId: input.userId,
            trackingAllowed,
          },
          async () => {
            for await (const event of streamSpreadsheetAssistant({
              threadId: input.request.threadId,
              runId,
              userId: input.userId,
              docId: input.request.docId,
              message: input.request.message,
              images: input.request.images,
              model: input.request.model,
              mode: input.request.mode,
              provider: input.request.provider,
              reasoningEnabled: input.request.reasoningEnabled,
              systemInstructions: input.request.systemInstructions,
              abortSignal: input.abortSignal,
            })) {
              if (event.type === "tool.call") {
                toolCallCount += 1;
              }

              if (event.type === "message.delta") {
                messageDeltaChars += event.delta.length;
              }

              if (event.type === "message.complete") {
                isCompleted = true;
                messageCompleteChars = Math.max(
                  messageCompleteChars,
                  event.message.length,
                );
              }

              // Add runId to stream events that clients correlate to the active run.
              const augmentedEvent =
                event.type === "message.start" ||
                event.type === "message.complete" ||
                event.type === "context.usage"
                  ? { ...event, runId }
                  : event;

              await persistAndEmit(augmentedEvent);
            }
          },
        ),
    );
  } catch (error) {
    const abortReason = input.abortSignal?.aborted
      ? input.abortSignal.reason
      : undefined;
    const timeoutMessage =
      isChatAbortReason(abortReason) && abortReason.code === "SERVER_TIMEOUT"
        ? "This request took too long and hit the server timeout. Ask me to continue, and I will pick up from where I stopped."
        : null;
    const errorMessage = normalizeAssistantErrorMessage(
      timeoutMessage ||
        (error instanceof Error
          ? error.message
          : "Failed to process chat request."),
      "Failed to process chat request.",
    );

    runError = errorMessage;
    await persistAndEmit({
      type: "error",
      error: errorMessage,
    });
  } finally {
    if (isCompleted && !input.isAdmin) {
      const outputChars = Math.max(messageDeltaChars, messageCompleteChars);
      const pricing = calculateChatRunCredits({
        model: input.request.model,
        outputChars,
        toolCallCount,
      });

      try {
        await chargeUserCreditsForRun({
          userId: input.userId,
          runId,
          requestedCredits: pricing.credits,
          metadata: {
            threadId: input.request.threadId,
            docId: input.request.docId,
            model: input.request.model,
            mode: input.request.mode,
            provider: input.request.provider,
            outputChars,
            toolCallCount,
            pricing,
          },
        });
      } catch (chargeError) {
        console.error("[credits] Failed to charge user credits", {
          userId: input.userId,
          runId,
          error:
            chargeError instanceof Error
              ? chargeError.message
              : String(chargeError),
        });
      }
    }

    if (shouldPersistEvents) {
      try {
        await completeChatRun({
          runId,
          status: runError ? "failed" : "completed",
          errorMessage: runError,
        });
      } catch (error) {
        console.error("[chat] Failed to complete chat run record", {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    runId,
    completed: isCompleted,
    ...(runError ? { error: runError } : {}),
  };
};
