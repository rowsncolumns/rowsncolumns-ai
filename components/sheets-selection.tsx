"use client";

import React from "react";

export type SheetsSelectionItem = {
  docId: string;
  title: string;
  accessType: "owned" | "shared";
  templateScope?: "none" | "personal" | "organization" | "global";
};

export const isSheetsItemBatchDeletable = (
  item: SheetsSelectionItem,
): boolean => item.accessType === "owned" && item.templateScope !== "global";

type SheetsSelectionContextValue = {
  items: SheetsSelectionItem[];
  selectedItems: SheetsSelectionItem[];
  selectedCount: number;
  isSelected: (docId: string) => boolean;
  toggleItem: (item: SheetsSelectionItem, checked?: boolean) => void;
  toggleAll: (checked: boolean) => void;
  clearSelection: () => void;
};

const SheetsSelectionContext =
  React.createContext<SheetsSelectionContextValue | null>(null);

export function SheetsSelectionProvider({
  initialItems,
  children,
}: {
  initialItems: SheetsSelectionItem[];
  children: React.ReactNode;
}) {
  const items = React.useMemo(() => initialItems, [initialItems]);
  const itemsById = React.useMemo(
    () => new Map(items.map((item) => [item.docId, item])),
    [items],
  );
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    setSelectedIds((current) =>
      current.filter((docId) => {
        const item = itemsById.get(docId);
        return Boolean(item && isSheetsItemBatchDeletable(item));
      }),
    );
  }, [itemsById]);

  const selectedItems = React.useMemo(() => {
    const next: SheetsSelectionItem[] = [];
    for (const docId of selectedIds) {
      const item = itemsById.get(docId);
      if (!item || !isSheetsItemBatchDeletable(item)) {
        continue;
      }
      next.push(item);
    }
    return next;
  }, [itemsById, selectedIds]);
  const selectedSet = React.useMemo(
    () => new Set(selectedItems.map((item) => item.docId)),
    [selectedItems],
  );

  const toggleItem = React.useCallback(
    (item: SheetsSelectionItem, checked?: boolean) => {
      if (!isSheetsItemBatchDeletable(item)) {
        return;
      }

      setSelectedIds((current) => {
        const next = new Set(current);
        const shouldSelect = checked ?? !next.has(item.docId);
        if (shouldSelect) {
          next.add(item.docId);
        } else {
          next.delete(item.docId);
        }
        return Array.from(next);
      });
    },
    [],
  );

  const toggleAll = React.useCallback(
    (checked: boolean) => {
      const selectableIds = items
        .filter((item) => isSheetsItemBatchDeletable(item))
        .map((item) => item.docId);
      setSelectedIds((current) => {
        if (!checked) {
          const next = new Set(current);
          for (const docId of selectableIds) {
            next.delete(docId);
          }
          return Array.from(next);
        }
        const next = new Set(current);
        for (const docId of selectableIds) {
          next.add(docId);
        }
        return Array.from(next);
      });
    },
    [items],
  );

  const clearSelection = React.useCallback(() => {
    setSelectedIds([]);
  }, []);

  const value = React.useMemo<SheetsSelectionContextValue>(
    () => ({
      items,
      selectedItems,
      selectedCount: selectedItems.length,
      isSelected: (docId: string) => selectedSet.has(docId),
      toggleItem,
      toggleAll,
      clearSelection,
    }),
    [
      clearSelection,
      items,
      selectedItems,
      selectedSet,
      toggleAll,
      toggleItem,
    ],
  );

  return (
    <SheetsSelectionContext.Provider value={value}>
      {children}
    </SheetsSelectionContext.Provider>
  );
}

export function useSheetsSelection() {
  const context = React.useContext(SheetsSelectionContext);
  if (!context) {
    throw new Error(
      "useSheetsSelection must be used within SheetsSelectionProvider.",
    );
  }
  return context;
}
