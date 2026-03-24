"use client";

import type {
  ChatModelAdapter,
  ThreadMessage,
} from "@assistant-ui/react";
import type {
  ReadonlyJSONObject,
  ReadonlyJSONValue,
} from "assistant-stream/utils";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import * as React from "react";
import { Github, Loader2, LogOut, RefreshCw, RotateCcw } from "lucide-react";
import {
  ModalProvider as RncModalProvider,
  TooltipProvider as RncTooltipProvider,
} from "@rowsncolumns/ui";

import {
  AssistantComposer,
  AssistantMessage,
  DEFAULT_ASSISTANT_MODEL,
  ToolUIRegistry,
  getAssistantModelLabel,
} from "@/components/excel-addin/excel-chat-ui";
import { executeExcelToolCall } from "@/components/excel-addin/excel-tools";
import { useExcelContext } from "@/components/excel-addin/excel-context";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth/client";
import type { SpreadsheetAssistantContext } from "@/lib/chat/context";
import type {
  ExcelChatHistoryMessage,
  ExcelChatStepRequest,
  ExcelChatStepResponse,
  ExcelToolCall,
  ExcelToolResult,
  ExcelToolRound,
} from "@/lib/chat/excel-protocol";

const CHAT_STEP_ENDPOINT = "/api/chat/excel/step";
const MAX_TOOL_STEPS = 8;
const OAUTH_POPUP_MESSAGE_TYPE = "neon-auth:oauth-complete";
const ASSISTANT_TAGLINE =
  "Plan edits, formulas, and workbook changes without leaving your sheet.";
const EXCEL_STARTER_PROMPTS = [
  "Build a monthly cash runway model with base, upside, and downside scenarios through the next 24 months.",
  "Create a budget vs actual variance model with volume/price/mix bridges and executive commentary fields.",
  "Audit this financial model for hardcoded values, broken links, circular references, and formula consistency.",
] as const;

type SocialProvider = "google" | "github";
type AuthStatus = "loading" | "authenticated" | "unauthenticated";
type SessionUser = {
  email?: string | null;
};

function GoogleBadge() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

type StreamingTextPart = {
  type: "text";
  text: string;
};

type StreamingToolPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: ReadonlyJSONObject;
  argsText: string;
  result?: unknown;
};

type StreamingContentPart = StreamingTextPart | StreamingToolPart;

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const createThreadId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `thread_${Math.random().toString(36).slice(2, 10)}`;
};

const inferProviderForModel = (
  model: string,
): "openai" | "anthropic" => {
  return /^claude/i.test(model) ? "anthropic" : "openai";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const stringifyUnknown = (value: unknown) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toJsonValue = (value: unknown): ReadonlyJSONValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (isRecord(value)) {
    const result: Record<string, ReadonlyJSONValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = toJsonValue(entry);
    }
    return result;
  }
  return String(value);
};

const normalizeToolArgs = (value: unknown): ReadonlyJSONObject => {
  if (isRecord(value)) {
    const result: Record<string, ReadonlyJSONValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = toJsonValue(entry);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return { items: toJsonValue(value) };
  }
  if (value === undefined) {
    return {};
  }
  return { value: toJsonValue(value) };
};

const snapshotParts = (parts: StreamingContentPart[]) =>
  parts.map((part) => (part.type === "tool-call" ? { ...part } : { ...part }));

const buildYieldPayload = (
  parts: StreamingContentPart[],
  threadId: string,
  complete = false,
) => ({
  content: snapshotParts(parts),
  ...(complete
    ? {
        status: {
          type: "complete" as const,
          reason: "stop" as const,
        },
      }
    : {}),
  metadata: {
    custom: {
      threadId,
    },
  },
});

const upsertToolCall = (
  parts: StreamingContentPart[],
  toolCallId: string,
  toolName: string,
  args: unknown,
) => {
  const normalizedArgs = normalizeToolArgs(args);
  const index = parts.findIndex(
    (part) => part.type === "tool-call" && part.toolCallId === toolCallId,
  );
  if (index === -1) {
    parts.push({
      type: "tool-call",
      toolCallId,
      toolName,
      args: normalizedArgs,
      argsText: stringifyUnknown(normalizedArgs),
    });
    return;
  }
  parts[index] = {
    type: "tool-call",
    toolCallId,
    toolName,
    args: normalizedArgs,
    argsText: stringifyUnknown(normalizedArgs),
    result:
      parts[index].type === "tool-call" ? parts[index].result : undefined,
  };
};

