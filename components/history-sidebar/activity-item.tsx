"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ActivityItem as ActivityItemType } from "@/lib/operation-history/types";

interface ActivityItemProps {
  activity: ActivityItemType;
  onUndo: (operationId: string) => Promise<{ success: boolean; error?: string }>;
  canUndo: boolean;
  actorNameById: Record<string, string>;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUserDisplayName(identifier: string | undefined): string {
  if (!identifier) {
    return "User";
  }
  // If it's an email, show the part before @
  if (identifier.includes("@")) {
    const name = identifier.split("@")[0];
    // Capitalize first letter and replace common separators
    return name
      ? name
          .replace(/[._-]/g, " ")
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ")
      : "User";
  }
  // If it looks like a UUID or system ID, just show "User"
  if (identifier.match(/^[a-f0-9-]{36}$/i) || identifier === "unknown-user") {
    return "User";
  }
  // Otherwise show the identifier as-is
  return identifier;
}

function getActorDisplayName(
  activity: ActivityItemType,
  actorNameById: Record<string, string>,
): string {
  if (activity.actorType === "assistant" || activity.source === "agent") {
    return activity.metadata?.toolName
      ? `Agent (${activity.metadata.toolName})`
      : "Agent";
  }
  if (activity.actorType === "user" || activity.source === "user") {
    const metadataNameCandidates = [
      activity.metadata?.performedBy,
      activity.metadata?.userName,
      activity.metadata?.actorName,
    ];
    for (const candidate of metadataNameCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    const metadataUserId =
      typeof activity.metadata?.userId === "string"
        ? activity.metadata.userId
        : undefined;
    if (metadataUserId && actorNameById[metadataUserId]) {
      return actorNameById[metadataUserId]!;
    }
    if (activity.actorId && actorNameById[activity.actorId]) {
      return actorNameById[activity.actorId]!;
    }

    const metadataEmail =
      typeof activity.metadata?.userEmail === "string"
        ? activity.metadata.userEmail
        : undefined;
    if (metadataEmail) {
      return formatUserDisplayName(metadataEmail);
    }

    // Try to get user identifier from metadata or actorId
    const userId = metadataUserId || activity.actorId;
    return formatUserDisplayName(userId);
  }
  return "System";
}

function getActivityDescription(activity: ActivityItemType): string {
  const toolName = activity.metadata?.toolName as string | undefined;

  if (activity.activityType === "rollback") {
    return "Reverted changes";
  }
  if (activity.activityType === "restore") {
    return "Restored changes";
  }

  // Write activity
  if (toolName) {
    // Convert tool name to readable format
    const readable = toolName
      .replace(/^spreadsheet_/, "")
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .trim()
      .toLowerCase();
    return readable.charAt(0).toUpperCase() + readable.slice(1);
  }

  return "Made changes";
}

function formatDiffSummary(activity: ActivityItemType): {
  impactLine: string | null;
  sheetLines: string[];
  structuralLine: string | null;
} {
  const summary = activity.diffSummary;
  if (!summary) {
    return { impactLine: null, sheetLines: [], structuralLine: null };
  }

  const impactParts: string[] = [];
  if (summary.changedCellCount > 0) {
    impactParts.push(
      `${summary.changedCellCount} cell${summary.changedCellCount === 1 ? "" : "s"}`,
    );
  }
  if (summary.totalOps > 0) {
    impactParts.push(
      `${summary.totalOps} op${summary.totalOps === 1 ? "" : "s"}`,
    );
  }

  const sheetLines = summary.sheets.slice(0, 2).map((sheet) => {
    const sampleSuffix =
      sheet.sampleCells.length > 0
        ? ` (${sheet.sampleCells.slice(0, 3).join(", ")})`
        : "";
    return `Sheet ${sheet.sheetId}: ${sheet.a1Range} • ${sheet.cellCount} cell${sheet.cellCount === 1 ? "" : "s"}${sampleSuffix}`;
  });

  if (summary.sheets.length > 2) {
    sheetLines.push(
      `+${summary.sheets.length - 2} more sheet impact${summary.sheets.length - 2 === 1 ? "" : "s"}`,
    );
  }

  return {
    impactLine: impactParts.length > 0 ? impactParts.join(" • ") : null,
    sheetLines,
    structuralLine:
      summary.structuralChanges.length > 0
        ? `Structure: ${summary.structuralChanges.join(", ")}`
        : null,
  };
}

function ActorIcon({ activity }: { activity: ActivityItemType }) {
  const isAgent =
    activity.source === "agent" || activity.actorType === "assistant";
  const isUser = activity.source === "user" || activity.actorType === "user";

  if (isAgent) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,#2563eb_16%,var(--card-bg))] text-blue-600">
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      </div>
    );
  }

