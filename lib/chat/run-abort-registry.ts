type ChatAbortReason = {
  code: "SERVER_TIMEOUT" | "CLIENT_ABORT";
  message: string;
  timeoutMs?: number;
};

type RegisteredRun = {
  runId: string;
  userId: string;
  threadId: string;
  controller: AbortController;
};

type AbortRunInput =
  | {
      userId: string;
      runId: string;
      reason: ChatAbortReason;
    }
  | {
      userId: string;
      threadId: string;
      reason: ChatAbortReason;
    };

type AbortRunResult = {
  stopped: boolean;
  runId?: string;
  pending?: boolean;
};

const runsById = new Map<string, RegisteredRun>();
const runIdByThreadKey = new Map<string, string>();
const pendingAbortReasonByThreadKey = new Map<string, ChatAbortReason>();

const toThreadKey = (userId: string, threadId: string) => `${userId}:${threadId}`;

export const registerChatRunAbortController = (input: {
  runId: string;
  userId: string;
  threadId: string;
  controller: AbortController;
}) => {
  const record: RegisteredRun = {
    runId: input.runId,
    userId: input.userId,
    threadId: input.threadId,
    controller: input.controller,
  };
  runsById.set(input.runId, record);

  const threadKey = toThreadKey(input.userId, input.threadId);
  runIdByThreadKey.set(threadKey, input.runId);

  const pendingReason = pendingAbortReasonByThreadKey.get(threadKey);
  if (pendingReason && !input.controller.signal.aborted) {
    input.controller.abort(pendingReason);
    pendingAbortReasonByThreadKey.delete(threadKey);
  }
};

export const unregisterChatRunAbortController = (input: { runId: string }) => {
  const existing = runsById.get(input.runId);
  if (!existing) {
    return;
  }

  runsById.delete(input.runId);
  const threadKey = toThreadKey(existing.userId, existing.threadId);
  if (runIdByThreadKey.get(threadKey) === input.runId) {
    runIdByThreadKey.delete(threadKey);
  }
};

export const abortRegisteredChatRun = (input: AbortRunInput): AbortRunResult => {
  if ("runId" in input) {
    const existing = runsById.get(input.runId);
    if (!existing || existing.userId !== input.userId) {
      return { stopped: false };
    }

    if (!existing.controller.signal.aborted) {
      existing.controller.abort(input.reason);
    }
    return { stopped: true, runId: existing.runId };
  }

  const threadKey = toThreadKey(input.userId, input.threadId);
  const activeRunId = runIdByThreadKey.get(threadKey);
  if (!activeRunId) {
    pendingAbortReasonByThreadKey.set(threadKey, input.reason);
    return { stopped: false, pending: true };
  }

  const activeRun = runsById.get(activeRunId);
  if (!activeRun || activeRun.userId !== input.userId) {
    return { stopped: false };
  }

  if (!activeRun.controller.signal.aborted) {
    activeRun.controller.abort(input.reason);
  }
  return { stopped: true, runId: activeRunId };
};