const setToolResult = (
  parts: StreamingContentPart[],
  toolCallId: string,
  toolName: string,
  result: unknown,
) => {
  const index = parts.findIndex(
    (part) => part.type === "tool-call" && part.toolCallId === toolCallId,
  );
  if (index === -1) {
    parts.push({
      type: "tool-call",
      toolCallId,
      toolName,
      args: {},
      argsText: "{}",
      result,
    });
    return;
  }

  const part = parts[index];
  if (part.type !== "tool-call") return;
  parts[index] = {
    ...part,
    result,
  };
};

const appendText = (parts: StreamingContentPart[], text: string) => {
  if (!text.trim()) return;
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.type === "text") {
    lastPart.text += text;
    return;
  }
  parts.push({ type: "text", text });
};

const extractSessionUser = (value: unknown): SessionUser | null => {
  if (!isRecord(value)) return null;

  if (isRecord(value.user)) {
    return value.user as SessionUser;
  }

  if (isRecord(value.data) && isRecord(value.data.user)) {
    return value.data.user as SessionUser;
  }

  if (
    isRecord(value.data) &&
    isRecord(value.data.session) &&
    isRecord(value.data.user)
  ) {
    return value.data.user as SessionUser;
  }

  return null;
};

const fetchSessionFromAuthEndpoint = async () => {
  const response = await fetch("/api/auth/get-session", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      "x-rnc-auth-source": "excel-addin",
    },
  });

  if (!response.ok) {
    throw new Error(`Session endpoint failed (${response.status})`);
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  return extractSessionUser(payload);
};

const startSamePaneSocialSignIn = async (provider: SocialProvider) => {
  const callbackURL = `/auth/callback?redirectTo=${encodeURIComponent("/excel-addin")}`;
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider,
      callbackURL,
    }),
  });

  if (response.redirected) {
    window.location.assign(response.url);
    return;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (isRecord(payload) && typeof payload.url === "string") {
    window.location.assign(payload.url);
    return;
  }

  if (!response.ok) {
    throw new Error(
      `Unable to start same-pane sign-in (${response.status} ${response.statusText})`,
    );
  }
  throw new Error("Unable to start same-pane sign-in.");
};

const openOfficeOAuthDialog = async (oauthUrl: string) => {
  if (
    typeof Office === "undefined" ||
    !Office.context?.ui ||
    typeof Office.context.ui.displayDialogAsync !== "function"
  ) {
    throw new Error("Office dialog API unavailable.");
  }

  return new Promise<{ verifier: string | null }>((resolve, reject) => {
    Office.context.ui.displayDialogAsync(
      oauthUrl,
      {
        height: 75,
        width: 45,
        promptBeforeOpen: false,
      },
      (result) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          reject(
            new Error(
              result.error?.message ?? "Unable to open Office auth dialog.",
            ),
          );
          return;
        }

        const dialog = result.value;
        let finished = false;
        const finish = (input: {
          ok: boolean;
          verifier?: string | null;
          error?: Error;
        }) => {
          if (finished) return;
          finished = true;
          try {
            dialog.close();
          } catch {
            // Ignore dialog close errors.
          }

          if (input.ok) {
            resolve({
              verifier:
                typeof input.verifier === "string" && input.verifier.length > 0
                  ? input.verifier
                  : null,
            });
            return;
          }
          reject(input.error ?? new Error("Auth dialog was closed."));
        };

        dialog.addEventHandler(
          Office.EventType.DialogMessageReceived,
          (event: { message: string; origin?: string } | { error: number }) => {
            if (!("message" in event)) {
              finish({
                ok: false,
                error: new Error(
                  `Auth dialog message channel error (${event.error}).`,
                ),
              });
              return;
            }

            try {
              const payload = JSON.parse(event.message) as unknown;
              if (isRecord(payload) && payload.type === OAUTH_POPUP_MESSAGE_TYPE) {
                const maybeError =
                  typeof payload.error === "string" ? payload.error.trim() : "";
                if (maybeError.length > 0) {
                  finish({
                    ok: false,
                    error: new Error(maybeError),
                  });
                  return;
                }
                finish({
                  ok: true,
                  verifier:
                    typeof payload.verifier === "string"
                      ? payload.verifier
                      : null,
                });
                return;
              }
              if (isRecord(payload) && typeof payload.error === "string") {
                finish({
                  ok: false,
                  error: new Error(payload.error),
                });
                return;
              }
            } catch {
              // Ignore parse failures and handle raw message fallback below.
            }

            finish({
              ok: true,
              verifier: event.message,
            });
          },
        );

        dialog.addEventHandler(
          Office.EventType.DialogEventReceived,
          (event: { message: string; origin?: string } | { error: number }) => {
            const code = "error" in event ? event.error : "unknown";
            finish({
              ok: false,
              error: new Error(
                `Auth dialog closed before completion (${code}).`,
              ),
            });
          },
        );
      },
    );
  });
};

