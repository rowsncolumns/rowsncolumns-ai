const POSTHOG_KEY =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ||
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

const initPostHog = async () => {
  if (!POSTHOG_KEY || typeof window === "undefined") return;

  const { default: posthog } = await import("posthog-js");

  if (posthog.__loaded) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    disable_surveys: true,
    disable_session_recording: true,
    persistence: "localStorage+cookie",
  });
};

const schedulePostHogInit = () => {
  if (!POSTHOG_KEY || typeof window === "undefined") return;

  const run = () => {
    void initPostHog();
  };

  const maybeRequestIdleCallback = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;

  if (typeof maybeRequestIdleCallback === "function") {
    maybeRequestIdleCallback(run, { timeout: 4000 });
    return;
  }

  setTimeout(run, 1500);
};

if (POSTHOG_KEY && typeof window !== "undefined") {
  if (document.readyState === "complete") {
    schedulePostHogInit();
  } else {
    window.addEventListener("load", schedulePostHogInit, { once: true });
  }
}
