"use client";

import * as React from "react";

const isTouchInputDevice = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const hasCoarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none), (pointer: coarse)").matches;
  const hasTouchPoints =
    typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;

  return hasCoarsePointer || hasTouchPoints;
};

export const useIsTouchInputDevice = () => {
  // Keep initial render deterministic between SSR and hydration.
  const [isTouch, setIsTouch] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const updateTouchState = () => {
      setIsTouch(isTouchInputDevice());
    };

    updateTouchState();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateTouchState);
      return () => {
        mediaQuery.removeEventListener("change", updateTouchState);
      };
    }

    mediaQuery.addListener(updateTouchState);
    return () => {
      mediaQuery.removeListener(updateTouchState);
    };
  }, []);

  return isTouch;
};