const readSessionVerifierFromUrl = (url: URL) => {
  const direct = url.searchParams.get("neon_auth_session_verifier")?.trim();
  if (direct) return direct;
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (!hash) return null;
  const hashParams = new URLSearchParams(hash);
  const fromHash = hashParams.get("neon_auth_session_verifier")?.trim();
  return fromHash || null;
};

const clearSessionVerifierFromUrl = () => {
  const url = new URL(window.location.href);
  const hadSearchParam = url.searchParams.has("neon_auth_session_verifier");
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(hash);
  const hadHashParam = hashParams.has("neon_auth_session_verifier");
  if (!hadSearchParam && !hadHashParam) {
    return false;
  }

  if (hadSearchParam) {
    url.searchParams.delete("neon_auth_session_verifier");
  }
  if (hadHashParam) {
    hashParams.delete("neon_auth_session_verifier");
  }
  const nextHash = hashParams.toString();
  const nextUrl = `${url.pathname}${url.search}${nextHash ? `#${nextHash}` : ""}`;
  try {
    if (typeof window.history.replaceState === "function") {
      // Avoid reading `history.state` in Office webview where proxied history
      // can throw "Illegal invocation".
      window.history.replaceState(null, "", nextUrl);
      return true;
    }
  } catch {
    // Ignore and fall through.
  }
  try {
    window.location.replace(nextUrl);
    return true;
  } catch {
    // Ignore and fall through.
  }
  return false;
};

