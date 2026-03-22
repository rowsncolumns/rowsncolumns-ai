"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { ChevronDown, Download, FilePlus, Upload } from "lucide-react";
import { uuid, uuidString } from "@rowsncolumns/utils";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarIconButton } from "@rowsncolumns/spreadsheet";

type FileMenuProps = {
  onImportExcel: (file: File) => Promise<void>;
  onExportExcel: () => Promise<void>;
};

export function FileMenu({ onImportExcel, onExportExcel }: FileMenuProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleNewFile = useCallback(() => {
    const newDocId = uuidString();
    router.push(`/doc/${newDocId}`);
  }, [router]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

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

  const handleExport = useCallback(async () => {
    try {
      await onExportExcel();
    } catch (error) {
      console.error("Failed to export Excel file:", error);
    }
  }, [onExportExcel]);

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
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
          <DropdownMenuItem onClick={handleNewFile}>
            <FilePlus className="h-4 w-4" />
            New Spreadsheet
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleImportClick}>
            <Upload className="h-4 w-4" />
            Import Excel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export as Excel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
