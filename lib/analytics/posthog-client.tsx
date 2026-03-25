"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect, type ReactNode } from "react";

const POSTHOG_KEY =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ||
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

export const PostHogProvider = ({ children }: { children: ReactNode }) => {
  useEffect(() => {
    if (!POSTHOG_KEY) {
      return;
    }

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      persistence: "localStorage+cookie",
      // Disable in development
      loaded: (ph) => {
        if (process.env.NODE_ENV === "development") {
          ph.opt_out_capturing();
        }
      },
    });
  }, []);

  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
};

// --- Client-side tracking hooks ---

export const usePostHog = () => {
  if (!POSTHOG_KEY) {
    return {
      capture: () => {},
      identify: () => {},
      reset: () => {},
    };
  }

  return posthog;
};

// --- Convenience tracking functions ---

export const trackEvent = (
  eventName: string,
  properties?: Record<string, unknown>,
) => {
  if (!POSTHOG_KEY) return;
  posthog.capture(eventName, properties);
};

export const trackPageView = (pageName: string, properties?: Record<string, unknown>) => {
  if (!POSTHOG_KEY) return;
  posthog.capture("$pageview", {
    $current_url: window.location.href,
    page_name: pageName,
    ...properties,
  });
};

export const identifyUser = (
  userId: string,
  properties?: Record<string, unknown>,
) => {
  if (!POSTHOG_KEY) return;
  posthog.identify(userId, properties);
};

export const resetUser = () => {
  if (!POSTHOG_KEY) return;
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
  if (!POSTHOG_KEY) return;
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
  if (!POSTHOG_KEY) return;
  posthog.capture(`chat_${action}`, properties);
};
