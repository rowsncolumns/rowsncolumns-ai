"use client";

import { useAssistantRuntime } from "@assistant-ui/react";
import { ChevronsUpDown, Edit, History, Loader2, Trash2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
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
  CHAT_EXTERNAL_API_ENABLED,
  getChatHistoryUrl,
} from "@/lib/assistant/workspace-assistant-config";
import { cn } from "@/lib/utils";

import { useIsTouchInputDevice } from "./touch-input-device";

type AssistantSessionSummary = {
  threadId: string;
  updatedAt: string;
  docId?: string;
  title?: string;
  model?: string;
};

const SESSION_LIST_CACHE_TTL_MS = 60_000;

type SessionListCacheEntry = {
  sessions: AssistantSessionSummary[];
  fetchedAt: number;
};

const sessionListCacheByDocId = new Map<string, SessionListCacheEntry>();

const getSessionListCacheKey = (docId?: string) => {
  const normalizedDocId = docId?.trim();
  return normalizedDocId && normalizedDocId.length > 0
    ? normalizedDocId
    : "__no_doc__";
};

const isAbortError = (error: unknown) =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error && error.name === "AbortError");

const parseAssistantSessionSummary = (
  value: unknown,
): AssistantSessionSummary | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeSession = value as {
    threadId?: unknown;
    updatedAt?: unknown;
    docId?: unknown;
    title?: unknown;
    model?: unknown;
  };
  if (
    typeof maybeSession.threadId !== "string" ||
    maybeSession.threadId.trim().length === 0
  ) {
    return null;
  }

  const updatedAt =
    typeof maybeSession.updatedAt === "string" ? maybeSession.updatedAt : "";
  const docId =
    typeof maybeSession.docId === "string" &&
    maybeSession.docId.trim().length > 0
      ? maybeSession.docId
      : undefined;
  const title =
    typeof maybeSession.title === "string" &&
    maybeSession.title.trim().length > 0
      ? maybeSession.title
      : undefined;
  const model =
    typeof maybeSession.model === "string" &&
    maybeSession.model.trim().length > 0
      ? maybeSession.model
      : undefined;

  return {
    threadId: maybeSession.threadId,
    updatedAt,
    ...(docId ? { docId } : {}),
    ...(title ? { title } : {}),
    ...(model ? { model } : {}),
  };
};

