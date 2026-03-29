"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

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
      richColors
      closeButton
      toastOptions={{
        duration: 3000,
      }}
    />
  );
}
