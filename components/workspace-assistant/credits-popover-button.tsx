"use client";

import { CircleDollarSign, Loader2 } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconButton } from "@rowsncolumns/ui";
import { Button } from "../ui/button";

type CreditsPopoverButtonProps = {
  isCreditsLoading: boolean;
  isUnlimitedCredits: boolean;
  remainingCredits: number | null;
  dailyLimit: number;
};

const resolveCreditsLabel = (input: {
  isCreditsLoading: boolean;
  isUnlimitedCredits: boolean;
  remainingCredits: number | null;
  dailyLimit: number;
}) => {
  if (input.isCreditsLoading) {
    return "Loading credits...";
  }

  if (input.isUnlimitedCredits) {
    return "Credits: Unlimited";
  }

  return `Credits: ${input.remainingCredits ?? 0}/${input.dailyLimit}`;
};

export function CreditsPopoverButton({
  isCreditsLoading,
  isUnlimitedCredits,
  remainingCredits,
  dailyLimit,
}: CreditsPopoverButtonProps) {
  const creditsLabel = resolveCreditsLabel({
    isCreditsLoading,
    isUnlimitedCredits,
    remainingCredits,
    dailyLimit,
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          className="rnc-assistant-chip inline-flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-[#faf6f0] text-(--muted-foreground) px-2"
          aria-label={creditsLabel}
        >
          {isCreditsLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CircleDollarSign className="h-3.5 w-3.5" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--muted-foreground)">
          Credits
        </p>
        {isCreditsLoading ? (
          <div className="flex items-center gap-2 text-sm text-(--muted-foreground)">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Loading current balance...</span>
          </div>
        ) : isUnlimitedCredits ? (
          <p className="text-sm text-foreground">Unlimited credits enabled.</p>
        ) : (
          <div className="space-y-1 text-sm">
            <p className="text-foreground">
              Remaining today:{" "}
              <span className="font-semibold">{remainingCredits ?? 0}</span>
            </p>
            <p className="text-(--muted-foreground)">
              Daily allocation: {dailyLimit}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
