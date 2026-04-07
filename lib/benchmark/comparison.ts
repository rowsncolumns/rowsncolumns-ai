/**
 * Spreadsheet comparison utilities for SpreadsheetBench evaluation
 */

import type { CellData } from "@rowsncolumns/spreadsheet";
import type {
  CellComparisonResult,
  SheetComparisonResult,
  WorkbookComparisonResult,
} from "./types";
import type { ShareDBSpreadsheetDoc } from "@/lib/chat/utils";

const NUMERIC_TOLERANCE = 1e-6;

/**
 * Normalize a cell value for comparison
 */
const normalizeValue = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return null;
  }

  // Handle string values
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Try to parse as number
    const num = Number(trimmed);
    if (!Number.isNaN(num) && trimmed !== "") {
      return num;
    }
    // Normalize empty strings to null
    if (trimmed === "") {
      return null;
    }
    return trimmed.toLowerCase();
  }

  // Handle numbers
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return null;
    }
    // Round to avoid floating point precision issues
    return Math.round(value * 1e10) / 1e10;
  }

  // Handle booleans
  if (typeof value === "boolean") {
    return value;
  }

  return value;
};

/**
 * Compare two cell values with tolerance for numeric values
 */
const valuesMatch = (expected: unknown, actual: unknown): boolean => {
  const normExpected = normalizeValue(expected);
  const normActual = normalizeValue(actual);

  // Both null/empty
  if (normExpected === null && normActual === null) {
    return true;
  }

  // One null, one not
  if (normExpected === null || normActual === null) {
    return false;
  }

  // Both numbers - use tolerance
  if (typeof normExpected === "number" && typeof normActual === "number") {
    return Math.abs(normExpected - normActual) < NUMERIC_TOLERANCE;
  }

  // String comparison (already lowercased)
  if (typeof normExpected === "string" && typeof normActual === "string") {
    return normExpected === normActual;
  }

  // Boolean comparison
  if (typeof normExpected === "boolean" && typeof normActual === "boolean") {
    return normExpected === normActual;
  }

  // Type mismatch
  return false;
};

/**
 * Extract effective value from cell data
 * Handles the rowsncolumns cell format where:
 * - ev.nv = effective numeric value
 * - ev.bv = effective boolean value
 * - ev.sv = effective string value (or null for shared string)
 * - ss = shared string index
 * - fv = formatted value (display string)
 */
const getCellEffectiveValue = (
  cell: CellData | undefined,
  sharedStrings?: Record<string, string>,
): unknown => {
  if (!cell) {
    return null;
  }

  const cellAny = cell as any;

  // Helper to extract value from ev/ue object
  const extractValue = (obj: any): unknown => {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== "object") return obj;
    if ("nv" in obj) return obj.nv; // numeric value
    if ("bv" in obj) return obj.bv; // boolean value
    if ("sv" in obj) return obj.sv; // string value
    return null;
  };

  // Check ev (effective value)
  if (cellAny.ev !== undefined) {
    const val = extractValue(cellAny.ev);
    if (val !== null) return val;
  }

  // Check ue (user entered)
  if (cellAny.ue !== undefined) {
    const val = extractValue(cellAny.ue);
    if (val !== null) return val;
  }

  // Check shared string
  if (cellAny.ss !== undefined && sharedStrings) {
    return sharedStrings[cellAny.ss] ?? null;
  }

  // Fall back to formatted value
  if (cellAny.fv !== undefined) {
    // Try to parse as number if it looks like one
    const num = Number(cellAny.fv);
    if (!Number.isNaN(num)) return num;
    return cellAny.fv;
  }

  // Try generic value field (for ShareDB documents)
  if (cellAny.value !== undefined) {
    if (typeof cellAny.value === "object" && cellAny.value !== null) {
      // Recurse into value object
      return getCellEffectiveValue(cellAny.value, sharedStrings);
    }
    return cellAny.value;
  }

  return null;
};

/**
 * Convert column index to A1 notation (0-indexed)
 */
const columnIndexToLetter = (index: number): string => {
  let result = "";
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
};

/**
 * Convert row/column indices to A1 address (0-indexed internally, 1-indexed for display)
 */
const indicesToAddress = (row: number, col: number): string => {
  return `${columnIndexToLetter(col)}${row + 1}`;
};

/**
 * Compare two sheets
 */
