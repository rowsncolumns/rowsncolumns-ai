"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  OctagonX,
  X,
} from "lucide-react";

import { getThemeModeFromBodyClass, type ThemeMode } from "@/lib/theme-preference";

export function SonnerToaster() {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const syncTheme = () => {
      setTheme(getThemeModeFromBodyClass());
    };

    syncTheme();

    if (typeof MutationObserver === "undefined") {
      return;
    }

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <Toaster
      theme={theme}
      position="top-center"
      richColors={false}
      expand
      closeButton
      icons={{
        success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
        warning: <AlertTriangle className="h-5 w-5 text-amber-500" />,
        error: <OctagonX className="h-5 w-5 text-rose-500" />,
        loading: <Loader2 className="h-5 w-5 animate-spin text-(--accent)" />,
        close: <X className="h-4 w-4" />,
      }}
      toastOptions={{
        duration: 3600,
        classNames: {
          toast:
            "group w-[min(95vw,560px)] rounded-2xl border border-(--card-border) bg-(--card-bg-solid) px-4 py-3 text-foreground shadow-[0_20px_56px_rgba(15,23,42,0.22)] backdrop-blur-md",
          content: "gap-1.5",
          title: "text-sm font-semibold tracking-[-0.01em] text-foreground",
          description: "text-xs leading-5 text-(--muted-foreground)",
          icon: "mt-0.5",
          closeButton:
            "h-7 w-7 rounded-full border border-(--card-border) bg-(--assistant-chip-bg) text-(--muted-foreground) transition hover:bg-(--assistant-chip-hover) hover:text-foreground",
          actionButton:
            "rounded-lg bg-(--button-primary-bg) !text-[var(--button-primary-foreground)] px-3 text-xs font-semibold hover:bg-(--button-primary-bg-hover)",
          cancelButton:
            "rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) px-3 text-xs font-medium text-foreground hover:bg-(--assistant-chip-hover)",
          success:
            "border-emerald-400/40 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(16,185,129,0.04))]",
          warning:
            "border-amber-400/40 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(245,158,11,0.05))]",
          error:
            "border-rose-400/45 bg-[linear-gradient(135deg,rgba(244,63,94,0.16),rgba(244,63,94,0.05))]",
          info:
            "border-blue-400/40 bg-[linear-gradient(135deg,rgba(59,130,246,0.14),rgba(59,130,246,0.04))]",
          loading: "border-(--card-border) bg-(--card-bg-solid)",
        },
      }}
    />
  );
}
