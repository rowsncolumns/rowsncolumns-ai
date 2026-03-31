"use client";

import { useState, useCallback, useEffect } from "react";
import type { ActivityItem, OperationSource, ActivityType } from "@/lib/operation-history/types";

export interface ActivityFilters {
  sources?: OperationSource[];
  activityTypes?: ActivityType[];
  from?: string;
  to?: string;
}

export interface UseActivityHistoryOptions {
  documentId: string;
  limit?: number;
  filters?: ActivityFilters;
  autoFetch?: boolean;
}

export interface UseActivityHistoryResult {
  items: ActivityItem[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  fetchMore: () => Promise<void>;
  refresh: () => Promise<void>;
  undoOperation: (
    operationId: string,
    options?: { reason?: string }
  ) => Promise<{ success: boolean; error?: string }>;
}

export function useActivityHistory({
  documentId,
  limit = 20,
  filters,
  autoFetch = true,
}: UseActivityHistoryOptions): UseActivityHistoryResult {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const buildQueryParams = useCallback(
    (nextCursor?: string | null) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));

      if (nextCursor) {
        params.set("cursor", nextCursor);
      }

      if (filters?.sources?.length) {
        params.set("sources", filters.sources.join(","));
      }

      if (filters?.activityTypes?.length) {
        params.set("activityTypes", filters.activityTypes.join(","));
      }

      if (filters?.from) {
        params.set("from", filters.from);
      }

      if (filters?.to) {
        params.set("to", filters.to);
      }

      return params.toString();
    },
    [limit, filters]
  );

  const fetchActivities = useCallback(
    async (append = false) => {
      if (!documentId) return;

      setIsLoading(true);
      setError(null);

      try {
        const queryString = buildQueryParams(append ? cursor : null);
        const response = await fetch(
          `/api/documents/${documentId}/activity?${queryString}`
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Failed to fetch activities");
        }

        const data = await response.json();

        if (append) {
          setItems((prev) => [...prev, ...data.items]);
        } else {
          setItems(data.items);
        }

        setCursor(data.nextCursor);
        setHasMore(!!data.nextCursor);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [documentId, buildQueryParams, cursor]
  );

  const refresh = useCallback(async () => {
    setCursor(null);
    setHasMore(true);
    await fetchActivities(false);
  }, [fetchActivities]);

  const fetchMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchActivities(true);
  }, [fetchActivities, hasMore, isLoading]);

  const undoOperation = useCallback(
    async (operationId: string, options?: { reason?: string }) => {
      try {
        const reason = options?.reason?.trim();
        const payload = {
          operationId,
          confirm: true,
          ...(reason ? { reason } : {}),
        };

        const response = await fetch(`/api/documents/${documentId}/undo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          return { success: false, error: data.error || "Undo failed" };
        }

        // Refresh the list after successful undo
        await refresh();

        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return { success: false, error: message };
      }
    },
    [documentId, refresh]
  );

  // Auto-fetch on mount and when filters change
  useEffect(() => {
    if (autoFetch) {
      refresh();
    }
  }, [autoFetch, documentId, filters?.sources?.join(","), filters?.activityTypes?.join(",")]);

  return {
    items,
    isLoading,
    error,
    hasMore,
    fetchMore,
    refresh,
    undoOperation,
  };
}
