"use client";

import { useState, useCallback, useEffect } from "react";
import type {
  ActivityItem,
  OperationSource,
  ActivityType,
} from "@/lib/operation-history/types";

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
  undoOperation: (operationId: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
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
  const sourcesFilterValue = filters?.sources?.join(",") ?? "";
  const activityTypesFilterValue = filters?.activityTypes?.join(",") ?? "";
  const fromFilterValue = filters?.from?.trim() ?? "";
  const toFilterValue = filters?.to?.trim() ?? "";

  const buildQueryParams = useCallback(
    (nextCursor?: string | null) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));

      if (nextCursor) {
        params.set("cursor", nextCursor);
      }

      if (sourcesFilterValue) {
        params.set("sources", sourcesFilterValue);
      }

      if (activityTypesFilterValue) {
        params.set("activityTypes", activityTypesFilterValue);
      }

      if (fromFilterValue) {
        params.set("from", fromFilterValue);
      }

      if (toFilterValue) {
        params.set("to", toFilterValue);
      }

      return params.toString();
    },
    [
      limit,
      sourcesFilterValue,
      activityTypesFilterValue,
      fromFilterValue,
      toFilterValue,
    ],
  );

  const fetchActivities = useCallback(
    async ({
      append = false,
      cursorValue = null,
    }: {
      append?: boolean;
      cursorValue?: string | null;
    } = {}) => {
      if (!documentId) return;

      setIsLoading(true);
      setError(null);

      try {
        const queryString = buildQueryParams(append ? cursorValue : null);
        const response = await fetch(
          `/api/documents/${documentId}/activity?${queryString}`,
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
    [documentId, buildQueryParams],
  );

  const refresh = useCallback(async () => {
    setCursor(null);
    setHasMore(true);
    await fetchActivities({ append: false, cursorValue: null });
  }, [fetchActivities]);

  const fetchMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchActivities({ append: true, cursorValue: cursor });
  }, [fetchActivities, hasMore, isLoading, cursor]);

  const undoOperation = useCallback(
    async (operationId: string) => {
      try {
        const payload = {
          operationId,
          confirm: true,
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
    [documentId, refresh],
  );

  // Auto-fetch on mount and when filters change
  useEffect(() => {
    if (autoFetch) {
      refresh();
    }
  }, [autoFetch, refresh]);

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