const tryExchangeSessionVerifier = async () => {
  const url = new URL(window.location.href);
  const verifier = readSessionVerifierFromUrl(url);
  if (!verifier) return false;

  const response = await fetch(
    `/api/auth/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        "x-rnc-auth-source": "excel-addin-verifier-exchange",
      },
    },
  );

  return response.ok;
};

const extractMessageText = (message: ThreadMessage | undefined) => {
  if (!message) return "";
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
};

const toHistoryMessages = (messages: ThreadMessage[]): ExcelChatHistoryMessage[] => {
  const result: ExcelChatHistoryMessage[] = [];

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    const content = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    if (!content) continue;

    result.push({
      role: message.role,
      content,
    });
  }

  return result;
};

const requestExcelChatStep = async (
  input: ExcelChatStepRequest,
  signal: AbortSignal,
) => {
  const response = await fetch(CHAT_STEP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | ExcelChatStepResponse
    | null;
  if (!response.ok || !payload) {
    return {
      ok: false,
      error: "Failed to run assistant step.",
    } satisfies ExcelChatStepResponse;
  }

  return payload;
};

const getAssistantContextSnapshot = (input: {
  workbookReady: boolean;
  activeSheetId: number | null;
  activeCell: {
    rowIndex: number;
    columnIndex: number;
    a1Address: string;
  } | null;
  sheets: Array<{ sheetId: number; name: string }>;
}): SpreadsheetAssistantContext | undefined => {
  if (!input.workbookReady) return undefined;

  return {
    documentId: "excel-active-workbook",
    sheets: input.sheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      title: sheet.name,
    })),
    ...(typeof input.activeSheetId === "number"
      ? { activeSheetId: input.activeSheetId }
      : {}),
    ...(input.activeCell
      ? {
          activeCell: {
            rowIndex: input.activeCell.rowIndex,
            columnIndex: input.activeCell.columnIndex,
            a1Address: input.activeCell.a1Address,
          },
        }
      : {}),
  };
};

export function ExcelAssistant() {
  const {
    isReady,
    activeSheetId,
    activeCell,
    sheets,
    runExcel,
    refreshSnapshot,
  } = useExcelContext();

  const [selectedModel, setSelectedModel] = React.useState(
    DEFAULT_ASSISTANT_MODEL,
  );
  const [isModelPickerOpen, setIsModelPickerOpen] = React.useState(false);
  const [reasoningEnabled, setReasoningEnabled] = React.useState(true);
  const [authStatus, setAuthStatus] = React.useState<AuthStatus>("loading");
  const [authPendingProvider, setAuthPendingProvider] =
    React.useState<SocialProvider | null>(null);
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [signedInEmail, setSignedInEmail] = React.useState<string | null>(null);
  const [threadId, setThreadId] = React.useState(() => createThreadId());

  const selectedModelRef = React.useRef(selectedModel);
  const reasoningEnabledRef = React.useRef(reasoningEnabled);
  const authStatusRef = React.useRef(authStatus);
  const threadIdRef = React.useRef(threadId);
  const contextRef = React.useRef({
    isReady,
    activeSheetId,
    activeCell,
    sheets,
    runExcel,
    refreshSnapshot,
  });

  React.useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  React.useEffect(() => {
    document.body.classList.add("excel-addin-body");
    return () => {
      document.body.classList.remove("excel-addin-body");
    };
  }, []);

  React.useEffect(() => {
    reasoningEnabledRef.current = reasoningEnabled;
  }, [reasoningEnabled]);

  React.useEffect(() => {
    authStatusRef.current = authStatus;
  }, [authStatus]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("excel_dialog") !== "1") {
      return;
    }

    try {
      if (
        typeof Office !== "undefined" &&
        Office.context?.ui &&
        typeof Office.context.ui.messageParent === "function"
      ) {
        Office.context.ui.messageParent(
          JSON.stringify({
            type: OAUTH_POPUP_MESSAGE_TYPE,
            verifier: null,
            originalCallback: "/excel-addin",
          }),
        );
        window.close();
      }
    } catch {
      // Ignore dialog bridge failures.
    }
  }, []);

  const refreshAuthSession = React.useCallback(async () => {
    setAuthError(null);
    let hadVerifierInLocation = false;
    try {
      const locationUrl = new URL(window.location.href);
      hadVerifierInLocation = Boolean(readSessionVerifierFromUrl(locationUrl));
      if (hadVerifierInLocation) {
        const exchanged = await tryExchangeSessionVerifier();
        if (exchanged) {
          clearSessionVerifierFromUrl();
        }
      }
    } catch {
      // Ignore preflight verifier exchange failures.
    }

    try {
      const sessionResult = await authClient.getSession();
      const sdkUser = sessionResult.data?.user ?? null;
      const user = sdkUser ?? (await fetchSessionFromAuthEndpoint());
      if (user) {
        if (hadVerifierInLocation) {
          clearSessionVerifierFromUrl();
        }
        setAuthStatus("authenticated");
        const email =
          typeof user.email === "string" && user.email.trim().length > 0
            ? user.email.trim()
            : null;
        setSignedInEmail(email);
        return true;
      }
      setSignedInEmail(null);
      setAuthStatus("unauthenticated");
      return false;
    } catch (error) {
      try {
        await tryExchangeSessionVerifier();
      } catch {
        // Ignore verifier exchange failures.
      }

      const hadVerifier = clearSessionVerifierFromUrl();
      if (hadVerifier) {
        try {
          const retryResult = await authClient.getSession();
            const retryUser =
              retryResult.data?.user ?? (await fetchSessionFromAuthEndpoint());
          if (retryUser) {
            clearSessionVerifierFromUrl();
            setAuthStatus("authenticated");
            const email =
              typeof retryUser.email === "string" &&
              retryUser.email.trim().length > 0
                ? retryUser.email.trim()
                : null;
            setSignedInEmail(email);
            return true;
          }
        } catch {
          // Ignore retry failures and fall through to standard error handling.
        }
      }

      try {
        const fallbackUser = await fetchSessionFromAuthEndpoint();
        if (fallbackUser) {
          setAuthStatus("authenticated");
          const email =
            typeof fallbackUser.email === "string" &&
            fallbackUser.email.trim().length > 0
              ? fallbackUser.email.trim()
              : null;
          setSignedInEmail(email);
          return true;
        }
      } catch {
        // Ignore endpoint fallback errors; surface primary error below.
      }

      setSignedInEmail(null);
      setAuthStatus("unauthenticated");
      setAuthError(
        `Unable to verify session. Please sign in. (${toErrorMessage(error)})`,
      );
      return false;
    }
  }, []);

  React.useEffect(() => {
    let active = true;

    const initializeAuth = async () => {
      try {
        await refreshAuthSession();
      } finally {
        if (!active) return;
      }
    };

    void initializeAuth();

    const onFocus = () => {
      void refreshAuthSession();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshAuthSession]);

  const handleSignIn = React.useCallback(async (provider: SocialProvider) => {
    try {
      setAuthError(null);
      setAuthPendingProvider(provider);

      const dialogReturnPath = "/excel-addin?excel_dialog=1";
      const callbackPath = `/auth/callback?excel_dialog=1&redirectTo=${encodeURIComponent(dialogReturnPath)}&neon_popup=1&neon_popup_callback=${encodeURIComponent(dialogReturnPath)}`;
      const officeDialogStartUrl = `${window.location.origin}/auth/excel/start?provider=${encodeURIComponent(provider)}&callbackURL=${encodeURIComponent(callbackPath)}`;

      if (
        typeof Office !== "undefined" &&
        Office.context?.ui &&
        typeof Office.context.ui.displayDialogAsync === "function"
      ) {
        try {
          const dialogResult = await openOfficeOAuthDialog(officeDialogStartUrl);
          if (dialogResult.verifier) {
            await fetch(
              `/api/auth/get-session?neon_auth_session_verifier=${encodeURIComponent(dialogResult.verifier)}`,
              {
                method: "GET",
                credentials: "include",
                cache: "no-store",
              },
            );
          }
        } catch (error) {
          setAuthPendingProvider(null);
          setAuthError(toErrorMessage(error));
          return;
        }

        for (let attempt = 0; attempt < 15; attempt += 1) {
          const isAuthenticated = await refreshAuthSession();
          if (isAuthenticated) {
            setAuthPendingProvider(null);
            return;
          }
          await sleep(700);
        }

        setAuthPendingProvider(null);
        setAuthError(
          "Sign-in completed, but session is not available in Excel yet. Click refresh.",
        );
        return;
      }

        const popupCallbackURL = `/auth/callback?neon_popup=1&neon_popup_callback=${encodeURIComponent("/excel-addin")}`;
        const signInResult = await authClient.signIn.social({
          provider,
          callbackURL: popupCallbackURL,
          disableRedirect: true,
      });
      if (signInResult.error) {
        throw new Error(
          signInResult.error.message ?? "Unable to start social sign-in.",
        );
      }

      const oauthUrl =
        isRecord(signInResult.data) && typeof signInResult.data.url === "string"
          ? signInResult.data.url
          : null;
      if (!oauthUrl) {
        throw new Error("OAuth URL is missing from sign-in response.");
      }

      const popup = window.open(
        oauthUrl,
        "rnc_excel_auth_popup",
        "width=500,height=700,popup=yes",
      );
      let completedViaDialog = false;
      if (!popup || popup.closed) {
        // Some Excel hosts block browser popups. Use Office dialog when possible.
        try {
          const dialogResult = await openOfficeOAuthDialog(oauthUrl);
          if (dialogResult.verifier) {
            await fetch(
              `/api/auth/get-session?neon_auth_session_verifier=${encodeURIComponent(dialogResult.verifier)}`,
              {
                method: "GET",
                credentials: "include",
                cache: "no-store",
              },
            );
          }
          completedViaDialog = true;
        } catch {
          // Final fallback for hosts without Office dialog support.
          await startSamePaneSocialSignIn(provider);
          return;
        }
      }

      const popupCompleted = completedViaDialog
        ? true
        : await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (ok: boolean) => {
              if (settled) return;
              settled = true;
              window.removeEventListener("message", onMessage);
              if (pollTimer !== null) {
                window.clearInterval(pollTimer);
              }
              if (timeoutTimer !== null) {
                window.clearTimeout(timeoutTimer);
              }
              resolve(ok);
            };

            const onMessage = (event: MessageEvent) => {
              if (event.origin !== window.location.origin) return;
              if (!isRecord(event.data)) return;
              if (event.data.type !== OAUTH_POPUP_MESSAGE_TYPE) return;

              const verifier =
                typeof event.data.verifier === "string"
                  ? event.data.verifier.trim()
                  : "";
              if (verifier) {
                void fetch(
                  `/api/auth/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`,
                  {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                  },
                )
                .catch(() => {
                  // Ignore verifier exchange errors here; session refresh handles it.
                })
                .finally(() => finish(true));
                return;
              }
              if (typeof event.data.error === "string") {
                finish(false);
                return;
              }

              finish(true);
            };

            window.addEventListener("message", onMessage);

            const pollTimer = window.setInterval(() => {
              if (popup?.closed) {
                finish(true);
              }
            }, 400);

            const timeoutTimer = window.setTimeout(() => {
              try {
                popup?.close();
              } catch {
                // Ignore popup close errors.
              }
              finish(false);
            }, 3 * 60 * 1000);
          });

      if (!popupCompleted) {
        setAuthPendingProvider(null);
        setAuthError("Sign-in timed out. Please try again.");
        return;
      }

      for (let attempt = 0; attempt < 15; attempt += 1) {
        const isAuthenticated = await refreshAuthSession();
        if (isAuthenticated) {
          setAuthPendingProvider(null);
          return;
        }
        await sleep(700);
      }

      try {
        await startSamePaneSocialSignIn(provider);
        return;
      } catch {
        // If same-pane fallback fails, surface the standard session error.
      }

      setAuthPendingProvider(null);
      setAuthError(
        "Sign-in completed, but session is not available in Excel yet. Click refresh.",
      );
    } catch (error) {
      setAuthPendingProvider(null);
      setAuthError(toErrorMessage(error));
    }
  }, [refreshAuthSession]);

  React.useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  React.useEffect(() => {
    contextRef.current = {
      isReady,
      activeSheetId,
      activeCell,
      sheets,
      runExcel,
      refreshSnapshot,
    };
  }, [activeCell, activeSheetId, isReady, refreshSnapshot, runExcel, sheets]);

  const chatAdapter = React.useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        if (authStatusRef.current !== "authenticated") {
          yield {
            content: [
              {
                type: "text",
                text: "Please sign in before using the assistant in Excel.",
              },
            ],
            status: { type: "complete", reason: "stop" },
          };
          return;
        }

        const latestUserMessage = [...messages]
          .reverse()
          .find((message) => message.role === "user");
        const latestUserText = extractMessageText(latestUserMessage);
        if (!latestUserText) {
          yield {
            content: [{ type: "text", text: "Please enter a prompt first." }],
            status: { type: "complete", reason: "stop" },
          };
          return;
        }

        const parts: StreamingContentPart[] = [];
        const history = toHistoryMessages(messages as ThreadMessage[]);
        const toolRounds: ExcelToolRound[] = [];

        try {
          for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
            if (abortSignal.aborted) {
              return;
            }

            const latestContext = contextRef.current;
            const contextSnapshot = getAssistantContextSnapshot({
              workbookReady: latestContext.isReady,
              activeSheetId: latestContext.activeSheetId,
              activeCell: latestContext.activeCell,
              sheets: latestContext.sheets,
            });

            const stepResponse = await requestExcelChatStep(
              {
                threadId: threadIdRef.current,
                messages: history,
                model: selectedModelRef.current,
                provider: inferProviderForModel(selectedModelRef.current),
                reasoningEnabled: reasoningEnabledRef.current,
                context: contextSnapshot,
                toolRounds,
              },
              abortSignal,
            );

            if (!stepResponse.ok) {
              appendText(parts, stepResponse.error || "Assistant request failed.");
              yield buildYieldPayload(parts, threadIdRef.current, true);
              return;
            }

            if (stepResponse.type === "assistant") {
              appendText(parts, stepResponse.message || "Done.");
              yield buildYieldPayload(parts, threadIdRef.current, true);
              return;
            }

            const executedResults: ExcelToolResult[] = [];
            for (const toolCall of stepResponse.toolCalls) {
              upsertToolCall(parts, toolCall.toolCallId, toolCall.toolName, toolCall.args);
              yield buildYieldPayload(parts, threadIdRef.current, false);

              const toolResult = await latestContext.runExcel(async (context) => {
                return executeExcelToolCall(context, toolCall);
              });

              setToolResult(parts, toolCall.toolCallId, toolCall.toolName, toolResult);
              yield buildYieldPayload(parts, threadIdRef.current, false);

              executedResults.push({
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                result: toolResult,
                isError:
                  isRecord(toolResult) && typeof toolResult.success === "boolean"
                    ? toolResult.success === false
                    : false,
              });
            }

            toolRounds.push({
              toolCalls: stepResponse.toolCalls as ExcelToolCall[],
              toolResults: executedResults,
            });

            await latestContext.refreshSnapshot();
          }

          appendText(
            parts,
            "Stopped after reaching the maximum tool execution steps for this request.",
          );
          yield buildYieldPayload(parts, threadIdRef.current, true);
        } catch (error) {
          appendText(parts, toErrorMessage(error));
          yield buildYieldPayload(parts, threadIdRef.current, true);
        }
      },
    }),
    [],
  );

  const runtime = useLocalRuntime(chatAdapter, { maxSteps: 1 });

  const handleNewChat = React.useCallback(() => {
    runtime.thread.reset([]);
    setThreadId(createThreadId());
  }, [runtime.thread]);

  const handleSignOut = React.useCallback(async () => {
    if (isSigningOut) {
      return;
    }

    setAuthError(null);
    setIsSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        await fetch("/auth/sign-out", {
          method: "POST",
          credentials: "include",
        });
      }
    } catch {
      try {
        await fetch("/auth/sign-out", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        // Ignore fallback failures and still reset local auth state.
      }
    } finally {
      runtime.thread.reset([]);
      setThreadId(createThreadId());
      setSignedInEmail(null);
      setAuthStatus("unauthenticated");
      setAuthPendingProvider(null);
      setIsSigningOut(false);
    }
  }, [isSigningOut, runtime.thread]);

  const handleNavigateToRange = React.useCallback(
    (input: { range: string; sheetId: number | null }) => {
      void runExcel(async (context) => {
        const worksheets = context.workbook.worksheets;
        let worksheet = worksheets.getActiveWorksheet();

        if (
          typeof input.sheetId === "number" &&
          Number.isInteger(input.sheetId) &&
          input.sheetId > 0
        ) {
          worksheets.load("items/position");
          await context.sync();

          const target = worksheets.items.find(
            (sheet) => sheet.position + 1 === input.sheetId,
          );
          if (target) {
            worksheet = target;
          }
        }

        worksheet.activate();
        worksheet.getRange(input.range).select();
        await context.sync();
      })
        .then(() => refreshSnapshot())
        .catch((error) => {
          console.error("[excel-assistant] Failed to navigate to range", {
            error: toErrorMessage(error),
            range: input.range,
            sheetId: input.sheetId,
          });
        });
    },
    [refreshSnapshot, runExcel],
  );
  const selectedModelLabel = getAssistantModelLabel(selectedModel);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RncModalProvider>
        <RncTooltipProvider>
          <div className="flex h-screen flex-col bg-[#f7f3ee] text-foreground">
          <header className="rnc-assistant-divider border-b border-black/8 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="display-font mt-1 text-2xl font-semibold tracking-[-0.03em]">
                  Spreadsheet Agent
                </h2>
                <p className="mt-1 text-sm leading-6 text-(--muted-foreground)">
                  {ASSISTANT_TAGLINE}
                </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={
                      isReady
                        ? "rounded-full bg-[#e6f6ec] px-2 py-0.5 text-[11px] text-[#116d3d]"
                        : "rounded-full bg-[#fff1dd] px-2 py-0.5 text-[11px] text-[#9b5a00]"
                    }
                  >
                    {isReady ? "Workbook connected" : "Waiting for Office"}
                  </span>
                <span className="text-xs text-(--muted-foreground)">
                    {authStatus === "authenticated" && signedInEmail
                      ? signedInEmail
                      : activeCell
                      ? `Sheet ${activeSheetId ?? "-"} • ${activeCell.a1Address}`
                      : "No active selection yet"}
                </span>
              </div>
            </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshSnapshot()}
                  className="rnc-assistant-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2]"
                  title="Refresh workbook context"
                  aria-label="Refresh workbook context"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="rnc-assistant-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2]"
                  title="Start new session"
                  aria-label="Start new session"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>New Session</span>
                </button>
                {authStatus === "authenticated" && (
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    disabled={isSigningOut}
                    className="rnc-assistant-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2] disabled:cursor-not-allowed disabled:opacity-60"
                    title="Log out"
                    aria-label="Log out"
                  >
                    {isSigningOut ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" />
                    )}
                    <span>{isSigningOut ? "Logging out..." : "Log out"}</span>
                  </button>
                )}
              </div>
            </div>
          </header>

          {authStatus === "loading" ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6">
              <div className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-(--muted-foreground) shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking session...
              </div>
            </div>
          ) : authStatus === "unauthenticated" ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
              <div className="w-full max-w-md rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
                <h3 className="display-font text-xl font-semibold text-foreground">
                  Sign in required
                </h3>
                <p className="mt-2 text-sm text-(--muted-foreground)">
                  Please sign in to use the assistant inside Excel.
                </p>
                <div className="mt-4 space-y-3">
                  <button
                    type="button"
                    disabled={authPendingProvider !== null}
                    onClick={() => void handleSignIn("google")}
                    className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-(--card-border) bg-(--card-bg-solid) text-sm font-semibold text-foreground shadow-[0_2px_4px_var(--card-shadow)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {authPendingProvider === "google" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <GoogleBadge />
                    )}
                    Sign in with Google
                  </button>
                  <button
                    type="button"
                    disabled={authPendingProvider !== null}
                    onClick={() => void handleSignIn("github")}
                    className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-(--card-border) bg-(--card-bg-solid) text-sm font-semibold text-foreground shadow-[0_2px_4px_var(--card-shadow)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {authPendingProvider === "github" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Github className="h-4 w-4" />
                    )}
                    Sign in with GitHub
                  </button>
                </div>
                {authError && (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {authError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void refreshAuthSession()}
                  className="mt-3 inline-flex items-center gap-2 text-xs text-(--muted-foreground) hover:text-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  I already signed in, refresh
                </button>
              </div>
            </div>
          ) : (
            <ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col">
              <ToolUIRegistry onNavigateToRange={handleNavigateToRange} />
              <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <div className="space-y-3">
                  <ThreadPrimitive.Messages
                    components={{
                      UserMessage: AssistantMessage,
                      AssistantMessage,
                    }}
                  />
                </div>
              </ThreadPrimitive.Viewport>
              <div className="rnc-assistant-divider w-full border-t border-black/8 px-5 py-4">
                <AssistantComposer
                  selectedModel={selectedModel}
                  selectedModelLabel={selectedModelLabel}
                  isModelPickerOpen={isModelPickerOpen}
                  setIsModelPickerOpen={setIsModelPickerOpen}
                  setSelectedModel={setSelectedModel}
                  reasoningEnabled={reasoningEnabled}
                  setReasoningEnabled={setReasoningEnabled}
                  reasoningEnabledRef={reasoningEnabledRef}
                  forceCompactHeader
                  remainingCredits={null}
                  isUnlimitedCredits
                  isCreditsLoading={false}
                />
                <ThreadPrimitive.If empty>
                  <div className="flex min-w-0 flex-row flex-wrap items-center justify-center gap-2 pt-3">
                    <TooltipProvider delayDuration={200}>
                      {EXCEL_STARTER_PROMPTS.map((prompt) => (
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
                {!isReady && (
                  <div className="mt-2 text-xs text-(--muted-foreground)">
                    Waiting for Office runtime...
                  </div>
                )}
              </div>
            </ThreadPrimitive.Root>
          )}
          </div>
        </RncTooltipProvider>
      </RncModalProvider>
    </AssistantRuntimeProvider>
  );
}
