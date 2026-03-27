import { normalizeAssistantErrorMessage } from "@/lib/chat/errors";
import {
  persistAssistantFailureToCheckpoint,
  resolveSpreadsheetAssistantSessionTitle,
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

export type ChatProvider = "openai" | "anthropic";

export type ChatRequestBody = {
  threadId?: string;
  docId?: string;
  message?: string;
  model?: string;
  provider?: string;
  reasoningEnabled?: boolean;
  systemInstructions?: string;
  context?: unknown;
};

export type ChatRequestDefaults = {
  model?: string;
  provider?: ChatProvider;
  reasoningEnabled?: boolean;
  systemInstructions?: string;
};

export type ResolvedChatRequest = {
  threadId: string;
  docId?: string;
  message: string;
  model?: string;
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

const isAllowedModel = (model: string) =>
  ALLOW_ANY_MODEL || ALLOWED_MODELS.has(model);

const parseProvider = (
  value: string | undefined | null,
): ChatProvider | undefined | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "openai") return "openai";
  if (normalized === "anthropic") return "anthropic";
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

  const message = body.message?.trim();
  if (!message) {
    return {
      ok: false,
      error: {
        status: 400,
        payload: { error: "message is required." },
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
      model,
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
  if (credits.balance >= MIN_CREDITS_PER_RUN) {
    return { ok: true };
  }

  const outOfCreditsErrorMessage =
    "Insufficient credits for today. Credits reset to 30 at the next daily reset.";
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
        remainingCredits: credits.balance,
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
  abortSignal?: AbortSignal;
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
  let sessionTitle: string | undefined;
  const shouldPersistEvents = input.persistEvents ?? true;

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
    if (shouldPersistEvents) {
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
    sessionTitle = await resolveSpreadsheetAssistantSessionTitle({
      threadId: input.request.threadId,
      userId: input.userId,
      message: input.request.message,
      model: input.request.model,
      provider: input.request.provider,
      reasoningEnabled: input.request.reasoningEnabled,
    });
  } catch (error) {
    console.error("[chat] Failed to resolve session title", {
      threadId: input.request.threadId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (sessionTitle) {
    try {
      await upsertAssistantSession({
        threadId: input.request.threadId,
        userId: input.userId,
        docId: input.request.docId,
        title: sessionTitle,
        model: input.request.model,
      });
    } catch (error) {
      console.error("[chat] Failed to persist session title", {
        threadId: input.request.threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    for await (const event of streamSpreadsheetAssistant({
      threadId: input.request.threadId,
      userId: input.userId,
      docId: input.request.docId,
      sessionTitle,
      message: input.request.message,
      model: input.request.model,
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

      // Add runId to message.start and message.complete for client reconnection
      const augmentedEvent =
        event.type === "message.start" || event.type === "message.complete"
          ? { ...event, runId }
          : event;

      await persistAndEmit(augmentedEvent);
    }
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
