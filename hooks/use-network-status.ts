"use client";

import { useState, useEffect } from "react";

export function useNetworkStatus() {
  const [isOffline, setIsOffline] = useState(() => {
    if (typeof navigator === "undefined") {
      return false;
    }
    return !navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return { isOffline };
}
