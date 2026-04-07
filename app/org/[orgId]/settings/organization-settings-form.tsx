"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const MAX_NAME_LENGTH = 80;
const MAX_SLUG_LENGTH = 80;

const normalizeSlug = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);

type OrganizationSettingsFormProps = {
  organizationId: string;
  initialName: string;
  initialSlug: string;
};

export function OrganizationSettingsForm({
  organizationId,
  initialName,
  initialSlug,
}: OrganizationSettingsFormProps) {
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedName = useMemo(
    () => name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH),
    [name],
  );
  const normalizedSlug = useMemo(() => normalizeSlug(slug), [slug]);
  const hasChanges =
    normalizedName !== initialName.trim() || normalizedSlug !== initialSlug.trim();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!normalizedName || !normalizedSlug || isSubmitting || !hasChanges) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/organizations/${encodeURIComponent(organizationId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: normalizedName,
            slug: normalizedSlug,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; name?: string; slug?: string }
        | null;

      if (!response.ok) {
        const message = payload?.error ?? "Failed to update organization.";
        setError(message);
        return;
      }

      toast.success("Organization settings updated.");
      window.location.reload();
    } catch {
      setError("Failed to update organization settings.");
    } finally {
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
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
          required
          disabled={isSubmitting}
          className="h-11 w-full rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 text-sm text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--accent) disabled:cursor-not-allowed disabled:opacity-70"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="organization-slug"
          className="text-sm font-medium text-foreground"
        >
          Organization slug
        </label>
        <input
          id="organization-slug"
          name="organization-slug"
          type="text"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          maxLength={MAX_SLUG_LENGTH}
          required
          disabled={isSubmitting}
          className="h-11 w-full rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 text-sm text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--accent) disabled:cursor-not-allowed disabled:opacity-70"
        />
        <p className="text-xs text-(--muted-foreground)">
          URL-safe identifier. Lowercase letters, numbers, and dashes only.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={!normalizedName || !normalizedSlug || isSubmitting || !hasChanges}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          "Save changes"
        )}
      </Button>
    </form>
  );
}
