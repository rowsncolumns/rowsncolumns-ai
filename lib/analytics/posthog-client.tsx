"use client";

import { useEffect, useState, type ReactNode } from "react";

type PostHogClient = {
  capture: (eventName: string, properties?: Record<string, unknown>) => void;
  identify: (userId: string, properties?: Record<string, unknown>) => void;
  reset: () => void;
};

let postHogPromise: Promise<PostHogClient> | null = null;

const loadPostHog = (): Promise<PostHogClient> => {
  if (!postHogPromise) {
    postHogPromise = import("posthog-js").then(
      (module) => module.default as unknown as PostHogClient,
    );
  }
  return postHogPromise;
};

// PostHog is initialized in instrumentation-client.ts.
// Keep provider as a no-op so analytics does not inflate first-load JS.

export const PostHogProvider = ({ children }: { children: ReactNode }) => {
  return <>{children}</>;
};

// --- Client-side tracking hooks ---

export const usePostHog = () => {
  const [client, setClient] = useState<PostHogClient | null>(null);

  useEffect(() => {
    let mounted = true;

    void loadPostHog().then((instance) => {
      if (mounted) {
        setClient(instance);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return client;
};

// --- Convenience tracking functions ---

export const trackEvent = (
  eventName: string,
  properties?: Record<string, unknown>,
) => {
  void loadPostHog().then((posthog) => {
    posthog.capture(eventName, properties);
  });
};

export const trackPageView = (
  pageName: string,
  properties?: Record<string, unknown>,
) => {
  void loadPostHog().then((posthog) => {
    posthog.capture("$pageview", {
      $current_url: typeof window !== "undefined" ? window.location.href : "",
      page_name: pageName,
      ...properties,
    });
  });
};

export const identifyUser = (
  userId: string,
  properties?: Record<string, unknown>,
) => {
  void loadPostHog().then((posthog) => {
    posthog.identify(userId, properties);
  });
};

export const resetUser = () => {
  void loadPostHog().then((posthog) => {
    posthog.reset();
  });
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
  void loadPostHog().then((posthog) => {
    posthog.capture(`spreadsheet_${action}`, properties);
  });
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
  void loadPostHog().then((posthog) => {
    posthog.capture(`chat_${action}`, properties);
  });
};