const parseRecentAssistantSessionsPayload = (
  value: unknown,
): AssistantSessionSummary[] => {
  if (!value || typeof value !== "object") {
    return [];
  }

  const sessions = (value as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions
    .map(parseAssistantSessionSummary)
    .filter((session): session is AssistantSessionSummary => session !== null);
};

const fetchRecentAssistantSessions = async (input: {
  signal: AbortSignal;
  limit?: number;
  currentThreadId?: string;
  docId?: string;
}) => {
  const params = new URLSearchParams();
  params.set("list", "sessions");
  params.set("limit", String(input.limit ?? 10));
  if (input.currentThreadId?.trim()) {
    params.set("currentThreadId", input.currentThreadId.trim());
  }
  if (input.docId?.trim()) {
    params.set("docId", input.docId.trim());
  }

  const response = await fetch(`${getChatHistoryUrl()}?${params}`, {
    method: "GET",
    cache: "no-store",
    credentials: CHAT_EXTERNAL_API_ENABLED ? "include" : "same-origin",
    signal: input.signal,
  });
  if (!response.ok) {
    return [] as AssistantSessionSummary[];
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  return parseRecentAssistantSessionsPayload(payload);
};

const deleteAssistantSessionByThreadId = async (input: { threadId: string }) => {
  const normalizedThreadId = input.threadId.trim();
  if (!normalizedThreadId) {
    return false;
  }

  const params = new URLSearchParams();
  params.set("list", "sessions");
  params.set("threadId", normalizedThreadId);

  const response = await fetch(`${getChatHistoryUrl()}?${params}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: CHAT_EXTERNAL_API_ENABLED ? "include" : "same-origin",
  });

  if (!response.ok) {
    throw new Error("Failed to delete session.");
  }

  const payload = (await response.json().catch(() => null)) as {
    deleted?: unknown;
  } | null;
  return payload?.deleted === true;
};

const formatSessionTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
};

/**
 * Button to start a new chat session by switching to a new thread.
 * Must be used inside an AssistantRuntimeProvider.
 */
export function NewSessionButton({
  iconOnly = false,
  onNewSession,
  disabled = false,
}: {
  iconOnly?: boolean;
  onNewSession?: () => void;
  disabled?: boolean;
}) {
  const runtime = useAssistantRuntime();

  const handleNewSession = React.useCallback(() => {
    if (disabled) {
      return;
    }
    onNewSession?.();
    runtime.switchToNewThread();
    // Focus the composer input after a brief delay to ensure the thread has switched.
    setTimeout(() => {
      const composerInput = document.querySelector<HTMLTextAreaElement>(
        "[data-composer-input], .aui-composer-input, textarea[placeholder]",
      );
      composerInput?.focus();
    }, 50);
  }, [disabled, onNewSession, runtime]);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={handleNewSession}
      className={cn(
        "rnc-assistant-chip h-8 rounded-lg border border-black/10 bg-[#faf6f0] text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2]",
        iconOnly ? "px-2" : "gap-1.5 px-2.5 whitespace-nowrap",
      )}
      aria-label="New session"
      title="Start new session"
      disabled={disabled}
    >
      <Edit className="h-3.5 w-3.5" />
      {!iconOnly && <span>New session</span>}
    </Button>
  );
}

export function SessionPickerButton({
  iconOnly = false,
  currentThreadId,
  docId,
  onSelectSession,
  onSessionRestoreStart,
  onStartNewSession,
  onRestoreModel,
  disabled = false,
}: {
  iconOnly?: boolean;
  currentThreadId?: string;
  docId?: string;
  onSelectSession?: (threadId: string) => void | Promise<void>;
  onSessionRestoreStart?: () => void;
  onStartNewSession?: () => void;
  onRestoreModel?: (model: string) => void;
  disabled?: boolean;
}) {
  const runtime = useAssistantRuntime();
  const isTouchInput = useIsTouchInputDevice();
  const cacheKey = React.useMemo(() => getSessionListCacheKey(docId), [docId]);
  const cacheEntry = sessionListCacheByDocId.get(cacheKey);
  const [isOpen, setIsOpen] = React.useState(false);
  const [sessions, setSessions] = React.useState<AssistantSessionSummary[]>(
    () => cacheEntry?.sessions ?? [],
  );
  const [lastFetchedAt, setLastFetchedAt] = React.useState<number>(
    () => cacheEntry?.fetchedAt ?? 0,
  );
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSwitchingSession, setIsSwitchingSession] = React.useState(false);
  const [deletingSessionThreadId, setDeletingSessionThreadId] = React.useState<
    string | null
  >(null);
  const [loadError, setLoadError] = React.useState("");

  React.useEffect(() => {
    const nextCacheEntry = sessionListCacheByDocId.get(cacheKey);
    setSessions(nextCacheEntry?.sessions ?? []);
    setLastFetchedAt(nextCacheEntry?.fetchedAt ?? 0);
  }, [cacheKey]);

  const loadSessions = React.useCallback(
    async (signal: AbortSignal) => {
      setIsLoading(true);
      setLoadError("");
      try {
        const result = await fetchRecentAssistantSessions({
          signal,
          limit: 10,
          currentThreadId,
          docId,
        });
        if (signal.aborted) {
          return;
        }
        setSessions(result);
        const now = Date.now();
        setLastFetchedAt(now);
        sessionListCacheByDocId.set(cacheKey, {
          sessions: result,
          fetchedAt: now,
        });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setSessions([]);
        setLoadError("Unable to load sessions.");
      } finally {
        if (!signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [cacheKey, currentThreadId, docId],
  );

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const cacheIsFresh =
      sessions.length > 0 &&
      Date.now() - lastFetchedAt < SESSION_LIST_CACHE_TTL_MS;
    if (cacheIsFresh) {
      return;
    }

    const controller = new AbortController();
    void loadSessions(controller.signal);
    return () => {
      controller.abort();
    };
  }, [isOpen, loadSessions, lastFetchedAt, sessions.length]);

  const handleSelectSession = React.useCallback(
    async (sessionThreadId: string) => {
      const normalizedThreadId = sessionThreadId.trim();
      if (!normalizedThreadId) {
        return;
      }
      if (normalizedThreadId === currentThreadId) {
        setIsOpen(false);
        return;
      }

      const session = sessions.find((s) => s.threadId === normalizedThreadId);

      setLoadError("");
      setIsSwitchingSession(true);
      try {
        onSessionRestoreStart?.();
        if (session?.model && onRestoreModel) {
          onRestoreModel(session.model);
        }
        await onSelectSession?.(normalizedThreadId);
        setIsOpen(false);
      } catch {
        setLoadError("Unable to restore session.");
      } finally {
        setIsSwitchingSession(false);
      }
    },
    [
      currentThreadId,
      onSelectSession,
      onSessionRestoreStart,
      onRestoreModel,
      sessions,
    ],
  );

  const handleDeleteSession = React.useCallback(
    async (sessionThreadId: string) => {
      const normalizedThreadId = sessionThreadId.trim();
      if (!normalizedThreadId) {
        return;
      }

      setLoadError("");
      setDeletingSessionThreadId(normalizedThreadId);
      try {
        await deleteAssistantSessionByThreadId({
          threadId: normalizedThreadId,
        });
        const now = Date.now();
        setSessions((previousSessions) => {
          const nextSessions = previousSessions.filter(
            (session) => session.threadId !== normalizedThreadId,
          );
          sessionListCacheByDocId.set(cacheKey, {
            sessions: nextSessions,
            fetchedAt: now,
          });
          return nextSessions;
        });
        setLastFetchedAt(now);

        if (normalizedThreadId === currentThreadId) {
          onStartNewSession?.();
          runtime.switchToNewThread();
        }
      } catch {
        setLoadError("Unable to delete session.");
      } finally {
        setDeletingSessionThreadId((previousThreadId) =>
          previousThreadId === normalizedThreadId ? null : previousThreadId,
        );
      }
    },
    [cacheKey, currentThreadId, onStartNewSession, runtime],
  );

  return (
    <Popover
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (disabled && nextOpen) {
          return;
        }
        setIsOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={cn(
            "rnc-assistant-chip h-8 rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) text-xs font-normal text-foreground shadow-none hover:bg-(--assistant-chip-hover)",
            iconOnly ? "px-2" : "gap-1.5 px-2.5 whitespace-nowrap",
          )}
          aria-label="Session history"
          title="Load a previous session"
          disabled={disabled || !onSelectSession || isSwitchingSession}
        >
          <History className="h-3.5 w-3.5" />
          {!iconOnly && <span>Sessions</span>}
          {!iconOnly && <ChevronsUpDown className="h-3 w-3 opacity-70" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-[180] w-[320px] overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-bg-solid)] p-0 text-[var(--foreground)] shadow-[0_18px_38px_var(--card-shadow)]"
        onOpenAutoFocus={(event) => {
          if (isTouchInput) {
            event.preventDefault();
          }
        }}
      >
        <Command className="bg-[var(--card-bg-solid)]">
          <CommandInput placeholder="Search sessions..." />
          <CommandList className="bg-[var(--card-bg-solid)]">
            {isLoading && sessions.length === 0 && (
              <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">
                Loading sessions...
              </div>
            )}
            {!isLoading && loadError && (
              <div className="px-3 py-4 text-xs text-[#c23f2c]">{loadError}</div>
            )}
            {!isLoading && !loadError && sessions.length === 0 && (
              <CommandEmpty>No saved sessions yet.</CommandEmpty>
            )}
            {!isLoading && !loadError && sessions.length > 0 && (
              <CommandGroup heading="Recent Sessions">
                {sessions.map((session) => {
                  const isCurrent = session.threadId === currentThreadId;
                  const isDeletingSession =
                    deletingSessionThreadId === session.threadId;
                  return (
                    <CommandItem
                      key={session.threadId}
                      value={session.threadId}
                      keywords={
                        session.title
                          ? [session.title, session.title.toLowerCase()]
                          : undefined
                      }
                      onSelect={handleSelectSession}
                      className="items-start gap-2 py-2"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium">
                            {session.title || session.threadId}
                          </span>
                          {isCurrent && (
                            <span className="rounded bg-[var(--assistant-chip-bg)] px-1.5 py-0.5 text-[9px] text-[var(--muted-foreground)]">
                              Current
                            </span>
                          )}
                        </div>
                        {session.title && (
                          <span className="truncate text-[10px] text-[var(--muted-foreground)]">
                            {session.threadId}
                          </span>
                        )}
                        <span className="text-[10px] text-[var(--muted-foreground)]">
                          {formatSessionTimestamp(session.updatedAt)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition hover:bg-[var(--assistant-chip-hover)] hover:text-[#c23f2c] disabled:opacity-50"
                        aria-label={`Delete session ${session.title || session.threadId}`}
                        title="Delete session"
                        disabled={isDeletingSession || isSwitchingSession}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void handleDeleteSession(session.threadId);
                        }}
                      >
                        {isDeletingSession ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