export const compareSheets = (
  expectedSheetData: Record<string, CellData>,
  actualSheetData: Record<string, CellData>,
  sheetName: string,
  expectedSharedStrings?: Record<string, string>,
  actualSharedStrings?: Record<string, string>,
): SheetComparisonResult => {
  const cellResults: CellComparisonResult[] = [];
  let matchingCells = 0;

  // Get all cell keys from both sheets
  const allKeys = new Set([
    ...Object.keys(expectedSheetData),
    ...Object.keys(actualSheetData),
  ]);

  for (const key of allKeys) {
    const expectedCell = expectedSheetData[key];
    const actualCell = actualSheetData[key];

    const expectedValue = getCellEffectiveValue(
      expectedCell,
      expectedSharedStrings,
    );
    const actualValue = getCellEffectiveValue(actualCell, actualSharedStrings);

    const match = valuesMatch(expectedValue, actualValue);

    if (match) {
      matchingCells++;
    }

    // Only record mismatches or non-empty cells
    if (!match || expectedValue !== null || actualValue !== null) {
      cellResults.push({
        match,
        expected: expectedValue,
        actual: actualValue,
        cellAddress: key,
        reason: match
          ? undefined
          : `Expected "${expectedValue}", got "${actualValue}"`,
      });
    }
  }

  const totalCells = allKeys.size;

  return {
    sheetName,
    match: matchingCells === totalCells,
    cellResults: cellResults.filter((r) => !r.match), // Only return mismatches
    totalCells,
    matchingCells,
  };
};

/**
 * Compare answer spreadsheet with agent output
 * Uses "online judge" style comparison - checks specific answer positions
 */
export const compareSpreadsheets = (
  expected: ShareDBSpreadsheetDoc,
  actual: ShareDBSpreadsheetDoc,
  answerPosition?: string,
): WorkbookComparisonResult => {
  const sheetResults: SheetComparisonResult[] = [];

  // Get sheets from both workbooks
  const expectedSheets = expected.sheets ?? [{ sheetId: 1, title: "Sheet1" }];
  const actualSheets = actual.sheets ?? [{ sheetId: 1, title: "Sheet1" }];

  // Get shared strings
  const expectedSharedStrings = expected.sharedStrings;
  const actualSharedStrings = actual.sharedStrings;

  // If answer position is specified, only compare that specific range
  if (answerPosition) {
    // TODO: Parse answer position and compare only that range
    // For now, fall through to full comparison
  }

  // Compare each sheet
  for (const expectedSheet of expectedSheets) {
    const actualSheet = actualSheets.find(
      (s) =>
        s.sheetId === expectedSheet.sheetId ||
        s.title.toLowerCase() === expectedSheet.title.toLowerCase(),
    );

    if (!actualSheet) {
      sheetResults.push({
        sheetName: expectedSheet.title,
        match: false,
        cellResults: [
          {
            match: false,
            expected: "Sheet exists",
            actual: "Sheet missing",
            cellAddress: "N/A",
            reason: `Sheet "${expectedSheet.title}" not found in output`,
          },
        ],
        totalCells: 0,
        matchingCells: 0,
      });
      continue;
    }

    // Extract sheet data for this sheet
    const expectedSheetData: Record<string, CellData> = {};
    const actualSheetData: Record<string, CellData> = {};

    if (expected.sheetData) {
      for (const [key, cellV3] of Object.entries(expected.sheetData)) {
        if (cellV3.sId === expectedSheet.sheetId) {
          expectedSheetData[indicesToAddress(cellV3.r - 1, cellV3.c - 1)] =
            cellV3.value;
        }
      }
    }

    if (actual.sheetData) {
      for (const [key, cellV3] of Object.entries(actual.sheetData)) {
        if (cellV3.sId === actualSheet.sheetId) {
          actualSheetData[indicesToAddress(cellV3.r - 1, cellV3.c - 1)] =
            cellV3.value;
        }
      }
    }

    const sheetResult = compareSheets(
      expectedSheetData,
      actualSheetData,
      expectedSheet.title,
      expectedSharedStrings,
      actualSharedStrings,
    );
    sheetResults.push(sheetResult);
  }

  const matchingSheets = sheetResults.filter((r) => r.match).length;

  return {
    match: matchingSheets === sheetResults.length,
    sheetResults,
    totalSheets: sheetResults.length,
    matchingSheets,
  };
};

/**
 * Check if specific answer cells match
 * Used for SpreadsheetBench's "online judge" style evaluation
 */
export const checkAnswerCells = (
  actual: ShareDBSpreadsheetDoc,
  expected: ShareDBSpreadsheetDoc,
  answerCells: Array<{ sheetId: number; row: number; col: number }>,
): { passed: boolean; details: CellComparisonResult[] } => {
  const details: CellComparisonResult[] = [];
  let allPassed = true;

  for (const { sheetId, row, col } of answerCells) {
    const cellKey = `${sheetId}:${row}:${col}`;
    const address = indicesToAddress(row - 1, col - 1);

    const expectedCell = expected.sheetData?.[cellKey];
    const actualCell = actual.sheetData?.[cellKey];

    const expectedValue = getCellEffectiveValue(expectedCell?.value);
    const actualValue = getCellEffectiveValue(actualCell?.value);

    const match = valuesMatch(expectedValue, actualValue);

    if (!match) {
      allPassed = false;
    }

    details.push({
      match,
      expected: expectedValue,
      actual: actualValue,
      cellAddress: address,
      reason: match
        ? undefined
        : `Expected "${expectedValue}", got "${actualValue}"`,
    });
  }

  return { passed: allPassed, details };
};
