"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import type { ReactNode } from "react";

// PostHog is initialized in instrumentation-client.ts
// This provider just wraps children with the React context

export const PostHogProvider = ({ children }: { children: ReactNode }) => {
  return <PHProvider client={posthog}>{children}</PHProvider>;
};

// --- Client-side tracking hooks ---

export const usePostHog = () => {
  return posthog;
};

// --- Convenience tracking functions ---

export const trackEvent = (
  eventName: string,
  properties?: Record<string, unknown>,
) => {
  posthog.capture(eventName, properties);
};

export const trackPageView = (
  pageName: string,
  properties?: Record<string, unknown>,
) => {
  posthog.capture("$pageview", {
    $current_url: typeof window !== "undefined" ? window.location.href : "",
    page_name: pageName,
    ...properties,
  });
};

export const identifyUser = (
  userId: string,
  properties?: Record<string, unknown>,
) => {
  posthog.identify(userId, properties);
};

export const resetUser = () => {
  posthog.reset();
};

// --- Spreadsheet-specific tracking ---

export const trackSpreadsheetAction = (
  action: string,
  properties?: {
    docId?: string;
    sheetId?: number;
    range?: string;
    toolName?: string;
    [key: string]: unknown;
  },
) => {
  posthog.capture(`spreadsheet_${action}`, properties);
};

export const trackChatInteraction = (
  action: "send" | "receive" | "error",
  properties?: {
    model?: string;
    messageLength?: number;
    toolsUsed?: string[];
    [key: string]: unknown;
  },
) => {
  posthog.capture(`chat_${action}`, properties);
};