  // System/backend
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,var(--card-border)_28%,var(--card-bg))] text-[var(--muted-foreground)]">
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    </div>
  );
}

export function ActivityItem({
  activity,
  onUndo,
  canUndo,
  actorNameById,
}: ActivityItemProps) {
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  const handleUndo = async () => {
    setIsUndoing(true);
    setUndoError(null);

    const result = await onUndo(activity.id);

    if (!result.success) {
      setUndoError(result.error || "Undo failed");
    }

    setIsUndoing(false);
  };

  const isReverted = !!activity.revertedAt;
  const diffSummary = formatDiffSummary(activity);

  return (
    <div
      className={cn(
        "group rounded-2xl border px-3.5 py-3",
        "border-[color:color-mix(in_srgb,var(--card-border)_75%,transparent)]",
        "bg-[color:color-mix(in_srgb,var(--card-bg)_90%,transparent)]",
        "shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-150",
        "hover:border-[color:color-mix(in_srgb,var(--card-border)_95%,transparent)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.07)]",
        isReverted && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <ActorIcon activity={activity} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-[var(--foreground)]">
              {getActorDisplayName(activity, actorNameById)}
            </span>
            {activity.activityType === "rollback" && (
              <span className="inline-flex items-center rounded-full border border-[color:color-mix(in_srgb,#d97706_35%,transparent)] bg-[color:color-mix(in_srgb,#f59e0b_18%,var(--card-bg))] px-2 py-0.5 text-[11px] font-semibold tracking-wide text-amber-700">
                Rollback
              </span>
            )}
            {isReverted && (
              <span className="inline-flex items-center rounded-full border border-[color:color-mix(in_srgb,var(--card-border)_90%,transparent)] bg-[color:color-mix(in_srgb,var(--card-border)_22%,var(--card-bg))] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
                Reverted
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
            {getActivityDescription(activity)}
          </p>
        </div>

        {!isReverted && activity.isRevertable && canUndo && (
          <Button
            onClick={handleUndo}
            disabled={isUndoing}
            variant="secondary"
            size="sm"
            className={cn("h-8 shrink-0 rounded-lg px-3 text-xs font-semibold")}
          >
            {isUndoing ? (
              <svg
                className="h-3 w-3 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              "Undo"
            )}
          </Button>
        )}
      </div>

      {(diffSummary.impactLine ||
        diffSummary.sheetLines.length > 0 ||
        diffSummary.structuralLine) && (
        <div className="mt-2.5 rounded-xl border border-[color:color-mix(in_srgb,var(--card-border)_70%,transparent)] bg-[color:color-mix(in_srgb,var(--nav-hover)_38%,transparent)] px-2.5 py-2">
          {diffSummary.impactLine && (
            <p className="text-xs font-medium text-[var(--foreground)]">
              {diffSummary.impactLine}
            </p>
          )}
          {diffSummary.sheetLines.map((line) => (
            <p
              key={line}
              className="mt-1 truncate font-mono text-[11px] text-[var(--muted-foreground)]"
            >
              {line}
            </p>
          ))}
          {diffSummary.structuralLine && (
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              {diffSummary.structuralLine}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
        <span>{formatRelativeTime(activity.createdAt)}</span>
        <span>•</span>
        <span className="font-medium">
          v{activity.sharedbVersionFrom} → v{activity.sharedbVersionTo}
        </span>
      </div>

      {undoError && <p className="mt-1.5 text-xs text-red-500">{undoError}</p>}
    </div>
  );
}
