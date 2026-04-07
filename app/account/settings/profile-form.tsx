"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type AccountProfileFormProps = {
  initialFirstName: string;
  initialLastName: string;
  email: string;
};

type ProfileUpdateResponse = {
  error?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
};

const normalizeNamePart = (value: string): string =>
  value.trim().replace(/\s+/g, " ").slice(0, 80);

export function AccountProfileForm({
  initialFirstName,
  initialLastName,
  email,
}: AccountProfileFormProps) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedFirstName = useMemo(
    () => normalizeNamePart(firstName),
    [firstName],
  );
  const normalizedLastName = useMemo(() => normalizeNamePart(lastName), [lastName]);
  const hasChanges =
    normalizedFirstName !== normalizeNamePart(initialFirstName) ||
    normalizedLastName !== normalizeNamePart(initialLastName);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedFirstName || isSubmitting || !hasChanges) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: normalizedFirstName,
          lastName: normalizedLastName,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ProfileUpdateResponse
        | null;

      if (!response.ok) {
        const message = payload?.error ?? "Failed to update profile.";
        setError(message);
        return;
      }

      toast.success("Account profile updated.");
      router.refresh();
    } catch {
      setError("Failed to update profile.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="account-first-name"
            className="text-sm font-medium text-foreground"
          >
            First name
          </label>
          <input
            id="account-first-name"
            type="text"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            autoComplete="given-name"
            maxLength={80}
            required
            disabled={isSubmitting}
            className="h-11 w-full rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 text-sm text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--focus-border) disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="account-last-name"
            className="text-sm font-medium text-foreground"
          >
            Last name
          </label>
          <input
            id="account-last-name"
            type="text"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            autoComplete="family-name"
            maxLength={80}
            disabled={isSubmitting}
            className="h-11 w-full rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 text-sm text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--focus-border) disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Email</label>
        <input
          type="email"
          value={email}
          disabled
          className="h-11 w-full cursor-not-allowed rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 text-sm text-(--muted-foreground) opacity-90"
        />
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={!normalizedFirstName || isSubmitting || !hasChanges}>
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          "Save"
        )}
      </Button>
    </form>
  );
}
