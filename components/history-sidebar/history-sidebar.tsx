"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useActivityHistory,
  type ActivityFilters,
} from "@/hooks/use-activity-history";
import { ActivityItem } from "./activity-item";
import type { OperationSource } from "@/lib/operation-history/types";
import { IconButton } from "@rowsncolumns/ui";

interface HistorySidebarProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
  canEdit: boolean;
  currentUser?: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
}

type SourceFilter = "all" | "agent" | "user";

export function HistorySidebar({
  documentId,
  isOpen,
  onClose,
  canEdit,
  currentUser,
}: HistorySidebarProps) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const filters: ActivityFilters = {
    sources:
      sourceFilter === "all" ? undefined : [sourceFilter as OperationSource],
  };

  const {
    items,
    isLoading,
    error,
    hasMore,
    fetchMore,
    refresh,
    undoOperation,
  } = useActivityHistory({
    documentId,
    limit: 20,
    filters,
    autoFetch: isOpen,
  });

  const entries: Array<[string, string]> = [];
  const currentDisplayName =
    currentUser?.name?.trim() || currentUser?.email?.trim();
  if (currentUser?.id && currentDisplayName) {
    entries.push([currentUser.id, currentDisplayName]);
  }
  const actorNameById = Object.fromEntries(entries);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "z-50 flex h-full w-[22rem] max-w-[calc(100%-1rem)] flex-col",
        "border-r border-[var(--card-border)] bg-[var(--card-bg)]",
        "shadow-[0_8px_24px_rgba(0,0,0,0.05)]",
        "transform transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "-translate-x-full",
      )}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--foreground)]">
            Version History
          </h2>
          <IconButton
            onClick={onClose}
            variant="secondary"
            size="sm"
            aria-label="Close version history"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </IconButton>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b border-[var(--card-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Filter
          </span>
          <div className="inline-flex items-center gap-1 rounded-xl border border-[var(--card-border)] bg-[var(--nav-hover)] p-1">
            {(["all", "agent", "user"] as const).map((filter) => (
              <Button
                key={filter}
                onClick={() => setSourceFilter(filter)}
                variant={sourceFilter === filter ? "primary" : "secondary"}
                size="sm"
                className={cn(
                  "h-8 rounded-lg px-3 text-sm font-medium capitalize shadow-none",
                  sourceFilter === filter &&
                    "shadow-[0_1px_8px_rgba(0,0,0,0.12)]",
                )}
              >
                {filter === "all"
                  ? "All"
                  : filter === "agent"
                    ? "Agent"
                    : "User"}
              </Button>
            ))}
          </div>
          <Button
            onClick={refresh}
            disabled={isLoading}
            variant="secondary"
            size="sm"
            className="ml-auto h-8 w-8 rounded-lg p-0"
            title="Refresh"
          >
            <svg
              className={cn("h-4 w-4", isLoading && "animate-spin")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </Button>
        </div>
      </div>

      {/* Activity List */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error && (
          <div className="p-1">
            <div className="rounded-xl border border-red-200/70 bg-red-50/80 p-3">
              <p className="text-sm text-red-600">{error}</p>
              <button
                onClick={refresh}
                className="mt-2 text-sm font-medium text-red-600 hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {!error && items.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[color:color-mix(in_srgb,var(--card-border)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--card-bg)_88%,transparent)] p-8 text-center">
            <svg
              className="h-12 w-12 text-[var(--muted-foreground)] opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              No version history yet
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Changes will appear here once tracking is enabled
            </p>
          </div>
        )}

        {!error && items.length > 0 && (
          <div className="space-y-2">
            {items.map((activity) => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                onUndo={undoOperation}
                canUndo={canEdit}
                actorNameById={actorNameById}
              />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore && items.length > 0 && (
          <div className="pt-3">
            <Button
              onClick={fetchMore}
              disabled={isLoading}
              variant="secondary"
              size="sm"
              className={cn("h-10 w-full rounded-xl text-sm font-medium")}
            >
              {isLoading ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && items.length === 0 && (
          <div className="flex items-center justify-center p-8">
            <svg
              className="h-6 w-6 animate-spin text-[var(--muted-foreground)]"
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
          </div>
        )}
      </div>
    </div>
  );
}
