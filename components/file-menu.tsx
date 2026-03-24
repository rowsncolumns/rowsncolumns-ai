"use client";

import { useCallback, useRef, useTransition } from "react";
import {
  ChevronDown,
  FilePlus,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import { uuidString } from "@rowsncolumns/utils";
import { createPortal } from "react-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarIconButton } from "@rowsncolumns/spreadsheet";

type FileMenuProps = {
  onImportExcel?: (file: File) => Promise<void>;
  onImportCSV?: (file: File) => Promise<void>;
  onExportExcel: () => Promise<void>;
  onExportCSV: () => Promise<void>;
  onCreateNew?: (docId: string) => void;
  allowCreateNew?: boolean;
  allowImport?: boolean;
};

export function FileMenu({
  onImportExcel,
  onImportCSV,
  onExportExcel,
  onExportCSV,
  onCreateNew,
  allowCreateNew = true,
  allowImport = true,
}: FileMenuProps) {
  const [isCreatingNewSpreadsheet, startCreatingNewSpreadsheet] =
    useTransition();
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  const handleNewFile = useCallback(() => {
    if (isCreatingNewSpreadsheet) {
      return;
    }

    const newDocId = uuidString();
    startCreatingNewSpreadsheet(() => {
      if (onCreateNew) {
        onCreateNew(newDocId);
        return;
      }

      if (typeof window !== "undefined") {
        window.location.assign(`/doc/${newDocId}`);
      }
    });
  }, [isCreatingNewSpreadsheet, onCreateNew, startCreatingNewSpreadsheet]);

  const handleImportExcelClick = useCallback(() => {
    if (!allowImport || !onImportExcel) return;
    excelFileInputRef.current?.click();
  }, [allowImport, onImportExcel]);

  const handleImportCSVClick = useCallback(() => {
    if (!allowImport || !onImportCSV) return;
    csvFileInputRef.current?.click();
  }, [allowImport, onImportCSV]);

  const handleExcelFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !onImportExcel) return;

      try {
        await onImportExcel(file);
      } catch (error) {
        console.error("Failed to import Excel file:", error);
      }

      // Reset the input so the same file can be selected again
      event.target.value = "";
    },
    [onImportExcel],
  );

  const handleCSVFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !onImportCSV) return;

      try {
        await onImportCSV(file);
      } catch (error) {
        console.error("Failed to import CSV file:", error);
      }

      // Reset the input so the same file can be selected again
      event.target.value = "";
    },
    [onImportCSV],
  );

  const handleExportExcel = useCallback(async () => {
    try {
      await onExportExcel();
    } catch (error) {
      console.error("Failed to export Excel file:", error);
    }
  }, [onExportExcel]);

  const handleExportCSV = useCallback(async () => {
    try {
      await onExportCSV();
    } catch (error) {
      console.error("Failed to export CSV file:", error);
    }
  }, [onExportCSV]);

  return (
    <div>
      {isCreatingNewSpreadsheet && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
              <div
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-(--muted-foreground) shadow-sm"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating spreadsheet...
              </div>
            </div>,
            document.body,
          )
        : null}
      {allowImport && onImportExcel ? (
        <input
          ref={excelFileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleExcelFileChange}
          className="hidden"
          aria-hidden="true"
        />
      ) : null}
      {allowImport && onImportCSV ? (
        <input
          ref={csvFileInputRef}
          type="file"
          accept=".csv,text/csv,text/tab-separated-values"
          onChange={handleCSVFileChange}
          className="hidden"
          aria-hidden="true"
        />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarIconButton
            variant="ghost"
            size="default"
            className="gap-1 px-2 text-xs font-medium"
            disabled={isCreatingNewSpreadsheet}
            aria-busy={isCreatingNewSpreadsheet}
          >
            File
            {isCreatingNewSpreadsheet ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </ToolbarIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {allowCreateNew ? (
            <DropdownMenuItem
              onClick={handleNewFile}
              disabled={isCreatingNewSpreadsheet}
            >
              {isCreatingNewSpreadsheet ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FilePlus className="h-4 w-4" />
              )}
              {isCreatingNewSpreadsheet
                ? "Creating spreadsheet..."
                : "New Spreadsheet"}
            </DropdownMenuItem>
          ) : null}
          {allowImport && (onImportExcel || onImportCSV) ? (
            <DropdownMenuSeparator />
          ) : null}
          {allowImport && onImportExcel ? (
            <DropdownMenuItem onClick={handleImportExcelClick}>
              <FileSpreadsheet className="h-4 w-4" />
              Import Excel
            </DropdownMenuItem>
          ) : null}
          {allowImport && onImportCSV ? (
            <DropdownMenuItem onClick={handleImportCSVClick}>
              <FileText className="h-4 w-4" />
              Import CSV
            </DropdownMenuItem>
          ) : null}
          {(allowCreateNew || (allowImport && (onImportExcel || onImportCSV))) ? (
            <DropdownMenuSeparator />
          ) : null}
          <DropdownMenuItem onClick={handleExportExcel}>
            <FileSpreadsheet className="h-4 w-4" />
            Export as Excel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportCSV}>
            <FileText className="h-4 w-4" />
            Export as CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
