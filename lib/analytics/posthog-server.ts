import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

const getPostHogApiKey = () =>
  process.env.POSTHOG_API_KEY?.trim() ||
  process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ||
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim() ||
  null;

const getPostHogHost = () =>
  process.env.POSTHOG_HOST?.trim() ||
  process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() ||
  "https://us.i.posthog.com";

export const getPostHogClient = (): PostHog | null => {
  const apiKey = getPostHogApiKey();

  if (!apiKey) {
    return null;
  }

  if (!posthogClient) {
    posthogClient = new PostHog(apiKey, {
      host: getPostHogHost(),
      flushAt: 10,
      flushInterval: 5000,
    });
  }

  return posthogClient;
};

export const shutdownPostHog = async () => {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
  }
};

// --- Event Types ---

type McpToolEvent = {
  tool: string;
  docId?: string;
  sheetId?: number;
  success: boolean;
  durationMs: number;
  errorCode?: string;
  inputSize?: number;
  outputSize?: number;
};

type McpSessionEvent = {
  docId: string;
  action: "open" | "create" | "close";
  host?: "claude" | "openai" | "unknown";
};

type ChatEvent = {
  threadId?: string;
  model?: string;
  provider?: "anthropic" | "openai";
  messageCount?: number;
  toolCallCount?: number;
  durationMs?: number;
  success: boolean;
  errorCode?: string;
};

// --- Tracking Functions ---

/**
 * Track MCP tool execution
 */
export const trackMcpTool = (
  distinctId: string,
  event: McpToolEvent,
  properties?: Record<string, unknown>,
) => {
  const client = getPostHogClient();
  if (!client) return;

  client.capture({
    distinctId,
    event: "mcp_tool_called",
    properties: {
      ...event,
      ...properties,
      $lib: "posthog-node",
    },
  });
};

/**
 * Track MCP session events (open/create/close spreadsheet)
 */
export const trackMcpSession = (
  distinctId: string,
  event: McpSessionEvent,
  properties?: Record<string, unknown>,
) => {
  const client = getPostHogClient();
  if (!client) return;

  client.capture({
    distinctId,
    event: `mcp_session_${event.action}`,
    properties: {
      ...event,
      ...properties,
      $lib: "posthog-node",
    },
  });
};

/**
 * Track chat/assistant interactions
 */
export const trackChat = (
  distinctId: string,
  event: ChatEvent,
  properties?: Record<string, unknown>,
) => {
  const client = getPostHogClient();
  if (!client) return;

  client.capture({
    distinctId,
    event: "chat_message",
    properties: {
      ...event,
      ...properties,
      $lib: "posthog-node",
    },
  });
};

/**
 * Track API errors
 */
export const trackError = (
  distinctId: string,
  error: {
    errorCode: string;
    errorMessage: string;
    endpoint?: string;
    context?: Record<string, unknown>;
  },
) => {
  const client = getPostHogClient();
  if (!client) return;

  client.capture({
    distinctId,
    event: "error",
    properties: {
      ...error,
      $lib: "posthog-node",
    },
  });
};

/**
 * Identify a user with properties
 */
export const identifyUser = (
  distinctId: string,
  properties?: Record<string, unknown>,
) => {
  const client = getPostHogClient();
  if (!client) return;

  client.identify({
    distinctId,
    properties,
  });
};

/**
 * Helper to create a timing wrapper for tracking duration
 */
export const withTracking = async <T>(
  distinctId: string,
  toolName: string,
  fn: () => Promise<T>,
  properties?: Record<string, unknown>,
): Promise<T> => {
  const startTime = Date.now();
  let success = true;
  let errorCode: string | undefined;

  try {
    const result = await fn();
    return result;
  } catch (error) {
    success = false;
    errorCode = error instanceof Error ? error.name : "UNKNOWN_ERROR";
    throw error;
  } finally {
    const durationMs = Date.now() - startTime;
    trackMcpTool(distinctId, {
      tool: toolName,
      success,
      durationMs,
      errorCode,
      ...properties,
    });
  }
};
