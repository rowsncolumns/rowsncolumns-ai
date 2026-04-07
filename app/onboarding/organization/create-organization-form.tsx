"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth/client";

const MAX_NAME_LENGTH = 80;

const slugifyOrganizationName = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  if (normalized) {
    return normalized;
  }

  return `org-${Math.random().toString(36).slice(2, 10)}`;
};

export function CreateOrganizationForm({
  callbackPath,
}: {
  callbackPath: string;
}) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedName = useMemo(
    () => name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH),
    [name],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!normalizedName || isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const slug = slugifyOrganizationName(normalizedName);
      const result = await authClient.organization.create({
        name: normalizedName,
        slug,
      });

      if (result?.error) {
        setError(
          result.error.message ||
            "Failed to create organization. Please try a different name.",
        );
        setIsSubmitting(false);
        return;
      }

      window.location.assign(callbackPath);
    } catch {
      setError("Failed to create organization. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="organization-name"
          className="text-sm font-medium text-foreground"
        >
          Organization name
        </label>
        <input
          id="organization-name"
          name="organization-name"
          type="text"
          autoComplete="organization"
          placeholder="Acme Finance"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
          required
          disabled={isSubmitting}
          className="h-11 w-full rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 text-sm text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--accent) disabled:cursor-not-allowed disabled:opacity-70"
        />
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!normalizedName || isSubmitting}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-(--accent) px-4 text-sm font-semibold text-(--accent-foreground) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating organization...
          </>
        ) : (
          "Create organization"
        )}
      </button>
    </form>
  );
}
