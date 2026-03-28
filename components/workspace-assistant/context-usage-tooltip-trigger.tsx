"use client";

import { AlertTriangle } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AssistantContextUsage } from "@/lib/assistant/context-usage-state";

const formatTokenCount = (value: number) =>
  Number.isFinite(value)
    ? Math.max(0, Math.round(value)).toLocaleString()
    : "0";

type ContextUsageTooltipTriggerProps = {
  contextUsage?: AssistantContextUsage | null;
  warningCopy: string;
};

export function ContextUsageTooltipTrigger({
  contextUsage,
  warningCopy,
}: ContextUsageTooltipTriggerProps) {
  if (!contextUsage || contextUsage.warning !== "high") {
    return null;
  }

  const usageSummary = `${contextUsage.usedPercent}% context used`;
  const remainingSummary = `${contextUsage.remainingPercent}% context remaining`;
  const tokenSummary = `${formatTokenCount(contextUsage.inputTokensPeak)} / ${formatTokenCount(contextUsage.contextWindowTokens)} input tokens`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Context usage: ${usageSummary}, ${remainingSummary}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-orange-500/45 bg-orange-100 text-orange-700 transition-colors hover:bg-orange-200 dark:border-orange-400/45 dark:bg-orange-500/15 dark:text-orange-300 dark:hover:bg-orange-500/25"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        <div className="space-y-1">
          <p className="font-medium">{remainingSummary}</p>
          <p className="opacity-90">{usageSummary}</p>
          <p className="opacity-90">{tokenSummary}</p>
          <p className="font-medium text-orange-700 dark:text-orange-300">
            {warningCopy}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
