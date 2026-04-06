"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronDown, FilePlus, FileSpreadsheet, FileText } from "lucide-react";

import { NewDocumentDialog } from "@/components/new-document-dialog";
import { ShareDocumentButton } from "@/components/share-document-button";
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
  onCreateNew?: (docId: string) => void | Promise<void>;
  allowCreateNew?: boolean;
  allowImport?: boolean;
  shareDocumentId?: string;
  canManageShare?: boolean;
};

export function FileMenu({
  onImportExcel,
  onImportCSV,
  onExportExcel,
  onExportCSV,
  onCreateNew,
  allowCreateNew = true,
  allowImport = true,
  shareDocumentId,
  canManageShare = false,
}: FileMenuProps) {
  const [isNewDocumentDialogOpen, setIsNewDocumentDialogOpen] = useState(false);
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  const handleNewFile = useCallback(async () => {
    setIsNewDocumentDialogOpen(true);
  }, []);

  const handleDocumentCreated = useCallback(
    async (documentId: string) => {
      if (onCreateNew) {
        await onCreateNew(documentId);
        return;
      }

      if (typeof window !== "undefined") {
        window.location.assign(`/sheets/${documentId}`);
      }
    },
    [onCreateNew],
  );

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

  const normalizedShareDocumentId = shareDocumentId?.trim() ?? "";
  const hasShareOption = normalizedShareDocumentId.length > 0;
  const hasImportOptions = allowImport && (onImportExcel || onImportCSV);
  const hasActionsBeforeExports = allowCreateNew || hasShareOption || hasImportOptions;

  const fileInputs = (
    <>
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
    </>
  );

  return (
    <div>
      {fileInputs}
      <NewDocumentDialog
        open={isNewDocumentDialogOpen}
        onOpenChange={setIsNewDocumentDialogOpen}
        onCreated={handleDocumentCreated}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarIconButton
            variant="ghost"
            size="default"
            className="gap-1 px-2 text-xs font-medium"
          >
            File
            <ChevronDown className="h-3.5 w-3.5" />
          </ToolbarIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {allowCreateNew ? (
            <DropdownMenuItem onClick={handleNewFile}>
              <FilePlus className="h-4 w-4" />
              New Spreadsheet
            </DropdownMenuItem>
          ) : null}
          {hasShareOption ? (
            <ShareDocumentButton
              documentId={normalizedShareDocumentId}
              canManageShare={canManageShare}
              triggerStyle="menu-item"
              label="Share"
            />
          ) : null}
          {(allowCreateNew || hasShareOption) && hasImportOptions ? (
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
          {hasActionsBeforeExports ? (
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
