"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Star, Trash2 } from "lucide-react";
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
import { TemplateSettingsTrigger } from "@/components/template-settings-trigger";
import { Button } from "@/components/ui/button";
import type { DocumentListFilter } from "@/lib/documents/repository";
import { IconButton } from "@rowsncolumns/ui";

type SheetListItem = {
  docId: string;
  title: string;
  createdAt: string;
  lastModifiedAt: string;
  isShared: boolean;
  isTemplate: boolean;
  templateScope?: "none" | "personal" | "global";
  isFavorite: boolean;
  accessType: "owned" | "shared";
};

type SheetsTableProps = {
  documents: SheetListItem[];
  page: number;
  totalPages: number;
  totalCount: number;
  filter: DocumentListFilter;
  query?: string | null;
};

type DeleteDocumentResponse = {
  error?: string;
};

type FavoriteDocumentResponse = {
  favorite?: boolean;
  error?: string;
};

type DuplicateDocumentResponse = {
  documentId?: string;
  error?: string;
};

const buildPageHref = ({
  page,
  filter,
  query,
}: {
  page: number;
  filter: DocumentListFilter;
  query?: string | null;
}) => {
  const searchParams = new URLSearchParams();
  if (page > 1) {
    searchParams.set("page", String(page));
  }
  if (filter !== "owned") {
    searchParams.set("filter", filter);
  }
  const normalizedQuery = query?.trim();
  if (normalizedQuery) {
    searchParams.set("q", normalizedQuery);
  }
  const serialized = searchParams.toString();
  return serialized ? `/sheets?${serialized}` : "/sheets";
};

const formatDate = (value: string, formatter: Intl.DateTimeFormat): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return formatter.format(parsed);
};

const formatUtcFallbackDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export function SheetsTable({
  documents,
  page,
  totalPages,
  totalCount,
  filter,
  query,
}: SheetsTableProps) {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<SheetListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [favoritingDocId, setFavoritingDocId] = useState<string | null>(null);
  const [duplicatingDocId, setDuplicatingDocId] = useState<string | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        hour12: true,
      }),
    [],
  );

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const hasPreviousPage = page > 1;
  const hasNextPage = page < totalPages;
  const emptyStateMessage = query?.trim()
    ? "No sheets match your search."
    : filter === "templates"
      ? "No template sheets found."
      : "No sheets yet. Create your first sheet to get started.";

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) {
      return;
    }

    if (deleteTarget.templateScope === "global") {
      toast.error("Global template sheets cannot be deleted.");
      setDeleteTarget(null);
      return;
    }

    const targetDocId = deleteTarget.docId;
    setIsDeleting(true);
    setDeletingDocId(targetDocId);

    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(deleteTarget.docId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as DeleteDocumentResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete sheet.");
      }

      const shouldGoPreviousPage = documents.length === 1 && page > 1;
      setDeleteTarget(null);
      toast.success("Sheet deleted.");

      if (shouldGoPreviousPage) {
        router.push(
          buildPageHref({
            page: page - 1,
            filter,
            query,
          }),
        );
        return;
      }

      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete sheet.";
      toast.error(message);
    } finally {
      setIsDeleting(false);
      setDeletingDocId(null);
    }
  };

  const handleToggleFavorite = async (document: SheetListItem) => {
    if (isDeleting || favoritingDocId || duplicatingDocId) {
      return;
    }

    const nextFavorite = !document.isFavorite;

    setFavoritingDocId(document.docId);

    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(document.docId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ favorite: nextFavorite }),
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as FavoriteDocumentResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update favorite.");
      }

      toast.success(nextFavorite ? "Added to favorites." : "Removed favorite.");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update favorite.";
      toast.error(message);
    } finally {
      setFavoritingDocId(null);
    }
  };

  const handleDuplicate = async (document: SheetListItem) => {
    if (isDeleting || favoritingDocId || duplicatingDocId) {
      return;
    }

    setDuplicatingDocId(document.docId);

    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(document.docId)}/duplicate`,
        {
          method: "POST",
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as DuplicateDocumentResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to duplicate sheet.");
      }

      if (!payload?.documentId) {
        throw new Error("Failed to duplicate sheet.");
      }

      toast.success("Sheet duplicated.");
      router.push(`/sheets/${payload.documentId}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to duplicate sheet.";
      toast.error(message);
    } finally {
      setDuplicatingDocId(null);
    }
  };

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-(--card-border) bg-(--card-bg-solid)">
        <div className="rnc-sheets-mobile-layout">
          {documents.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-(--muted-foreground)">
              {emptyStateMessage}
            </div>
          ) : (
            <ul className="divide-y divide-(--card-border)">
              {documents.map((document) => {
                const isRowDeleting =
                  isDeleting && deletingDocId === document.docId;
                const isRowFavoriting = favoritingDocId === document.docId;
                const isRowDuplicating = duplicatingDocId === document.docId;
                const canEditTemplate = document.accessType === "owned";
                const isGlobalTemplate = document.templateScope === "global";
                const isDeleteDisabled =
                  isGlobalTemplate ||
                  isDeleting ||
                  favoritingDocId !== null ||
                  duplicatingDocId !== null;

	                return (
	                  <li key={document.docId} className="space-y-3 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/sheets/${document.docId}`}
                        className="inline-flex items-start gap-1 line-clamp-2 text-sm font-semibold text-foreground hover:text-orange-500"
                      >
                        {document.isFavorite ? (
                          <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500" />
                        ) : null}
                        {document.title}
                      </Link>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {document.isTemplate ? (
                            <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-700">
                              {isGlobalTemplate ? "Global template" : "Template"}
                            </span>
                          ) : null}
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                              document.isShared
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-(--assistant-chip-bg) text-(--muted-foreground)"
                            }`}
                          >
                            {document.isShared ? "Shared" : "Private"}
                          </span>
                        </div>
	                    </div>

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div className="space-y-0.5">
                        <dt className="font-semibold uppercase tracking-wide text-(--muted-foreground)">
                          Created
                        </dt>
                        <dd className="text-foreground">
                          {hasMounted
                            ? formatDate(document.createdAt, dateFormatter)
                            : formatUtcFallbackDate(document.createdAt)}
                        </dd>
                      </div>
                      <div className="space-y-0.5">
                        <dt className="font-semibold uppercase tracking-wide text-(--muted-foreground)">
                          Last Modified
                        </dt>
                        <dd className="text-foreground">
                          {hasMounted
                            ? formatDate(document.lastModifiedAt, dateFormatter)
                            : formatUtcFallbackDate(document.lastModifiedAt)}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-center justify-start gap-1">
	                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9 rounded-lg px-3 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                        disabled={
                          isDeleting ||
                          favoritingDocId !== null ||
                          duplicatingDocId !== null
                        }
                        onClick={() => {
                          void handleToggleFavorite(document);
                        }}
                        aria-label={`${document.isFavorite ? "Remove favorite for" : "Favorite"} ${document.title}`}
                      >
                        {isRowFavoriting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Star
                            className={`h-4 w-4 ${
                              document.isFavorite
                                ? "fill-amber-500 text-amber-500"
                                : ""
                            }`}
                          />
                        )}
                        {document.isFavorite ? "Favorited" : "Favorite"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9 rounded-lg px-3 text-sky-600 hover:bg-sky-50 hover:text-sky-700"
                        disabled={
                          isDeleting ||
                          favoritingDocId !== null ||
                          duplicatingDocId !== null
                        }
                        onClick={() => {
                          void handleDuplicate(document);
                        }}
                        aria-label={`Duplicate ${document.title}`}
                      >
                        {isRowDuplicating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                        Duplicate
                      </Button>
                      {canEditTemplate ? (
                        <TemplateSettingsTrigger
                          template={document}
                          triggerMode="button"
                          triggerLabel="Template"
                          triggerClassName="h-9 rounded-lg px-3 text-violet-600 hover:bg-violet-50 hover:text-violet-700"
                          disabled={
                            isDeleting ||
                            favoritingDocId !== null ||
                            duplicatingDocId !== null
                          }
                        />
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9 rounded-lg px-3 text-red-500 hover:bg-red-50 hover:text-red-600"
	                        disabled={isDeleteDisabled}
	                        onClick={() => {
	                          setDeleteTarget(document);
	                        }}
	                        aria-label={`Delete ${document.title}`}
                          title={
                            document.isTemplate
                              ? isGlobalTemplate
                                ? "Global template sheets cannot be deleted"
                                : "Delete"
                              : "Delete"
                          }
	                      >
                        {isRowDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rnc-sheets-desktop-layout overflow-x-auto">
          <table className="min-w-full divide-y divide-(--card-border)">
            <thead>
              <tr className="bg-(--assistant-chip-bg)">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                  Last Modified
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                  Sharing
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--card-border)">
              {documents.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm text-(--muted-foreground)"
                  >
                    {emptyStateMessage}
                  </td>
                </tr>
              ) : (
                documents.map((document) => {
                  const isRowDeleting =
                    isDeleting && deletingDocId === document.docId;
                  const isRowFavoriting = favoritingDocId === document.docId;
                  const isRowDuplicating = duplicatingDocId === document.docId;
                  const canEditTemplate = document.accessType === "owned";
                  const isGlobalTemplate = document.templateScope === "global";
                  const isDeleteDisabled =
                    isGlobalTemplate ||
                    isDeleting ||
                    favoritingDocId !== null ||
                    duplicatingDocId !== null;

	                  return (
                    <tr
                      key={document.docId}
                      className="hover:bg-(--assistant-chip-bg)"
                    >
                      <td className="px-4 py-3">
	                        <div className="flex flex-col gap-1">
	                          <Link
	                            href={`/sheets/${document.docId}`}
	                            className="inline-flex items-center gap-1 text-sm font-semibold text-foreground hover:text-orange-500"
	                          >
                            {document.isFavorite ? (
                              <Star className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500" />
                            ) : null}
	                            {document.title}
	                          </Link>
                            {document.isTemplate ? (
                              <span className="inline-flex w-fit items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                                {isGlobalTemplate ? "Global template" : "Template"}
                              </span>
                            ) : null}
	                        </div>
	                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {hasMounted
                          ? formatDate(document.createdAt, dateFormatter)
                          : formatUtcFallbackDate(document.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {hasMounted
                          ? formatDate(document.lastModifiedAt, dateFormatter)
                          : formatUtcFallbackDate(document.lastModifiedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                            document.isShared
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-(--assistant-chip-bg) text-(--muted-foreground)"
                          }`}
                        >
                          {document.isShared ? "Shared" : "Private"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <IconButton
                            tooltip="Favorite"
                            className=" text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                            disabled={
                              isDeleting ||
                              favoritingDocId !== null ||
                              duplicatingDocId !== null
                            }
                            onClick={() => {
                              void handleToggleFavorite(document);
                            }}
                            aria-label={`${document.isFavorite ? "Remove favorite for" : "Favorite"} ${document.title}`}
                          >
                            {isRowFavoriting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Star
                                className={`h-4 w-4 ${
                                  document.isFavorite
                                    ? "fill-amber-500 text-amber-500"
                                    : ""
                                }`}
                              />
                            )}
                          </IconButton>
                          {canEditTemplate ? (
                            <TemplateSettingsTrigger
                              template={document}
                              triggerMode="icon"
                              triggerTooltip="Template settings"
                              triggerClassName="text-violet-600 hover:bg-violet-50 hover:text-violet-700"
                              disabled={
                                isDeleting ||
                                favoritingDocId !== null ||
                                duplicatingDocId !== null
                              }
                            />
                          ) : null}
                          <IconButton
                            tooltip="Duplicate"
                            className=" text-sky-600 hover:bg-sky-50 hover:text-sky-700"
                            disabled={
                              isDeleting ||
                              favoritingDocId !== null ||
                              duplicatingDocId !== null
                            }
                            onClick={() => {
                              void handleDuplicate(document);
                            }}
                            aria-label={`Duplicate ${document.title}`}
                          >
                            {isRowDuplicating ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </IconButton>
	                          <IconButton
	                            tooltip={
                                document.isTemplate
                                  ? isGlobalTemplate
                                    ? "Global template sheets cannot be deleted"
                                    : "Delete"
                                  : "Delete"
                              }
	                            className="text-red-500 hover:bg-red-50 hover:text-red-600"
	                            disabled={isDeleteDisabled}
	                            onClick={() => {
	                              setDeleteTarget(document);
	                            }}
                            aria-label={`Delete ${document.title}`}
                          >
                            {isRowDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-(--card-border) px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-(--muted-foreground)">
            {totalCount} total sheet{totalCount === 1 ? "" : "s"}
          </p>
          <div className="flex items-center justify-between gap-2 sm:justify-start">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!hasPreviousPage}
              onClick={() => {
                if (hasPreviousPage) {
                  router.push(
                    buildPageHref({
                      page: page - 1,
                      filter,
                      query,
                    }),
                  );
                }
              }}
              className="h-9 min-w-24 rounded-lg"
            >
              Previous
            </Button>
            <span className="text-xs text-(--muted-foreground)">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!hasNextPage}
              onClick={() => {
                if (hasNextPage) {
                  router.push(
                    buildPageHref({
                      page: page + 1,
                      filter,
                      query,
                    }),
                  );
                }
              }}
              className="h-9 min-w-24 rounded-lg"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isDeleting) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this sheet?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the sheet, its shared link, and workbook
              data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Deleting...
                </span>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
