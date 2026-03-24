"use client";

import * as React from "react";
import { authClient } from "@/lib/auth/client";

type SocialProvider = "google" | "github";

const isSocialProvider = (value: string): value is SocialProvider =>
  value === "google" || value === "github";

const normalizeCallbackPath = (value: string | null) => {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/excel-addin";
};

export default function ExcelAuthStartPage() {
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const providerValue = params.get("provider")?.trim() ?? "";
    const callbackValue = params.get("callbackURL");

    if (!isSocialProvider(providerValue)) {
      setError("Missing or invalid provider.");
      return;
    }

    const callbackURL = normalizeCallbackPath(callbackValue);

    void authClient.signIn
      .social({
        provider: providerValue,
        callbackURL,
        errorCallbackURL: callbackURL,
        newUserCallbackURL: callbackURL,
      })
      .then((result) => {
        if (result.error) {
          setError(result.error.message ?? "Unable to start sign-in.");
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 text-center">
      <div>
        <p className="text-sm text-(--muted-foreground)">Opening sign-in...</p>
        {error && (
          <p className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
