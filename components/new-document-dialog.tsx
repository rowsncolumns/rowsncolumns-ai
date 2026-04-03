"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, FilePlus2, Loader2, X } from "lucide-react";
import { createPortal } from "react-dom";

import {
  createBlankDocument,
  createDocumentFromUpload,
  type UploadProgress,
} from "@/lib/documents/client";

type NewDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (documentId: string) => void | Promise<void>;
};

const SUPPORTED_EXTENSIONS = ["xlsx", "xls", "ods", "csv"] as const;

const getFileExtension = (name: string) => {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
};

const isSupportedImportFile = (file: File): boolean => {
  const extension = getFileExtension(file.name);
  return SUPPORTED_EXTENSIONS.some((item) => item === extension);
};

export function NewDocumentDialog({
  open,
  onOpenChange,
  onCreated,
}: NewDocumentDialogProps) {
  const [isCreatingBlank, setIsCreatingBlank] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isBusy = isCreatingBlank || isUploading;

  const closeDialog = useCallback(() => {
    if (isBusy) return;
    onOpenChange(false);
  }, [isBusy, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDialog, open]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setIsCreatingBlank(false);
      setIsUploading(false);
      setUploadFileName(null);
      setUploadPercent(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [open]);

  const handleCreateBlank = useCallback(async () => {
    if (isBusy) return;

    setError(null);
    setIsCreatingBlank(true);
    try {
      const documentId = await createBlankDocument();
      await onCreated(documentId);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create spreadsheet.",
      );
    } finally {
      setIsCreatingBlank(false);
    }
  }, [isBusy, onCreated, onOpenChange]);

  const handleChooseFile = useCallback(() => {
    if (isBusy) return;
    fileInputRef.current?.click();
  }, [isBusy]);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) return;
      if (!isSupportedImportFile(file)) {
        setError("Please upload an Excel (.xlsx/.xls), ODS, or CSV file.");
        return;
      }

      setError(null);
      setUploadFileName(file.name);
      setIsUploading(true);
      setUploadPercent(0);

      try {
        const documentId = await createDocumentFromUpload(file, {
          onUploadProgress: (progress: UploadProgress) => {
            setUploadPercent(progress.percent);
          },
        });
        await onCreated(documentId);
        onOpenChange(false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to import spreadsheet.",
        );
      } finally {
        setIsUploading(false);
        setUploadFileName(null);
        setUploadPercent(null);
      }
    },
    [onCreated, onOpenChange],
  );

  const modal = useMemo(() => {
    if (!open) return null;

    return (
      <div
        className="fixed inset-0 z-9999 flex items-center justify-center bg-black/45 px-4 py-8"
        onClick={closeDialog}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create a new spreadsheet"
          className="relative w-full max-w-2xl rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-6 shadow-[0_30px_100px_rgba(0,0,0,0.28)]"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={closeDialog}
            disabled={isBusy}
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-(--muted-foreground) transition hover:bg-black/5 hover:text-foreground disabled:opacity-60"
            aria-label="Close new spreadsheet dialog"
          >
            <X className="h-4 w-4" />
          </button>

          <h2 className="text-xl font-semibold text-foreground">New Spreadsheet</h2>
          <p className="mt-1 text-sm text-(--muted-foreground)">
            Choose how you want to start.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleCreateBlank}
              className="group rounded-xl border border-(--card-border) bg-(--card-bg) p-4 text-left transition hover:border-(--accent) hover:bg-(--assistant-chip-bg) disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-(--assistant-chip-bg) text-(--foreground)">
                {isCreatingBlank ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FilePlus2 className="h-4 w-4" />
                )}
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">
                Create Blank Spreadsheet
              </p>
              <p className="mt-1 text-xs text-(--muted-foreground)">
                Start with an empty sheet.
              </p>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={handleChooseFile}
              className="group rounded-xl border border-(--card-border) bg-(--card-bg) p-4 text-left transition hover:border-(--accent) hover:bg-(--assistant-chip-bg) disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-(--assistant-chip-bg) text-(--foreground)">
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">
                Upload Excel/ODS/CSV
              </p>
              <p className="mt-1 text-xs text-(--muted-foreground)">
                Import your file and create a new document from it.
              </p>
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.ods,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet"
            className="hidden"
            onChange={handleFileChange}
            aria-hidden="true"
          />

          {isUploading && uploadFileName ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-(--muted-foreground)">
                Uploading {uploadFileName}
                {uploadPercent !== null ? ` (${uploadPercent}%)` : ""}...
              </p>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-(--assistant-chip-bg)"
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadPercent ?? undefined}
                aria-valuetext={
                  uploadPercent !== null ? `${uploadPercent}%` : "Uploading"
                }
              >
                {uploadPercent !== null ? (
                  <div
                    className="h-full bg-(--accent) transition-[width] duration-200"
                    style={{ width: `${uploadPercent}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 animate-pulse bg-(--accent)" />
                )}
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    );
  }, [
    closeDialog,
    error,
    handleChooseFile,
    handleCreateBlank,
    handleFileChange,
    isBusy,
    isCreatingBlank,
    isUploading,
    open,
    uploadFileName,
    uploadPercent,
  ]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(modal, document.body);
}
