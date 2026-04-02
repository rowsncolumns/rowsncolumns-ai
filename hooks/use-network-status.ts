"use client";

import { useState, useEffect } from "react";

export function useNetworkStatus() {
  // Keep first client render aligned with SSR to avoid hydration mismatches.
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncFromNavigator = () => {
      if (typeof navigator.onLine === "boolean") {
        setIsOffline(!navigator.onLine);
      } else {
        setIsOffline(false);
      }
    };

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    syncFromNavigator();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return { isOffline };
}
