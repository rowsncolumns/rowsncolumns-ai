"use client";

import { useEffect } from "react";

const BODY_CLASS = "body-new-workspace";

export function NewBodyClass() {
  useEffect(() => {
    document.body.classList.add(BODY_CLASS);

    return () => {
      document.body.classList.remove(BODY_CLASS);
    };
  }, []);

  return null;
}
