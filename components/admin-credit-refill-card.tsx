"use client";

import * as React from "react";

import { INITIAL_CREDITS } from "@/lib/credits/pricing";

type AdminCreditRefillCardProps = {
  currentUserId: string;
};

type RefillResponse = {
  refill?: {
    userId: string;
    previousBalance: number;
    nextBalance: number;
    delta: number;
    creditDay: string;
    updatedAt: string;
  };
  error?: string;
};

export function AdminCreditRefillCard({ currentUserId }: AdminCreditRefillCardProps) {
  const [targetUserId, setTargetUserId] = React.useState(currentUserId);
  const [amount, setAmount] = React.useState(String(INITIAL_CREDITS));
  const [mode, setMode] = React.useState<"set" | "add">("set");
  const [note, setNote] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);

      const parsedAmount = Number.parseInt(amount, 10);
      if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
        setError("Amount must be a non-negative integer.");
        return;
      }

      const trimmedTargetUserId = targetUserId.trim();
      if (!trimmedTargetUserId) {
        setError("User ID is required.");
        return;
      }

      setIsSubmitting(true);
      try {
        const response = await fetch("/api/credits/refill", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: trimmedTargetUserId,
            mode,
            amount: parsedAmount,
            note: note.trim() || undefined,
          }),
        });

        const payload = (await response.json().catch(() => null)) as RefillResponse | null;
        if (!response.ok || !payload?.refill) {
          setError(payload?.error ?? "Failed to refill credits.");
          return;
        }

        setSuccess(
          `Updated ${payload.refill.userId}: ${payload.refill.previousBalance} -> ${payload.refill.nextBalance}`,
        );
      } catch {
        setError("Failed to refill credits.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [amount, mode, note, targetUserId],
  );

  return (
    <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-4">
      <h3 className="display-font text-lg font-semibold text-foreground">
        Admin Credit Refill
      </h3>
      <p className="mt-1 text-xs">
        Manual refill endpoint for Phase 2 soft-cap handling.
      </p>

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div className="space-y-1">
          <label htmlFor="refill-user-id" className="text-xs font-medium text-foreground">
            User ID
          </label>
          <input
            id="refill-user-id"
            type="text"
            value={targetUserId}
            onChange={(event) => setTargetUserId(event.target.value)}
            className="h-10 w-full rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none focus:border-black/30"
            placeholder="Target user ID"
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="refill-mode" className="text-xs font-medium text-foreground">
              Mode
            </label>
            <select
              id="refill-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as "set" | "add")}
              className="h-10 w-full rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none focus:border-black/30"
            >
              <option value="set">Set balance</option>
              <option value="add">Add credits</option>
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="refill-amount" className="text-xs font-medium text-foreground">
              Amount
            </label>
            <input
              id="refill-amount"
              type="number"
              min={0}
              step={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="h-10 w-full rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none focus:border-black/30"
              required
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="refill-note" className="text-xs font-medium text-foreground">
            Note (optional)
          </label>
          <input
            id="refill-note"
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="h-10 w-full rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none focus:border-black/30"
            placeholder="Reason for manual refill"
          />
        </div>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        {success ? <p className="text-xs text-emerald-700">{success}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-4 text-sm font-medium text-foreground transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Applying..." : "Apply Refill"}
        </button>
      </form>
    </div>
  );
}

