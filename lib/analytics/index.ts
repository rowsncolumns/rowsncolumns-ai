// Server-side analytics (use in API routes, MCP tools)
export {
  getPostHogClient,
  shutdownPostHog,
  trackMcpTool,
  trackMcpSession,
  trackChat,
  trackError,
  identifyUser as identifyUserServer,
  withTracking,
} from "./posthog-server";

// Client-side analytics (use in React components)
export {
  PostHogProvider,
  usePostHog,
  trackEvent,
  trackPageView,
  identifyUser,
  resetUser,
  trackSpreadsheetAction,
  trackChatInteraction,
} from "./posthog-client";
