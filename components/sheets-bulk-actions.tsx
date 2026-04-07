"use client";

import React from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSheetsSelection } from "@/components/sheets-selection";
import { cn } from "@/lib/utils";

type DeleteDocumentResponse = {
  error?: string;
};

export function SheetsBulkActions({ className }: { className?: string }) {
  const router = useRouter();
  const { selectedItems, selectedCount, clearSelection } = useSheetsSelection();
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  if (selectedCount === 0) {
    return null;
  }

  const handleDeleteSelected = async () => {
    if (isDeleting || selectedItems.length === 0) {
      return;
    }

    setIsDeleting(true);
    try {
      const settled = await Promise.allSettled(
        selectedItems.map(async (item) => {
          const response = await fetch(
            `/api/documents/${encodeURIComponent(item.docId)}`,
            {
              method: "DELETE",
            },
          );
          const payload = (await response
            .json()
            .catch(() => null)) as DeleteDocumentResponse | null;
          if (!response.ok) {
            throw new Error(payload?.error || `Failed to delete "${item.title}".`);
          }
          return item.docId;
        }),
      );

      const succeededCount = settled.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failedResults = settled.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      if (succeededCount > 0) {
        toast.success(
          `${succeededCount} sheet${succeededCount === 1 ? "" : "s"} deleted.`,
        );
      }
      if (failedResults.length > 0) {
        const firstReason = failedResults[0]?.reason;
        const message =
          firstReason instanceof Error
            ? firstReason.message
            : "Some sheets could not be deleted.";
        toast.error(message);
      }

      clearSelection();
      setIsDialogOpen(false);
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-xs font-medium text-(--muted-foreground)">
          {selectedCount} selected
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-9 rounded-lg px-3"
          onClick={clearSelection}
          disabled={isDeleting}
        >
          <X className="h-4 w-4" />
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-9 rounded-lg px-3 text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={() => setIsDialogOpen(true)}
          disabled={isDeleting}
        >
          <Trash2 className="h-4 w-4" />
          Delete selected
        </Button>
      </div>

      <AlertDialog
        open={isDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!isDeleting) {
            setIsDialogOpen(nextOpen);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected sheets?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {selectedCount} selected sheet
              {selectedCount === 1 ? "" : "s"}, including workbook data and
              sharing settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSelected}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Deleting...
                </span>
              ) : (
                "Delete selected"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
