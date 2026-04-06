import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_ROW_HEIGHT,
  addressToSelection,
  areaIntersects,
  cellToAddress,
  desanitizeSheetName,
  generateSelectionsFromFormula,
  getCellEffectiveFormat,
  getCellEffectiveValue,
  getCellFormattedValue,
  getCellUserEnteredValue,
  getExtendedValueBool,
  getExtendedValueFormula,
  getExtendedValueNumber,
  getExtendedValueError,
  getExtendedValueString,
  isNil,
  selectionToAddress,
  uuidString,
  alpha2number,
} from "@rowsncolumns/utils";

import {
  type CellData,
  type CellFormatType,
  type CellStyleData,
  type SpreadsheetApplyFillInput,
  SpreadsheetApplyFillSchema,
  type SpreadsheetChangeBatchInput,
  SpreadsheetChangeBatchSchema,
  type SpreadsheetFormatRangeInput,
  SpreadsheetFormatRangeSchema,
  type SpreadsheetNoteInput,
  SpreadsheetNoteSchema,
  type SpreadsheetModifyRowsColsInput,
  SpreadsheetModifyRowsColsSchema,
  type SpreadsheetQueryRangeInput,
  SpreadsheetQueryRangeSchema,
  type SpreadsheetSetIterativeModeInput,
  SpreadsheetSetIterativeModeSchema,
  type SpreadsheetReadDocumentInput,
  SpreadsheetReadDocumentSchema,
  type SpreadsheetGetRowColMetadataInput,
  SpreadsheetGetRowColMetadataSchema,
  type SpreadsheetSetRowColDimensionsInput,
  SpreadsheetSetRowColDimensionsSchema,
  // Consolidated schemas
  type SpreadsheetSheetInput,
  SpreadsheetSheetSchema,
  type SpreadsheetTableInput,
  SpreadsheetTableSchema,
  type SpreadsheetChartInput,
  SpreadsheetChartSchema,
  type SpreadsheetDataValidationInput,
  SpreadsheetDataValidationSchema,
  type SpreadsheetConditionalFormatInput,
  SpreadsheetConditionalFormatSchema,
  type SpreadsheetClearCellsInput,
  SpreadsheetClearCellsSchema,
  type SpreadsheetGetAuditSnapshotInput,
  SpreadsheetGetAuditSnapshotSchema,
  type SpreadsheetNamedRangeInput,
  SpreadsheetNamedRangeSchema,
  // Legacy schemas kept for internal use
  type SpreadsheetCreateTableInput,
  type SpreadsheetCreateDataValidationInput,
  type SpreadsheetUpdateDataValidationInput,
} from "./models";
import {
  cellsToCitations,
  cellsToValues,
  createSpreadsheetInterface,
  evaluateFormulas,
  getShareDBDocument,
  persistPatchTuples,
  persistSpreadsheetPatches,
  type ShareDBSpreadsheetDoc,
} from "./utils";
import { compressA1CellsToRanges } from "./a1-range-utils";
import {
  createAgentAttribution,
  trackedSubmitOp,
} from "@/lib/operation-history";
import {
  type StyleReference,
  type TableTheme,
  type BandedDefinition,
  type TableView,
  type EmbeddedChart,
  type ChartSpec,
  type ConditionalFormatRule,
  AXIS,
  Sheet,
  DimensionProperties,
} from "@rowsncolumns/spreadsheet";
import type {
  SelectionArea,
  ConditionType,
  DataValidationRuleRecord,
  CellFormat,
  ErrorValue,
  GridRange,
} from "@rowsncolumns/common-types";

const failTool = (
  errorCode: string,
  errorMessage: string,
  errorDetails?: Record<string, unknown>,
  retryable = true,
) =>
  JSON.stringify({
    success: false,
    retryable,
    error: errorMessage,
    errorCode,
    ...(errorDetails ? { errorDetails } : {}),
  });

const parseMergeRangesFromA1 = (ranges: string[]) => {
  const validRanges: GridRange[] = [];
  const invalidRanges: string[] = [];

  for (const a1Range of ranges) {
    const selection = addressToSelection(a1Range);
    if (!selection?.range) {
      invalidRanges.push(a1Range);
      continue;
    }
    validRanges.push(selection.range);
  }

  return { validRanges, invalidRanges };
};

const findOverlappingMergePair = (
  ranges: GridRange[],
): [GridRange, GridRange] | null => {
  for (let i = 0; i < ranges.length; i += 1) {
    const left = ranges[i];
    if (!left) continue;
    for (let j = i + 1; j < ranges.length; j += 1) {
      const right = ranges[j];
      if (!right) continue;
      if (areaIntersects(left, right)) {
        return [left, right];
      }
    }
  }
  return null;
};

const findOverlapWithExistingMerge = (
  candidates: GridRange[],
  existing: GridRange[],
): [GridRange, GridRange] | null => {
  for (const candidate of candidates) {
    for (const current of existing) {
      if (areaIntersects(candidate, current)) {
        return [candidate, current];
      }
    }
  }
  return null;
};

const rangeToA1OrFallback = (range: GridRange): string =>
  selectionToAddress({ range }) ?? "unknown-range";

const getHostname = (rawUrl: string) => {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, "");
  } catch {
    return rawUrl;
  }
};

/**
 * Parse and validate cells input - handles JSON string and validates 2D array structure
 */
const parseCells = (input: unknown): CellData[][] => {
  let parsed = input;

  // Handle JSON string input
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      throw new Error(
        `Invalid JSON string for cells: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Cells must be a 2D array, got ${typeof parsed}`);
  }

  const result: CellData[][] = [];

  for (let rowIdx = 0; rowIdx < parsed.length; rowIdx++) {
    const row = parsed[rowIdx];

    if (!Array.isArray(row)) {
      throw new Error(`Row ${rowIdx} must be an array, got ${typeof row}`);
    }

    const rowCells: CellData[] = [];

    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cell = row[colIdx];

      if (cell === null || cell === undefined) {
        // Null/undefined cells become empty objects
        rowCells.push({});
      } else if (typeof cell === "object" && !Array.isArray(cell)) {
        // Strictly validate allowed properties
        const { value, formula, citation, ...rest } = cell as Record<
          string,
          unknown
        >;
        const extraKeys = Object.keys(rest);

        if (extraKeys.length > 0) {
          throw new Error(
            `Cell at row ${rowIdx}, col ${colIdx} has unexpected properties: ${extraKeys.join(
              ", ",
            )}. Allowed keys: value, formula, citation.`,
          );
        }

        if (
          value !== undefined &&
          !(
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            value === null
          )
        ) {
          throw new Error(
            `Cell at row ${rowIdx}, col ${colIdx} has invalid value type: ${typeof value}`,
          );
        }

        if (formula !== undefined && typeof formula !== "string") {
          throw new Error(
            `Cell at row ${rowIdx}, col ${colIdx} has invalid formula type: ${typeof formula}`,
          );
        }

        // Guard rail: auto-prepend '=' to formulas that don't start with it
        let normalizedFormula = formula as string | undefined;
        if (
          normalizedFormula !== undefined &&
          normalizedFormula.length > 0 &&
          !normalizedFormula.startsWith("=")
        ) {
          normalizedFormula = `=${normalizedFormula}`;
        }

        if (citation !== undefined && typeof citation !== "string") {
          throw new Error(
            `Cell at row ${rowIdx}, col ${colIdx} has invalid citation type: ${typeof citation}`,
          );
        }

        rowCells.push({
          value:
            value === undefined
              ? undefined
              : (value as string | number | boolean | null),
          formula: normalizedFormula,
          citation: citation as string | undefined,
        });
      } else {
        throw new Error(
          `Cell at row ${rowIdx}, col ${colIdx} must be an object, got ${typeof cell}`,
        );
      }
    }

    result.push(rowCells);
  }
  return result;
};

// Configuration for document write locking
const ENABLE_DOCUMENT_WRITE_LOCK = true;

// In-memory lock map: docId -> Promise chain
const documentLocks = new Map<string, Promise<unknown>>();

const withDocumentWriteLock = async <T>(
  docId: string,
  operation: () => Promise<T>,
): Promise<T> => {
  // Bypass locking if disabled
  if (!ENABLE_DOCUMENT_WRITE_LOCK) {
    return operation();
  }

  // Get the current lock promise for this document (or a resolved one if none exists)
  const currentLock = documentLocks.get(docId) ?? Promise.resolve();

  // Create a new promise that will resolve when our operation completes
  let releaseLock: () => void;
  const newLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  // Set the new lock before waiting (so subsequent calls queue behind us)
  documentLocks.set(docId, newLock);

  try {
    // Wait for any previous operation to complete
    await currentLock;
    // Execute our operation
    return await operation();
  } finally {
    // Release the lock
    releaseLock!();
    // Clean up if this is the last lock in the chain
    if (documentLocks.get(docId) === newLock) {
      documentLocks.delete(docId);
    }
  }
};

/**
 * Handler for the spreadsheet_changeBatch tool
 * Uses Spreadsheet interface for proper formula evaluation and patch generation
 */
const handleSpreadsheetChangeBatch = async (
  input: SpreadsheetChangeBatchInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId, range, cells: rawCells } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to modify the spreadsheet",
      { field: "docId" },
    );
  }

  // Parse and validate cells (handles JSON strings and validates structure)
  let cells: CellData[][];
  try {
    cells = parseCells(rawCells);
  } catch (e) {
    return failTool(
      "INVALID_CELLS",
      e instanceof Error ? e.message : "Invalid cells format",
      { range },
    );
  }

  const rowCount = cells.length;
  const colCount = cells[0]?.length ?? 0;
  const cellCount = rowCount * colCount;

  // Default sheetId (may be overridden by sheet name in range)
  const defaultSheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_changeBatch] Starting:", {
      docId,
      sheetId: defaultSheetId,
      range,
    });

    try {
      // Connect to ShareDB first (needed for sheet name lookup)
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Parse the range (supports sheet names like 'Sheet1'!A1:B5)
        const rangeParsed = parseRangeWithSheetName(
          range,
          spreadsheet,
          defaultSheetId,
        );

        if (!rangeParsed.selection?.range) {
          return failTool(
            "INVALID_RANGE",
            rangeParsed.error || `Invalid range: ${range}`,
            { range },
          );
        }

        const selection = rangeParsed.selection;
        const sheetId = rangeParsed.sheetId;

        // Convert input cells to values array
        const values = cellsToValues(cells);

        // Extract citations if present
        const { citationStrings, citationObjects } = cellsToCitations(cells, {
          sheetId,
          startRowIndex: selection.range.startRowIndex,
          startColumnIndex: selection.range.startColumnIndex,
          generateId: uuidString,
        });

        // Apply changes using changeBatch
        spreadsheet.changeBatch(
          sheetId,
          selection.range,
          values,
          undefined, // formatting
          citationStrings,
        );

        // Add citations to state if any exist
        if (citationObjects.length > 0) {
          spreadsheet.createBatchCitations(citationObjects);
        }

        // Evaluate formulas
        const formulaResults = await evaluateFormulas(sheetId, spreadsheet);

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_changeBatch] Completed:", {
          docId,
          range,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully updated ${cellCount} cell(s) in range ${range}`,
          range,
          formulaResults,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_changeBatch] Error:", error);

      return failTool(
        "CHANGE_BATCH_FAILED",
        error instanceof Error ? error.message : "Failed to update spreadsheet",
      );
    }
  });
};

/**
 * The spreadsheet_changeBatch tool for LangChain
 */
export const spreadsheetChangeBatchTool = tool(handleSpreadsheetChangeBatch, {
  name: "spreadsheet_changeBatch",
  description: `Write data into a rectangular region of a spreadsheet.

OVERVIEW:
This tool writes a 2D grid of cell data into a sheet at a specified range using A1 notation. It only edits the cells covered by the provided cells array — no other part of the sheet is changed. The sheet automatically expands if needed.

WHEN TO USE THIS TOOL:
- Writing tabular data into a spreadsheet
- Filling in or updating a block of cells
- Creating or overwriting tables with headers + rows
- Inserting form/template values into a known range
- Updating cells with formulas or static values
- Updating a single cell or a multi-cell region

MULTI-SHEET SUPPORT:
Cross-sheet references are supported. Write to other sheets using "'Sheet Name'!A1:B5" range syntax. Formulas can reference other sheets (e.g., =SUM('Data'!B:B)). Use spreadsheet_sheet to create new sheets if needed.

CRITICAL RULES:
1. Range uses A1 notation (e.g., 'A1:C3', 'B2:D5', or "'Sheet Name'!A1:B5" for cross-sheet references).
2. 'cells' must be a 2D array: list of rows. Dimensions MUST match the range.
3. Each cell object can have 'value', 'formula', and/or 'citation' (or be empty {}).
4. Use empty objects {} for blank cells you want to skip.
5. Only the target range is modified — never affects data outside.
6. Write input values before formulas that reference them.
7. If formulaResults reports formula errors, repair them in follow-up tool calls and verify the affected range.
8. Prefer formulas over hardcoded derived values when references are available.
9. For sequences (numbers/dates/months), write 1-2 seed cells with changeBatch, then extend with spreadsheet_applyFill.
10. Citations: use the 'citation' field with a 'value' or 'formula' (URL with optional 'excerpt' query param).
11. To keep a value as plain text when it starts with '=', '+', or '-', write it in 'value' with a leading apostrophe (examples: {"value": "'=SUM(4,4)"}, {"value": "'+15551234567"}, {"value": "'-SKU-001"}).

EXAMPLES:

Example 1 — Write a table with values and formulas at A1:D4:
  range: "A1:D4"
  cells: [
    [{"value": "Item"}, {"value": "Qty"}, {"value": "Price"}, {"value": "Total"}],
    [{"value": "Apples"}, {"value": 10}, {"value": 1.5}, {"formula": "=B2*C2"}],
    [{"value": "Oranges"}, {"value": 5}, {"value": 2.0}, {"formula": "=B3*C3"}],
    [{"value": "Grand Total"}, {}, {}, {"formula": "=SUM(D2:D3)"}]
  ]

Example 2 — Update a single cell with a formula:
  range: "B10"
  cells: [[{"formula": "=SUM(B1:B9)"}]]

Example 3 — Fill a row with values:
  range: "A1:C1"
  cells: [[{"value": "Name"}, {"value": "Age"}, {"value": "City"}]]

Example 4 — Create a financial calculation block:
  range: "A1:B5"
  cells: [
    [{"value": "Revenue"}, {"value": 100000}],
    [{"value": "Costs"}, {"value": 60000}],
    [{"value": "Gross Profit"}, {"formula": "=B1-B2"}],
    [{"value": "Tax Rate"}, {"value": 0.25}],
    [{"value": "Net Profit"}, {"formula": "=B3*(1-B4)"}]
  ]

Example 5 — Write values with citations to track data sources:
  range: "A1:B3"
  cells: [
    [{"value": "Metric"}, {"value": "Value"}],
    [{"value": "Q3 Revenue"}, {"value": 12000000, "citation": "https://example.com/annual-report.pdf?excerpt=Q3%20revenue%20was%20%2412M"}],
    [{"value": "Growth Rate"}, {"value": 0.15, "citation": "https://example.com/analysis.pdf?excerpt=15%25%20year-over-year%20growth"}]
  ]

Example 6 — Write to a different sheet (cross-sheet reference):
  range: "'Sales Data'!A1:B2"
  cells: [
    [{"value": "Q1"}, {"value": "Q2"}],
    [{"value": 100}, {"value": 200}]
  ]

Example 7 — Formula referencing another sheet:
  range: "A1"
  cells: [[{"formula": "='Sales Data'!B2 + 'Sales Data'!C2"}]]

Example 8 — Cross-sheet formulas (common patterns):
  range: "A1:A4"
  cells: [
    [{"formula": "=SUM('Sales Data'!B2:B100)"}],
    [{"formula": "=VLOOKUP(A1, 'Products'!A:C, 3, FALSE)"}],
    [{"formula": "='Q1 Results'!D10 * 1.1"}],
    [{"formula": "=SUMIF('Transactions'!A:A, \"Complete\", 'Transactions'!D:D)"}]
  ]

`,
  schema: SpreadsheetChangeBatchSchema,
});

/**
 * All available tools for the spreadsheet assistant
 */

/**
 * Parse and validate cells input for formatting - handles JSON string and validates 2D array structure
 */
const parseStyleCells = (input: unknown): CellStyleData[][] => {
  let parsed = input;

  // Handle JSON string input
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      throw new Error(
        `Invalid JSON string for cells: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Cells must be a 2D array, got ${typeof parsed}`);
  }

  const result: CellStyleData[][] = [];

  for (let rowIdx = 0; rowIdx < parsed.length; rowIdx++) {
    const row = parsed[rowIdx];

    if (!Array.isArray(row)) {
      throw new Error(`Row ${rowIdx} must be an array, got ${typeof row}`);
    }

    const rowCells: CellStyleData[] = [];

    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cell = row[colIdx];

      if (cell === null || cell === undefined) {
        // Null/undefined cells become empty objects
        rowCells.push({});
      } else if (typeof cell === "object" && !Array.isArray(cell)) {
        // Convert shorthand styles in cellStyles if present
        const cellStyles = convertShorthandStyles(
          (cell as Record<string, unknown>).cellStyles,
        );

        rowCells.push({ cellStyles: cellStyles || undefined });
      } else {
        throw new Error(
          `Cell at row ${rowIdx}, col ${colIdx} must be an object, got ${typeof cell}`,
        );
      }
    }

    result.push(rowCells);
  }

  return result;
};

/**
 * Convert shorthand style properties to proper CellFormat structure
 * Supports shortcuts like {fontWeight: "bold"} -> {textFormat: {bold: true}}
 */
const convertShorthandStyles = (
  cellStyles: unknown,
): CellFormatType | undefined => {
  if (!cellStyles || typeof cellStyles !== "object") {
    return undefined;
  }

  const styles = { ...(cellStyles as Record<string, unknown>) };

  // Text format shortcuts
  const textFormatUpdates: Record<string, boolean> = {};
  const keysToRemove: string[] = [];

  if ("fontWeight" in styles) {
    if (styles.fontWeight === "bold") {
      textFormatUpdates.bold = true;
    }
    keysToRemove.push("fontWeight");
  }

  if ("fontStyle" in styles) {
    if (styles.fontStyle === "italic") {
      textFormatUpdates.italic = true;
    }
    keysToRemove.push("fontStyle");
  }

  if ("textDecoration" in styles && typeof styles.textDecoration === "string") {
    if (styles.textDecoration.includes("underline")) {
      textFormatUpdates.underline = true;
    }
    if (styles.textDecoration.includes("line-through")) {
      textFormatUpdates.strikethrough = true;
    }
    keysToRemove.push("textDecoration");
  }

  // Remove shorthand keys
  for (const key of keysToRemove) {
    delete styles[key];
  }

  // Merge text format updates
  if (Object.keys(textFormatUpdates).length > 0) {
    const existingTextFormat =
      typeof styles.textFormat === "object" && styles.textFormat
        ? (styles.textFormat as Record<string, unknown>)
        : {};
    styles.textFormat = { ...existingTextFormat, ...textFormatUpdates };
  }

  return styles as CellFormatType;
};

/**
 * Handler for the spreadsheet_formatRange tool
 * Applies formatting to a range of cells without changing their values
 */
const handleSpreadsheetFormatRange = async (
  input: SpreadsheetFormatRangeInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId, range, cells: rawCells } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required to modify the spreadsheet",
    });
  }

  // Parse and validate cells (handles JSON strings and validates structure)
  let cells: CellStyleData[][];
  try {
    cells = parseStyleCells(rawCells);
  } catch (e) {
    return JSON.stringify({
      success: false,
      error: e instanceof Error ? e.message : "Invalid cells format",
    });
  }

  // Default sheetId (may be overridden by sheet name in range)
  const defaultSheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_formatRange] Starting:", {
      docId,
      sheetId: defaultSheetId,
      range,
    });

    try {
      // Connect to ShareDB first (needed for sheet name lookup)
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return JSON.stringify({
            success: false,
            error: "Document has no data",
          });
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Parse the range (supports sheet names like 'Sheet1'!A1:B5)
        const rangeParsed = parseRangeWithSheetName(
          range,
          spreadsheet,
          defaultSheetId,
        );

        if (!rangeParsed.selection?.range) {
          return JSON.stringify({
            success: false,
            error: rangeParsed.error || `Invalid range: ${range}`,
          });
        }

        const selection = rangeParsed.selection;
        const sheetId = rangeParsed.sheetId;

        // Calculate range dimensions
        const rangeRowCount =
          selection.range.endRowIndex - selection.range.startRowIndex + 1;
        const rangeColCount =
          selection.range.endColumnIndex - selection.range.startColumnIndex + 1;

        // Auto-expand: if exactly one cell is provided, expand it to fill the entire range
        let expandedCells = cells;
        if (
          cells.length === 1 &&
          cells[0].length === 1 &&
          (rangeRowCount > 1 || rangeColCount > 1)
        ) {
          const singleCellStyle = cells[0][0];
          expandedCells = Array.from({ length: rangeRowCount }, () =>
            Array.from({ length: rangeColCount }, () => singleCellStyle),
          );
        }

        // Convert cells to formatting array
        // Filter out empty cellStyles objects (no formatting to apply)
        const formatting: (CellFormat | null | undefined)[][] =
          expandedCells.map((row) =>
            row.map((cell) => cell.cellStyles as CellFormat | undefined),
          );

        // Check if there's any actual formatting to apply
        const hasFormatting = formatting.some((row) =>
          row.some((cell) => cell !== null),
        );

        if (!hasFormatting) {
          return JSON.stringify({
            success: true,
            message: "No formatting changes to apply",
            range,
          });
        }

        // Apply changes using changeBatch with formattingOnly option
        spreadsheet.changeBatch(
          sheetId,
          selection.range,
          undefined,
          formatting,
          undefined, // citations
          { formattingOnly: true },
        );

        // trigger calc?
        await spreadsheet.calculatePending();

        // Get patch tuples and apply them directly (don't call getPatchTuples twice)
        const patchTuples = spreadsheet.getPatchTuples();

        console.log("[spreadsheet_formatRange] Patches generated:", {
          count: patchTuples.length,
          patches: patchTuples.map(([patches]) => Object.keys(patches)),
        });

        // Only persist if there are actual patches to apply
        if (patchTuples.length > 0) {
          await persistPatchTuples(doc, patchTuples, "agent");
        }

        // Calculate actual formatted cell count (after expansion)
        const formattedCellCount =
          expandedCells.length * (expandedCells[0]?.length ?? 0);

        console.log("[spreadsheet_formatRange] Completed:", {
          docId,
          range,
          patchCount: patchTuples.length,
          autoExpanded: expandedCells !== cells,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully formatted ${formattedCellCount} cell(s) in range ${range}`,
          range,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_formatRange] Error:", error);

      return JSON.stringify({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to format spreadsheet cells",
      });
    }
  });
};

/**
 * The spreadsheet_formatRange tool for LangChain
 */
export const spreadsheetFormatRangeTool = tool(handleSpreadsheetFormatRange, {
  name: "spreadsheet_formatRange",
  description: `Apply visual formatting to a rectangular region of a spreadsheet.

CELL STRUCTURE (CRITICAL):
Each cell MUST use the "cellStyles" wrapper. This is required:
  ✓ CORRECT: {"cellStyles": {"textFormat": {"bold": true}}}
  ✗ WRONG:   {"textFormat": {"bold": true}}  // Missing cellStyles wrapper!

The cells parameter is a 2D array (rows of cells):
  [[{"cellStyles": {...}}, {"cellStyles": {...}}], ...]

Use {} for cells with no formatting changes.

CROSS-SHEET REFERENCES:
Range supports sheet name prefix: "'Sheet Name'!A1:D1" to format cells on a different sheet.

CELLSTYLES PROPERTIES:
- textFormat: {bold, italic, underline, strikethrough, fontFamily, fontSize, color}
- backgroundColor: Hex string '#FF0000' or theme {theme: 4, tint: 0.2}
- borders: {top, right, bottom, left} each with {style, color}
  - styles: "thin", "medium", "thick", "dashed", "dotted", "double"
- numberFormat: {type, pattern} - types: NUMBER, CURRENCY, PERCENT, DATE
- horizontalAlignment: 'left', 'center', 'right'
- verticalAlignment: 'top', 'middle', 'bottom'
- wrapStrategy: 'overflow', 'wrap', 'clip'

AUTO-EXPANSION:
If you provide exactly ONE cell [[{"cellStyles": {...}}]], it auto-expands to fill the entire range.
Useful for applying uniform formatting. Only use for header-only or totals-only ranges when bolding.

FORMATTING STANDARDS:
- Headers: bold, center-align, bottom border
- Numbers: right-align, #,##0 format
- Currency: '$#,##0.00', right-align
- Percentages: 0.0% (one decimal default)
- Dates: use date format, not plain numbers
- Totals: bold with top border (double for accounting style)
- Data cells: regular weight (non-bold) unless emphasis requested

EXAMPLES:

Example 1 — Bold header row with border (auto-expansion):
  range: "A1:D1"
  cells: [[{"cellStyles": {"textFormat": {"bold": true}, "borders": {"bottom": {"style": "medium", "color": "#000000"}}}}]]

Example 2 — Format 2x2 range with different styles:
  range: "A1:B2"
  cells: [
    [{"cellStyles": {"backgroundColor": "#E8E8E8"}}, {"cellStyles": {"backgroundColor": "#E8E8E8"}}],
    [{"cellStyles": {"textFormat": {"italic": true}}}, {}]
  ]

Example 3 — Totals row with double top border:
  range: "A10:D10"
  cells: [[{"cellStyles": {"textFormat": {"bold": true}, "borders": {"top": {"style": "double", "color": "#000000"}}}}]]

Example 4 — Theme colors:
  cells: [[{"cellStyles": {"backgroundColor": {"theme": 4}, "borders": {"bottom": {"color": {"theme": 1, "tint": -0.25}}}}}]]
  // theme: 0-9 (accent colors), tint: -1 to 1 (darken/lighten)`,
  schema: SpreadsheetFormatRangeSchema,
});

/**
 * Handler for the spreadsheet_modifyRowsCols tool
 * Consolidated tool for inserting/deleting rows and columns
 */
const handleSpreadsheetModifyRowsCols = async (
  input: SpreadsheetModifyRowsColsInput,
): Promise<string> => {
  const {
    docId,
    sheetId: inputSheetId,
    action,
    dimension,
    index,
    count = 1,
    indexes,
    columns,
  } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required",
    });
  }

  const sheetId = inputSheetId ?? 1;

  // Validate parameters based on action
  if (action === "insert") {
    if (index === undefined) {
      return JSON.stringify({
        success: false,
        error: "index is required for insert action",
      });
    }
  } else if (action === "delete") {
    if (dimension === "row" && (!indexes || indexes.length === 0)) {
      return JSON.stringify({
        success: false,
        error: "indexes is required for deleting rows",
      });
    }
    if (dimension === "column" && (!columns || columns.length === 0)) {
      return JSON.stringify({
        success: false,
        error: "columns is required for deleting columns",
      });
    }
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_modifyRowsCols] Starting:", {
      docId,
      sheetId,
      action,
      dimension,
      index,
      count,
      indexes,
      columns,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return JSON.stringify({
            success: false,
            error: "Document has no data",
          });
        }

        const spreadsheet = createSpreadsheetInterface(data, false);
        let message = "";

        if (action === "insert") {
          if (dimension === "row") {
            spreadsheet.insertRow(sheetId, index!, count);
            message = `Successfully inserted ${count} row(s) at row ${index}`;
          } else {
            spreadsheet.insertColumn(sheetId, index!, count);
            message = `Successfully inserted ${count} column(s) at column ${index}`;
          }
        } else {
          // delete
          if (dimension === "row") {
            spreadsheet.deleteRow(sheetId, indexes!);
            message = `Successfully deleted ${indexes!.length} row(s)`;
          } else {
            // Convert column letters to indexes
            const columnIndexes = columns!.map((col) => alpha2number(col));
            spreadsheet.deleteColumn(sheetId, columnIndexes);
            message = `Successfully deleted ${columns!.length} column(s): ${columns!.join(", ")}`;
          }
        }

        // Evaluate formulas if deleting
        if (action === "delete") {
          await evaluateFormulas(sheetId, spreadsheet);
        }

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_modifyRowsCols] Completed:", {
          docId,
          sheetId,
          action,
          dimension,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message,
          action,
          dimension,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_modifyRowsCols] Error:", error);

      return JSON.stringify({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to modify rows/columns",
      });
    }
  });
};

/**
 * The spreadsheet_modifyRowsCols tool for LangChain
 */
export const spreadsheetModifyRowsColsTool = tool(
  handleSpreadsheetModifyRowsCols,
  {
    name: "spreadsheet_modifyRowsCols",
    description: `Insert or delete rows/columns in a spreadsheet.

OVERVIEW:
Consolidated tool to insert or delete rows and columns. Use this instead of separate insert/delete tools.

PARAMETERS:
- action: "insert" or "delete"
- dimension: "row" or "column"
- For insert: provide index (where to insert) and count (how many, default 1)
- For delete rows: provide indexes array of row numbers [1, 3, 5]
- For delete columns: provide columns array of letters ["A", "C", "AA"]

EXAMPLES:

Example 1 — Insert 3 rows at row 5:
  action: "insert"
  dimension: "row"
  index: 5
  count: 3

Example 2 — Insert 2 columns at column B (index 2):
  action: "insert"
  dimension: "column"
  index: 2
  count: 2

Example 3 — Delete rows 1, 3, and 5:
  action: "delete"
  dimension: "row"
  indexes: [1, 3, 5]

Example 4 — Delete columns A and C:
  action: "delete"
  dimension: "column"
  columns: ["A", "C"]`,
    schema: SpreadsheetModifyRowsColsSchema,
  },
);

/**
 * Handler for the spreadsheet_queryRange tool
 * Queries multiple ranges of cells from a spreadsheet
 */
const handleSpreadsheetQueryRange = async (
  input: SpreadsheetQueryRangeInput,
): Promise<string> => {
  const { docId, items } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required to query the spreadsheet",
    });
  }

  if (!items || items.length === 0) {
    return JSON.stringify({
      success: false,
      error: "At least one query item is required",
    });
  }

  console.log("[spreadsheet_queryRange] Starting:", {
    docId,
    itemCount: items.length,
  });

  try {
    const { doc, close } = await getShareDBDocument(docId);

    try {
      const data = doc.data as ShareDBSpreadsheetDoc | null;

      if (!data) {
        return JSON.stringify({
          success: false,
          error: "Document has no data",
        });
      }

      const spreadsheet = createSpreadsheetInterface(data, false);
      const results: Array<{
        range: string;
        layer: string;
        cells?: Record<string, unknown>;
        styles?: Record<string, unknown>;
        error?: string;
      }> = [];

      for (const item of items) {
        try {
          const normalizedRange = item.range.startsWith("=")
            ? item.range
            : `=${item.range}`;
          const parsedSelections =
            generateSelectionsFromFormula(normalizedRange);
          const selection = parsedSelections[0];

          // Determine sheetId: explicit sheetId > explicit sheetName > parsed from range > activeSheetId
          let sheetId: number;

          if (item.sheetId !== undefined) {
            // Use explicitly provided sheetId
            sheetId = item.sheetId;
          } else if (item.sheetName !== undefined) {
            // Find sheet by name
            const targetSheet = spreadsheet.sheets.find((sheet) => {
              const title = (sheet as { title?: string }).title;
              const name = (sheet as { name?: string }).name;
              return title === item.sheetName || name === item.sheetName;
            });

            if (!targetSheet) {
              results.push({
                range: item.range,
                layer: item.layer,
                error: `Sheet "${item.sheetName}" not found`,
              });
              continue;
            }

            sheetId = targetSheet.sheetId;
          } else {
            // Fall back to parsing sheet name from range or activeSheetId
            sheetId = spreadsheet.activeSheetId ?? 1;
            const parsedSheetName = selection?.sheetName
              ? desanitizeSheetName(selection.sheetName)
              : undefined;

            if (parsedSheetName) {
              const targetSheet = spreadsheet.sheets.find((sheet) => {
                const title = (sheet as { title?: string }).title;
                const name = (sheet as { name?: string }).name;
                return title === parsedSheetName || name === parsedSheetName;
              });

              if (!targetSheet) {
                results.push({
                  range: item.range,
                  layer: item.layer,
                  error: `Sheet "${parsedSheetName}" not found`,
                });
                continue;
              }

              sheetId = targetSheet.sheetId;
            }
          }

          if (!selection?.range) {
            results.push({
              range: item.range,
              layer: item.layer,
              error: `Invalid range: ${item.range}`,
            });
            continue;
          }

          const {
            startRowIndex,
            endRowIndex,
            startColumnIndex,
            endColumnIndex,
          } = selection.range;

          // Get sheet data
          const sheetData = spreadsheet.sheetData[sheetId];
          const sharedStrings = spreadsheet.sharedStrings;
          const cellXfs = spreadsheet.cellXfs;

          if (item.layer === "values") {
            const cells: Record<string, unknown> = {};

            for (
              let rowIndex = startRowIndex;
              rowIndex <= endRowIndex;
              rowIndex++
            ) {
              for (
                let columnIndex = startColumnIndex;
                columnIndex <= endColumnIndex;
                columnIndex++
              ) {
                const address = cellToAddress({
                  rowIndex,
                  columnIndex,
                });
                if (!address) {
                  continue;
                }
                // sheetData structure: sheetData[rowIndex]?.values?.[colIndex]
                const rowData = sheetData?.[rowIndex];
                const cellData = rowData?.values?.[columnIndex];

                if (!cellData) {
                  // Skip empty cells to reduce response size
                  continue;
                }

                // Cell data may have: value (v), formula (f), formattedValue, style (s), etc.
                const effectiveValue = getCellEffectiveValue(cellData);
                const ss = cellData.ss;
                const ev =
                  getExtendedValueBool(effectiveValue) ??
                  getExtendedValueNumber(effectiveValue) ??
                  getExtendedValueString(effectiveValue);
                const fv = isNil(ss)
                  ? getCellFormattedValue(cellData)
                  : sharedStrings.get(ss);
                const ue = getCellUserEnteredValue(cellData);
                const formula = getExtendedValueFormula(ue);

                // Determine output format based on what data is available
                if (formula) {
                  // Formula cell: [formatted, effective, formula]
                  cells[address] = [fv ?? ev ?? null, ev ?? null, formula];
                } else if (
                  !isNil(fv) &&
                  !isNil(ev) &&
                  fv !== ev &&
                  fv !== String(ev)
                ) {
                  // Formatted differs from effective: [formatted, effective]
                  cells[address] = [fv, ev];
                } else {
                  // Plain value - skip if null to reduce response size
                  const value = ev ?? fv;
                  if (value === undefined || value === null) {
                    continue;
                  }
                  cells[address] = value;
                }
              }
            }

            results.push({
              range: item.range,
              layer: item.layer,
              cells,
            });
          } else if (item.layer === "formatting") {
            const styles: Record<string, unknown> = {};

            for (
              let rowIndex = startRowIndex;
              rowIndex <= endRowIndex;
              rowIndex++
            ) {
              for (
                let columnIndex = startColumnIndex;
                columnIndex <= endColumnIndex;
                columnIndex++
              ) {
                const address = cellToAddress({ rowIndex, columnIndex });

                if (!address) {
                  continue;
                }
                // sheetData structure: sheetData[rowIndex]?.values?.[colIndex]
                const rowData = sheetData?.[rowIndex];
                const cellData = rowData?.values?.[columnIndex];
                const ef = getCellEffectiveFormat(cellData);
                const style = (ef as StyleReference)?.sid
                  ? cellXfs.get(String((ef as StyleReference)?.sid))
                  : ef;

                // Skip cells with no data or no style to reduce response size
                if (!cellData || !style) {
                  continue;
                }

                // Return the cell style/format object
                styles[address] = style;
              }
            }

            results.push({
              range: item.range,
              layer: item.layer,
              styles,
            });
          }
        } catch (itemError) {
          results.push({
            range: item.range,
            layer: item.layer,
            error:
              itemError instanceof Error
                ? itemError.message
                : "Failed to query range",
          });
        }
      }

      console.log("[spreadsheet_queryRange] Completed:", {
        docId,
        resultCount: results.length,
      });

      return JSON.stringify({
        success: true,
        results,
      });
    } finally {
      close();
    }
  } catch (error) {
    console.error("[spreadsheet_queryRange] Error:", error);

    return JSON.stringify({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to query spreadsheet",
    });
  }
};

/**
 * The spreadsheet_queryRange tool for LangChain
 */
export const spreadsheetQueryRangeTool = tool(handleSpreadsheetQueryRange, {
  name: "spreadsheet_queryRange",
  description: `Query multiple ranges of cells from a spreadsheet to get cell data.

ROUTING GUIDANCE (PRIMARY TOOL FOR TARGETED READS):
- Use this tool whenever the user asks for specific cells/ranges, even for a single sheet.
- Use this tool for spot checks, validations after edits, and any scoped read.
- Prefer this over spreadsheet_readDocument when the target range/sheet section is known.

⚠️ CRITICAL: When querying based on a screenshot or visual inspection:
• ALWAYS query the FULL visible range shown in the screenshot
• If you see columns up to L in the screenshot, query through column L
• If you see rows up to 50, query through row 50
• Do NOT stop at the last column/row with visible data - query the entire visible grid
• Empty cells are still valid cells that should be included in queries

WHEN TO USE THIS TOOL:
- Reading cell values before making modifications
- Understanding the current state of a range
- Getting formatting information to match existing styles
- Validating data after changes

PARAMETERS:
- docId: The ID of the spreadsheet asset
- items: List of range queries, each specifying:
  - sheetId: (optional) The numeric sheet ID to query
  - sheetName: (optional) The sheet name to query
  - range: A1 notation range (e.g., "A1:D10" or "'Sheet 1'!A1:D10")
  - layer: 'values' or 'formatting'

SHEET RESOLUTION ORDER:
- If sheetId is provided, it is used.
- Else if sheetName is provided, it is used.
- Else if range includes a sheet name, that is used.
- Else the active sheet is used.

RETURNS:
BatchOperationResponse with per-item results containing:
- For 'values' layer: {"cells": {"A1": value, ...}}
  Values are returned in one of three formats:
  1. Plain value when formatted equals effective: "A1": "Hello" or "A1": 42
  2. [formatted, effective] when formatting differs: "B1": ["$12.00", 12]
  3. [formatted, effective, formula] for formula cells: "C1": ["200", 200, "=SUM(A1)"]
  Example: {"cells": {"A1": "Income", "B1": ["$12.00", 12], "C1": ["200", 200, "=SUM(A1)"]}}
- For 'formatting' layer: {"styles": {"A1": CellFormat, ...}}
  Returns CellFormat objects with styling information (backgroundColor, textFormat, etc.)

EXAMPLES:

Example 1 — Query values from a single range:
  docId: "abc123"
  items: [{"range": "A1:D10", "layer": "values"}]

Example 2 — Query multiple ranges from the same sheet:
  docId: "abc123"
  items: [
    {"range": "'Sheet 1'!A1:D10", "layer": "values"},
    {"range": "'Sheet 1'!A1:A10", "layer": "formatting"}
  ]

Example 3 — Query from multiple different sheets:
  docId: "abc123"
  items: [
    {"sheetName": "Sheet 1", "range": "A1:C20", "layer": "values"},
    {"sheetName": "Sales Data", "range": "B2:F10", "layer": "values"},
    {"sheetName": "Summary", "range": "A1:D5", "layer": "formatting"}
  ]`,
  schema: SpreadsheetQueryRangeSchema,
});

/**
 * Handler for the spreadsheet_setIterativeMode tool
 */
const handleSpreadsheetSetIterativeMode = async (
  input: SpreadsheetSetIterativeModeInput,
): Promise<string> => {
  const { docId, enabled } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required to update iterative mode",
    });
  }

  try {
    const { doc, close } = await getShareDBDocument(docId);

    try {
      const data = doc.data as ShareDBSpreadsheetDoc | null;

      if (!data) {
        return JSON.stringify({
          success: false,
          error: "Document has no data",
        });
      }

      const currentIterativeCalculation = (
        data as ShareDBSpreadsheetDoc & {
          iterativeCalculation?: unknown;
          iterativeCalculationOptions?: unknown;
        }
      ).iterativeCalculation;
      const legacyIterativeCalculationOptions = (
        data as ShareDBSpreadsheetDoc & {
          iterativeCalculationOptions?: unknown;
        }
      ).iterativeCalculationOptions;
      const nextIterativeCalculation = {
        enabled,
      };

      const op: Array<Record<string, unknown>> = [];

      if (currentIterativeCalculation !== undefined) {
        op.push({
          p: ["iterativeCalculation"],
          od: currentIterativeCalculation,
          oi: nextIterativeCalculation,
        });
      } else {
        op.push({
          p: ["iterativeCalculation"],
          oi: nextIterativeCalculation,
        });
      }

      if (legacyIterativeCalculationOptions !== undefined) {
        op.push({
          p: ["iterativeCalculationOptions"],
          od: legacyIterativeCalculationOptions,
        });
      }

      const attribution = createAgentAttribution({
        actorId: "spreadsheet-agent",
        toolName: "spreadsheet_setIterativeMode",
      });
      const submitResult = await trackedSubmitOp(doc, op, attribution, {
        source: "agent",
      });
      if (!submitResult.success) {
        throw (
          submitResult.error ??
          new Error("Failed to submit iterative mode update")
        );
      }

      return JSON.stringify({
        success: true,
        enabled,
        message: `Iterative mode ${enabled ? "enabled" : "disabled"}`,
      });
    } finally {
      close();
    }
  } catch (error) {
    return JSON.stringify({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to set iterative mode",
    });
  }
};

/**
 * The spreadsheet_setIterativeMode tool for LangChain
 */
export const spreadsheetSetIterativeModeTool = tool(
  handleSpreadsheetSetIterativeMode,
  {
    name: "spreadsheet_setIterativeMode",
    description: `Enable or disable iterative calculation mode.

This tool updates iterative calculation settings used by the client spreadsheet instance.

Args:
  docId: The document ID of the spreadsheet.
  enabled: Whether iterative mode is enabled.`,
    schema: SpreadsheetSetIterativeModeSchema,
  },
);

/**
 * Handler for the spreadsheet_readDocument tool
 * Reads content from a spreadsheet and returns values in a workbook format
 */
const handleSpreadsheetReadDocument = async (
  input: SpreadsheetReadDocumentInput,
): Promise<string> => {
  const {
    docId,
    sheetId: inputSheetId,
    range: rangeStr,
    layer = "values",
  } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required to read the spreadsheet",
    });
  }

  console.log("[spreadsheet_readDocument] Starting:", {
    docId,
    sheetId: inputSheetId,
    range: rangeStr,
    layer,
  });

  try {
    const { doc, close } = await getShareDBDocument(docId);

    try {
      const data = doc.data as ShareDBSpreadsheetDoc | null;

      if (!data) {
        return JSON.stringify({
          success: false,
          error: "Document has no data",
        });
      }

      const spreadsheet = createSpreadsheetInterface(data, false);
      const sharedStrings = spreadsheet.sharedStrings;

      // Determine which sheets to read
      let sheetsToRead: Array<{
        sheetId: number;
        title: string;
      }> = [];

      if (!isNil(inputSheetId)) {
        // Find sheet by ID
        const targetSheet = spreadsheet.sheets.find(
          (sheet) => sheet.sheetId === inputSheetId,
        );
        if (!targetSheet) {
          return JSON.stringify({
            success: false,
            error: `Sheet with ID ${inputSheetId} not found`,
          });
        }
        sheetsToRead.push({
          sheetId: targetSheet.sheetId,
          title:
            (targetSheet as { title?: string }).title ||
            (targetSheet as { name?: string }).name ||
            `Sheet${targetSheet.sheetId}`,
        });
      } else {
        // Read all sheets
        sheetsToRead = spreadsheet.sheets.map((sheet) => ({
          sheetId: sheet.sheetId,
          title:
            (sheet as { title?: string }).title ||
            (sheet as { name?: string }).name ||
            `Sheet${sheet.sheetId}`,
        }));
      }

      // Handle metadata-only layer
      if (layer === "metadata") {
        const sheetsMetadata = sheetsToRead.map((sheetInfo) => {
          const sheet = spreadsheet.sheets.find(
            (s) => s.sheetId === sheetInfo.sheetId,
          ) as Sheet | undefined;
          const sheetDataForMeta = spreadsheet.sheetData[sheetInfo.sheetId];

          // Calculate data bounds
          let rowCount = 0;
          let columnCount = 0;
          if (sheetDataForMeta) {
            for (const rowIndexStr of Object.keys(sheetDataForMeta)) {
              const rowIndex = parseInt(rowIndexStr, 10);
              if (isNaN(rowIndex)) continue;
              const rowData = sheetDataForMeta[rowIndex];
              if (!rowData?.values) continue;
              rowCount = Math.max(rowCount, rowIndex);
              for (const colIndexStr of Object.keys(rowData.values)) {
                const colIndex = parseInt(colIndexStr, 10);
                if (isNaN(colIndex)) continue;
                if (rowData.values[colIndex]) {
                  columnCount = Math.max(columnCount, colIndex);
                }
              }
            }
          }

          // Convert merges to A1 notation
          const mergesA1 = (sheet?.merges ?? []).map((merge) =>
            selectionToAddress({ range: merge }),
          );

          return {
            sheetId: sheetInfo.sheetId,
            title: sheetInfo.title,
            index: sheet?.index,
            hidden: sheet?.hidden ?? false,
            frozenRowCount: sheet?.frozenRowCount ?? 0,
            frozenColumnCount: sheet?.frozenColumnCount ?? 0,
            showGridLines: sheet?.showGridLines ?? true,
            tabColor: sheet?.tabColor ?? null,
            merges: mergesA1,
            rowCount,
            columnCount,
          };
        });

        console.log("[spreadsheet_readDocument] Completed (metadata only):", {
          docId,
          sheetCount: sheetsMetadata.length,
        });

        return JSON.stringify({
          success: true,
          metadata: {
            totalSheets: spreadsheet.sheets.length,
            sheets: sheetsMetadata,
          },
        });
      }

      const resultSheets: Array<{
        sheetName: string;
        sheetId: number;
        dimension: string;
        cells: Record<string, unknown>;
        styles: Record<string, unknown>;
      }> = [];

      for (const sheetInfo of sheetsToRead) {
        const sheetData = spreadsheet.sheetData[sheetInfo.sheetId];

        // Determine range to read
        let startRowIndex = 1;
        let endRowIndex = 1;
        let startColumnIndex = 1;
        let endColumnIndex = 1;

        if (rangeStr) {
          // Parse the provided range with sheet name support
          const rangeParsed = parseRangeWithSheetName(
            rangeStr,
            spreadsheet,
            sheetInfo.sheetId,
          );
          if (rangeParsed.selection?.range) {
            // Skip this sheet if the range specifies a different sheet
            if (rangeParsed.sheetId !== sheetInfo.sheetId) {
              continue;
            }
            startRowIndex = rangeParsed.selection.range.startRowIndex;
            endRowIndex = rangeParsed.selection.range.endRowIndex;
            startColumnIndex = rangeParsed.selection.range.startColumnIndex;
            endColumnIndex = rangeParsed.selection.range.endColumnIndex;
          }
        } else {
          // Calculate data bounds from actual data
          let maxRow = 0;
          let maxCol = 0;

          if (sheetData) {
            for (const rowIndexStr of Object.keys(sheetData)) {
              const rowIndex = parseInt(rowIndexStr, 10);
              if (isNaN(rowIndex)) continue;

              const rowData = sheetData[rowIndex];
              if (!rowData?.values) continue;

              for (const colIndexStr of Object.keys(rowData.values)) {
                const colIndex = parseInt(colIndexStr, 10);
                if (isNaN(colIndex)) continue;

                const cellData = rowData.values[colIndex];
                if (cellData) {
                  maxRow = Math.max(maxRow, rowIndex);
                  maxCol = Math.max(maxCol, colIndex);
                }
              }
            }
          }

          if (maxRow > 0 && maxCol > 0) {
            startRowIndex = 1;
            endRowIndex = maxRow;
            startColumnIndex = 1;
            endColumnIndex = maxCol;
          }
        }

        // Build cells object
        const cells: Record<string, unknown> = {};

        if (sheetData) {
          for (
            let rowIndex = startRowIndex;
            rowIndex <= endRowIndex;
            rowIndex++
          ) {
            for (
              let columnIndex = startColumnIndex;
              columnIndex <= endColumnIndex;
              columnIndex++
            ) {
              const address = cellToAddress({ rowIndex, columnIndex });
              if (!address) continue;

              const rowData = sheetData[rowIndex];
              const cellData = rowData?.values?.[columnIndex];

              if (!cellData) {
                // Skip empty cells (don't include nulls)
                continue;
              }

              const effectiveValue = getCellEffectiveValue(cellData);
              const ss = cellData.ss;
              const ev =
                getExtendedValueBool(effectiveValue) ??
                getExtendedValueNumber(effectiveValue) ??
                getExtendedValueString(effectiveValue);
              const fv = isNil(ss)
                ? getCellFormattedValue(cellData)
                : sharedStrings.get(ss);
              const ue = getCellUserEnteredValue(cellData);
              const formula = getExtendedValueFormula(ue);

              // Determine output format based on what data is available
              if (formula) {
                // Formula cell: [formatted, effective, formula]
                cells[address] = [fv ?? ev ?? null, ev ?? null, formula];
              } else if (
                !isNil(fv) &&
                !isNil(ev) &&
                fv !== ev &&
                fv !== String(ev)
              ) {
                // Formatted differs from effective: [formatted, effective]
                cells[address] = [fv, ev];
              } else {
                // Plain value - skip if null to reduce response size
                const value = ev ?? fv;
                if (value === undefined || value === null) {
                  continue;
                }
                cells[address] = value;
              }
            }
          }
        }

        // Calculate dimension string
        const startAddress = cellToAddress({
          rowIndex: startRowIndex,
          columnIndex: startColumnIndex,
        });
        const endAddress = cellToAddress({
          rowIndex: endRowIndex,
          columnIndex: endColumnIndex,
        });
        const dimension =
          startAddress && endAddress ? `${startAddress}:${endAddress}` : "";

        resultSheets.push({
          sheetName: sheetInfo.title,
          sheetId: sheetInfo.sheetId,
          dimension,
          cells,
          styles: {}, // Styles are not included by default for performance
        });
      }

      // Build metadata for all sheets in the workbook
      const metadata = {
        totalSheets: spreadsheet.sheets.length,
        sheets: spreadsheet.sheets.map((sheet) => {
          const sheetDataForMeta = spreadsheet.sheetData[sheet.sheetId];
          let rowCount = 0;
          let columnCount = 0;

          // Calculate data bounds from actual data
          if (sheetDataForMeta) {
            for (const rowIndexStr of Object.keys(sheetDataForMeta)) {
              const rowIndex = parseInt(rowIndexStr, 10);
              if (isNaN(rowIndex)) continue;

              const rowData = sheetDataForMeta[rowIndex];
              if (!rowData?.values) continue;

              rowCount = Math.max(rowCount, rowIndex);

              for (const colIndexStr of Object.keys(rowData.values)) {
                const colIndex = parseInt(colIndexStr, 10);
                if (isNaN(colIndex)) continue;

                if (rowData.values[colIndex]) {
                  columnCount = Math.max(columnCount, colIndex);
                }
              }
            }
          }

          return {
            title:
              (sheet as { title?: string }).title ||
              (sheet as { name?: string }).name ||
              `Sheet${sheet.sheetId}`,
            sheetId: sheet.sheetId,
            rowCount,
            columnCount,
          };
        }),
      };

      console.log("[spreadsheet_readDocument] Completed:", {
        docId,
        sheetCount: resultSheets.length,
      });

      return JSON.stringify({
        success: true,
        metadata,
        workbook: {
          sheets: resultSheets,
        },
      });
    } finally {
      close();
    }
  } catch (error) {
    console.error("[spreadsheet_readDocument] Error:", error);

    return JSON.stringify({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to read spreadsheet",
    });
  }
};

/**
 * The spreadsheet_readDocument tool for LangChain
 */
export const spreadsheetReadDocumentTool = tool(handleSpreadsheetReadDocument, {
  name: "spreadsheet_readDocument",
  description: `Read content from a spreadsheet and return values or metadata in a workbook format.

OVERVIEW:
This tool reads cell data or metadata from a spreadsheet. Use the 'layer' parameter to choose what to return.

ROUTING GUIDANCE (OVERVIEW-FIRST TOOL):
- Use this tool for broad workbook or sheet exploration and structural understanding.
- If the user asks for specific cells/ranges (targeted reads), use spreadsheet_queryRange instead.
- Prefer spreadsheet_readDocument when deciding what ranges to query next, not for repeated scoped reads.

WHEN TO USE THIS TOOL:
- Getting sheet metadata: frozen rows/cols, merges, tab colors, hidden state (use layer: "metadata")
- Getting an overview of the entire spreadsheet structure (use layer: "metadata")
- Reading all data from one or more sheets (use layer: "values")
- Understanding the layout and content of a workbook
- Initial exploration of a spreadsheet before making modifications
- Checking sheet properties before updates (use layer: "metadata")

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: Optional sheet ID to read from (1-based).
- range: Optional A1 notation range (e.g., 'A1:B10'). Only applies when sheetId is provided and layer is "values".
- layer: What to return (optional, defaults to "values"):
  - "values": Returns cell data with basic metadata
  - "metadata": Returns detailed sheet metadata only (titles, dimensions, frozen rows/cols, merges, tab colors, etc.) without cell data

RETURNS FOR layer: "values" (default):
{
  "success": true,
  "metadata": {
    "totalSheets": 3,
    "sheets": [{"title": "Sheet1", "sheetId": 1, "rowCount": 14, "columnCount": 4}]
  },
  "workbook": {
    "sheets": [{
      "sheetName": "Sheet1",
      "sheetId": 1,
      "dimension": "A1:D14",
      "cells": {"A1": "value" or ["formatted", effective] or ["formatted", effective, formula]},
      "styles": {}
    }]
  }
}

RETURNS FOR layer: "metadata":
{
  "success": true,
  "metadata": {
    "totalSheets": 3,
    "sheets": [{
      "sheetId": 1,
      "title": "Sheet1",
      "index": 0,
      "hidden": false,
      "frozenRowCount": 1,
      "frozenColumnCount": 0,
      "showGridLines": true,
      "tabColor": "#FF0000",
      "merges": ["A1:C1", "D3:F5"],
      "rowCount": 14,
      "columnCount": 4
    }]
  }
}

Cell values (layer: "values") are returned in one of three formats:
- Plain value (string/number/boolean) when formatted equals effective
- [formatted_value, effective_value] when formatting differs (e.g., currency)
- [formatted_value, effective_value, formula] when cell has a formula

EXAMPLES:

Example 1 — Get metadata for all sheets (no cell data):
  docId: "abc123"
  layer: "metadata"

Example 2 — Read all cell values:
  docId: "abc123"
  layer: "values"

Example 3 — Read specific sheet by ID:
  docId: "abc123"
  sheetId: 1

Example 4 — Read specific range from a sheet:
  docId: "abc123"
  sheetId: 1
  range: "A1:B10"`,
  schema: SpreadsheetReadDocumentSchema,
});

/**
 * Parse a range string and return the indexes and axis type.
 * Uses addressToSelection for all supported address formats.
 * Examples: "A", "A:G", "1:5", "A1:H1", "B2:B20".
 */
const parseRange = (
  range: string,
  axisHint?: "x" | "y",
): { indexes: number[]; axis: "x" | "y" } | null => {
  const normalized = range.trim();
  const selection = addressToSelection(normalized);
  const gridRange = selection?.range;
  if (!gridRange) {
    return null;
  }

  const rowIndexes: number[] = [];
  for (let i = gridRange.startRowIndex; i <= gridRange.endRowIndex; i++) {
    if (i <= 0) return null;
    rowIndexes.push(i);
  }

  const columnIndexes: number[] = [];
  for (let i = gridRange.startColumnIndex; i <= gridRange.endColumnIndex; i++) {
    if (i <= 0) return null;
    columnIndexes.push(i);
  }

  if (axisHint === "x") {
    return { indexes: rowIndexes, axis: "x" };
  }
  if (axisHint === "y") {
    return { indexes: columnIndexes, axis: "y" };
  }

  const isSingleRow = gridRange.startRowIndex === gridRange.endRowIndex;
  const isSingleColumn =
    gridRange.startColumnIndex === gridRange.endColumnIndex;

  if (isSingleRow && !isSingleColumn) {
    return { indexes: rowIndexes, axis: "x" };
  }
  if (isSingleColumn && !isSingleRow) {
    return { indexes: columnIndexes, axis: "y" };
  }
  if (isSingleRow && isSingleColumn) {
    return { indexes: rowIndexes, axis: "x" };
  }

  return null;
};

const inferAxisHintFromDimensionRange = (range: string): "x" | "y" | null => {
  const scopedRange = range.split("!").pop()?.trim() ?? range.trim();
  const normalized = scopedRange.replace(/\$/g, "");

  if (/^[A-Za-z]+(?::[A-Za-z]+)?$/.test(normalized)) {
    return "y";
  }

  if (/^\d+(?::\d+)?$/.test(normalized)) {
    return "x";
  }

  return null;
};

/**
 * Handler for the spreadsheet_getRowColMetadata tool
 * Reads row heights or column widths from sheet metadata
 */
const handleSpreadsheetGetRowColMetadata = async (
  input: SpreadsheetGetRowColMetadataInput,
): Promise<string> => {
  const {
    docId,
    sheetId: inputSheetId,
    range,
    dimensionType: inputDimensionType,
  } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to query row/column dimensions",
      { field: "docId" },
    );
  }

  const explicitAxisHint: AXIS | null =
    inputDimensionType === "row"
      ? "x"
      : inputDimensionType === "column"
        ? "y"
        : null;
  const inferredAxisHint = inferAxisHintFromDimensionRange(range);
  const axisHint = explicitAxisHint ?? inferredAxisHint ?? undefined;

  const parsedRange = parseRange(range, axisHint);
  if (!parsedRange) {
    return failTool(
      "INVALID_OR_AMBIGUOUS_RANGE",
      `Invalid or ambiguous range: ${range}. Use row ranges like '1:5', column ranges like 'A:G', or set dimensionType for ambiguous A1 ranges.`,
      { range, dimensionType: inputDimensionType },
    );
  }

  const { indexes, axis } = parsedRange;
  const sheetId = inputSheetId ?? 1;

  console.log("[spreadsheet_getRowColMetadata] Starting:", {
    docId,
    sheetId,
    range,
    axis,
    indexCount: indexes.length,
  });

  try {
    const { doc, close } = await getShareDBDocument(docId);

    try {
      const data = doc.data as ShareDBSpreadsheetDoc | null;
      if (!data) {
        return failTool("NO_DOCUMENT_DATA", "Document has no data");
      }

      const spreadsheet = createSpreadsheetInterface(data, false);
      const sheet = spreadsheet.sheets.find((item) => item.sheetId === sheetId);

      if (!sheet) {
        return failTool(
          "SHEET_NOT_FOUND",
          `Sheet with ID ${sheetId} not found`,
          {
            sheetId,
          },
        );
      }

      const rawMetadata =
        axis === "x" ? sheet.rowMetadata : sheet.columnMetadata;
      const metadata = Array.isArray(rawMetadata) ? rawMetadata : [];
      const defaultSize =
        axis === "x" ? DEFAULT_ROW_HEIGHT : DEFAULT_COLUMN_WIDTH;
      const resolvedDimensionType = axis === "x" ? "row" : "column";

      const dimensions = indexes.map((index) => {
        const item = metadata[index];
        const size =
          typeof item?.size === "number" && Number.isFinite(item.size)
            ? item.size
            : defaultSize;
        const columnAddress = cellToAddress({
          rowIndex: 1,
          columnIndex: index,
        });
        const columnLabel = columnAddress?.replace(/\d+/g, "") ?? String(index);
        const a1Range =
          resolvedDimensionType === "column"
            ? `${columnLabel}:${columnLabel}`
            : `${index}:${index}`;

        return {
          index,
          a1Range,
          size,
          resizedByUser: Boolean(item?.resizedByUser),
          hiddenByUser: Boolean(item?.hiddenByUser),
          hiddenByFilter: Boolean(item?.hiddenByFilter),
          isDefaultSize: !item || typeof item.size !== "number",
        };
      });

      console.log("[spreadsheet_getRowColMetadata] Completed:", {
        docId,
        sheetId,
        range,
        dimensionType: resolvedDimensionType,
        count: dimensions.length,
      });

      return JSON.stringify({
        success: true,
        sheetId,
        range,
        dimensionType: resolvedDimensionType,
        indexBase: 1,
        sizeUnit: "px",
        defaultSize,
        count: dimensions.length,
        dimensions,
      });
    } finally {
      close();
    }
  } catch (error) {
    console.error("[spreadsheet_getRowColMetadata] Error:", error);
    return failTool(
      "GET_DIMENSIONS_FAILED",
      error instanceof Error
        ? error.message
        : "Failed to get row/column dimensions",
    );
  }
};

/**
 * The spreadsheet_getRowColMetadata tool for LangChain
 */
export const spreadsheetGetRowColMetadataTool = tool(
  handleSpreadsheetGetRowColMetadata,
  {
    name: "spreadsheet_getRowColMetadata",
    description: `Get row heights or column widths from sheet metadata.

OVERVIEW:
This is a read-only tool that returns row/column dimension metadata for a range.
Use this before resizing to inspect current sizes and visibility flags.

DEFAULT SIZES:
- Default row height: 21px
- Default column width: 100px
- Returned sizes use pixels (sizeUnit = "px")

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (default: 1)
- range: Row or column range (e.g., '1:5', 'A:G', 'A1:H1', 'B2:B20')
- dimensionType: Optional disambiguation hint ('row' or 'column')

RETURNS:
{
  "success": true,
  "sheetId": 1,
  "range": "A:C",
  "dimensionType": "column",
  "indexBase": 1,
  "sizeUnit": "px",
  "defaultSize": 100,
  "count": 3,
  "dimensions": [
    {
      "index": 1,
      "a1Range": "A:A",
      "size": 120,
      "resizedByUser": true,
      "hiddenByUser": false,
      "hiddenByFilter": false,
      "isDefaultSize": false
    }
  ]
}`,
    schema: SpreadsheetGetRowColMetadataSchema,
  },
);

/**
 * Handler for the spreadsheet_setRowColMetadata tool
 * Sets the width of columns or height of rows in a spreadsheet
 */
const handleSpreadsheetSetRowColDimensions = async (
  input: SpreadsheetSetRowColDimensionsInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId, range, width, height } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to modify the spreadsheet",
      { field: "docId" },
    );
  }

  const hasWidth = width !== undefined;
  const hasHeight = height !== undefined;
  if (hasWidth && hasHeight) {
    return failTool(
      "AMBIGUOUS_DIMENSION_SPEC",
      "Specify only one of width or height",
      { range },
    );
  }

  const dimensionSpec = width ?? height;
  if (!dimensionSpec) {
    return failTool(
      "MISSING_DIMENSION_SPEC",
      "Either width or height must be specified",
      { range },
    );
  }

  const axisHint: "x" | "y" = hasHeight ? "x" : "y";

  // Parse the range to get indexes and axis
  const parsedRange = parseRange(range, axisHint);
  if (!parsedRange) {
    return failTool(
      "INVALID_RANGE",
      `Invalid range format: ${range}. Use column notation (e.g., 'A:G'), row notation (e.g., '1:5'), or A1 ranges like 'A1:H1'.`,
      { range },
    );
  }

  const { indexes, axis } = parsedRange;

  // Validate pixel value when type is "pixels"
  if (dimensionSpec.type === "pixels" && dimensionSpec.value === undefined) {
    return failTool(
      "MISSING_PIXEL_VALUE",
      "value is required when type is 'pixels'",
      { dimensionSpec },
    );
  }

  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_setRowColMetadata] Starting:", {
      docId,
      sheetId,
      range,
      indexes,
      axis,
      dimensionSpec,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data, false);

        // Apply the dimension change
        if (dimensionSpec.type === "autofit") {
          // Use autoResize for autofit
          spreadsheet.autoResize(sheetId, indexes, axis);
        } else {
          // Use resize for fixed pixel size
          spreadsheet.resize(sheetId, indexes, dimensionSpec.value!, axis);
        }

        // Get patches from the spreadsheet and persist
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        const dimensionType = axis === "y" ? "column" : "row";
        const dimensionCount = indexes.length;
        const sizeInfo =
          dimensionSpec.type === "pixels"
            ? `${dimensionSpec.value}px`
            : "autofit";

        console.log("[spreadsheet_setRowColMetadata] Completed:", {
          docId,
          sheetId,
          range,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully set ${dimensionCount} ${dimensionType}(s) to ${sizeInfo} in range ${range}`,
          range,
          dimensionType,
          dimensionCount,
          size: sizeInfo,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_setRowColMetadata] Error:", error);

      return failTool(
        "SET_DIMENSIONS_FAILED",
        error instanceof Error
          ? error.message
          : "Failed to set row/column dimensions",
      );
    }
  });
};

/**
 * The spreadsheet_setRowColMetadata tool for LangChain
 */
export const spreadsheetSetRowColDimensionsTool = tool(
  handleSpreadsheetSetRowColDimensions,
  {
    name: "spreadsheet_setRowColMetadata",
    description: `Set the width of columns or height of rows in a spreadsheet.

Use this tool to adjust column widths or row heights. Supports autofit
(automatically adjust to content) or fixed pixel sizes.

DEFAULT SIZES:
- Default row height: 21px
- Default column width: 100px

IMPORTANT - Context-Aware Sizing:
Before setting column widths, EXAMINE ALL DATA in the column (not just headers).
The width should accommodate the TYPICAL DATA VALUES, not the longest header text.

Pixel Width Guidelines:
- Short text/numbers (dates, IDs, small numbers): 80-100px
- Medium text (names, short descriptions): 120-150px
- Long text (descriptions, URLs): 200-300px
- Currency/percentages: 80-100px

Anti-Pattern Warning:
DO NOT set wide columns (200px+) just because the header is long.
If a column has a long header like 'Total Revenue for Q4 2024' but contains
short values like '$1,234', use a narrow width (80-100px) for the data.

Alternative for Long Headers:
Instead of widening columns for long headers, consider using text wrapping
(via spreadsheet_formatRange with wrapStrategy='wrap') to wrap header text
within a narrower column.

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: The sheet ID (default: 1)
- range: A1 notation for columns (e.g., 'A:G') or rows (e.g., '1:5')
- width: Width specification for columns (required when range is columns)
  - type: 'autofit' or 'pixels'
  - value: Size in pixels (required when type is 'pixels')
- height: Height specification for rows (required when range is rows)
  - type: 'autofit' or 'pixels'
  - value: Size in pixels (required when type is 'pixels')

EXAMPLES:

Example 1 — Set columns A through G to 120 pixels wide:
  docId: "abc123"
  range: "A:G"
  width: { "type": "pixels", "value": 120 }

Example 2 — Set column B to autofit:
  docId: "abc123"
  range: "B:B"
  width: { "type": "autofit" }

Example 3 — Set rows 1 through 5 to 40 pixels tall:
  docId: "abc123"
  range: "1:5"
  height: { "type": "pixels", "value": 40 }

Example 4 — Set row 1 (header row) to a larger height:
  docId: "abc123"
  range: "1:1"
  height: { "type": "pixels", "value": 30 }`,
    schema: SpreadsheetSetRowColDimensionsSchema,
  },
);

/**
 * Handler for the spreadsheet_applyFill tool
 * Applies Excel-style fill operation to extend data patterns
 */
const handleSpreadsheetApplyFill = async (
  input: SpreadsheetApplyFillInput,
): Promise<string> => {
  const {
    docId,
    sheetId: inputSheetId,
    activeCell: activeCellStr,
    sourceRange,
    fillRange,
  } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to apply fill", {
      field: "docId",
    });
  }

  if (!activeCellStr) {
    return failTool("MISSING_ACTIVE_CELL", "activeCell is required", {
      field: "activeCell",
    });
  }

  if (!sourceRange) {
    return failTool("MISSING_SOURCE_RANGE", "sourceRange is required", {
      field: "sourceRange",
    });
  }

  if (!fillRange) {
    return failTool("MISSING_FILL_RANGE", "fillRange is required", {
      field: "fillRange",
    });
  }

  const defaultSheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_applyFill] Starting:", {
      docId,
      sheetId: defaultSheetId,
      activeCell: activeCellStr,
      sourceRange,
      fillRange,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Parse activeCell from A1 notation (simple cell, no sheet name needed)
        const activeCellSelection = addressToSelection(activeCellStr);
        if (!activeCellSelection?.range) {
          return failTool(
            "INVALID_ACTIVE_CELL",
            `Invalid activeCell: ${activeCellStr}`,
            { activeCell: activeCellStr },
          );
        }

        const activeCell = {
          rowIndex: activeCellSelection.range.startRowIndex,
          columnIndex: activeCellSelection.range.startColumnIndex,
        };

        // Parse sourceRange with sheet name support
        const sourceParsed = parseRangeWithSheetName(
          sourceRange,
          spreadsheet,
          defaultSheetId,
        );
        if (!sourceParsed.selection?.range) {
          return failTool(
            "INVALID_SOURCE_RANGE",
            sourceParsed.error || `Invalid sourceRange: ${sourceRange}`,
            { sourceRange },
          );
        }

        // Parse fillRange with sheet name support
        const fillParsed = parseRangeWithSheetName(
          fillRange,
          spreadsheet,
          defaultSheetId,
        );
        if (!fillParsed.selection?.range) {
          return failTool(
            "INVALID_FILL_RANGE",
            fillParsed.error || `Invalid fillRange: ${fillRange}`,
            {
              fillRange,
            },
          );
        }

        // Use the sheetId from source range (source and fill should be on same sheet)
        const sheetId = sourceParsed.sheetId;

        // Create selections array from source range
        const selections = [{ range: sourceParsed.selection.range }];

        // Apply fill operation
        await spreadsheet.applyFill(
          sheetId,
          activeCell,
          { range: fillParsed.selection.range },
          selections,
        );

        // Evaluate formulas
        const formulaResults = await evaluateFormulas(sheetId, spreadsheet);

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_applyFill] Completed:", {
          docId,
          sheetId,
          sourceRange,
          fillRange,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully applied fill from ${sourceRange} to ${fillRange}`,
          sourceRange,
          fillRange,
          formulaResults,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_applyFill] Error:", error);

      return failTool(
        "APPLY_FILL_FAILED",
        error instanceof Error ? error.message : "Failed to apply fill",
      );
    }
  });
};

/**
 * The spreadsheet_applyFill tool for LangChain
 */
export const spreadsheetApplyFillTool = tool(handleSpreadsheetApplyFill, {
  name: "spreadsheet_applyFill",
  description: `Apply Excel-style fill operation to extend data patterns across a range.

OVERVIEW:
This tool replicates Excel's fill functionality (drag-to-fill or Ctrl+D/Ctrl+R), automatically extending:
• Values (copy same value)
• Number sequences (1, 2, 3... or 10, 20, 30...)
• Date sequences (incrementing days, months, years)
• Formulas (adjusting cell references automatically)
• Formatting from source cells to target cells

WHEN TO USE THIS TOOL (PREFER THIS OVER changeBatch FOR SEQUENCES):
- Extending number sequences (1, 2, 3... or 10, 20, 30... or fiscal months 1-12)
- Extending date sequences (Jan, Feb, Mar... or Q1, Q2, Q3...)
- Copying formulas down/across with auto-adjusted references
- Replicating values or formatting patterns
- Creating series like months, weekdays, or custom patterns

TOKEN EFFICIENCY:
Instead of writing 12 values with changeBatch like:
  cells: [[{"value": 1}, {"value": 2}, {"value": 3}, ... {"value": 12}]]
Use this approach:
  1. changeBatch: Write first 2 values to establish pattern (e.g., 1, 2 in B5:C5)
  2. applyFill: Extend to remaining cells (sourceRange: "B5:C5", fillRange: "D5:M5")

CRITICAL:
- fillRange must NOT include sourceRange.
- fillRange specifies ONLY the destination cells to be filled
- For fill DOWN: fillRange starts at the row AFTER sourceRange ends
- For fill RIGHT: fillRange starts at the column AFTER sourceRange ends
- For reliability, batch along the fill direction with a max span of 50 per call.
- Vertical fills: if destination height is >50 rows, split into multiple applyFill calls.
- Horizontal fills: if destination width is >50 columns, split into multiple applyFill calls.
- Avoid single very large fills (for example hundreds or thousands of cells in one call), which can timeout or crash.

OTHER NOTES:
- All indices are 1-based
- The tool auto-detects patterns (numbers, dates, series)
- Source and fill ranges should be on the same sheet.

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: The sheet ID (1-based, default: 1)
- activeCell: A1 notation for the active cell, typically the top-left of the source (e.g., 'A1')
- sourceRange: A1 notation for the source range containing the pattern (e.g., 'A1:A2')
- fillRange: A1 notation for the DESTINATION cells only, NOT including the source (e.g., 'A3:A10')

EXAMPLES:

Example 1 — Fill down a number sequence (1, 2 in A1:A2 → fills 3, 4, 5 in A3:A5):
  docId: "abc123"
  sheetId: 1
  activeCell: "A1"
  sourceRange: "A1:A2"
  fillRange: "A3:A5"

Example 2 — Copy a formula down (formula in B2 → copy to B3:B10):
  docId: "abc123"
  activeCell: "B2"
  sourceRange: "B2"
  fillRange: "B3:B10"

Example 3 — Fill right with a value (value in A1 → copy to B1:E1):
  docId: "abc123"
  activeCell: "A1"
  sourceRange: "A1"
  fillRange: "B1:E1"

Example 4 — Extend a date series (Jan, Feb in A1:A2 → fills Mar, Apr... in A3:A12):
  docId: "abc123"
  activeCell: "A1"
  sourceRange: "A1:A2"
  fillRange: "A3:A12"

Example 5 — Fill fiscal months 1-12 across row (1, 2 in B5:C5 → fills 3-12 in D5:M5):
  docId: "abc123"
  activeCell: "B5"
  sourceRange: "B5:C5"
  fillRange: "D5:M5"

Example 6 — Fill formulas down across multiple columns (formulas in row 2 → copy to rows 3-50):
  docId: "abc123"
  activeCell: "A2"
  sourceRange: "A2:F2"
  fillRange: "A3:F50"
  (Note: fillRange starts at row 3, NOT row 2 - formulas auto-adjust references)

Example 7 — Fill incrementing numbers down (values 1,2 in A1:A2 → fills 3,4,5... in A3:A100):
  docId: "abc123"
  activeCell: "A1"
  sourceRange: "A1:A2"
  fillRange: "A3:A100"
  (Note: sourceRange has 2 ROWS to establish the incrementing pattern)`,
  schema: SpreadsheetApplyFillSchema,
});

/**
 * Consolidated handler for spreadsheet_note tool (set/delete)
 */
const handleSpreadsheetNote = async (
  input: SpreadsheetNoteInput,
): Promise<string> => {
  const { docId, action, sheetId: inputSheetId, cell, note } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required", { field: "docId" });
  }

  if (!cell) {
    return failTool("MISSING_CELL", "cell is required", { field: "cell" });
  }

  if (action === "set" && !note) {
    return failTool("MISSING_NOTE", "note is required for 'set' action", {
      field: "note",
      action,
    });
  }

  const defaultSheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log(`[spreadsheet_note:${action}] Starting:`, {
      docId,
      sheetId: defaultSheetId,
      cell,
      noteLength: note?.length ?? 0,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data, false);

        // Parse cell from A1 notation with sheet name support
        const cellParsed = parseRangeWithSheetName(
          cell,
          spreadsheet,
          defaultSheetId,
        );
        if (!cellParsed.selection?.range) {
          return failTool(
            "INVALID_CELL",
            cellParsed.error || `Invalid cell: ${cell}`,
            { cell },
          );
        }

        const sheetId = cellParsed.sheetId;
        const cellInterface = {
          rowIndex: cellParsed.selection.range.startRowIndex,
          columnIndex: cellParsed.selection.range.startColumnIndex,
        };

        // Set or delete note
        const noteValue = action === "set" ? note : undefined;
        spreadsheet.insertNote(sheetId, cellInterface, noteValue);

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        const actionLabel = action === "set" ? "Set" : "Deleted";
        console.log(`[spreadsheet_note:${action}] Completed:`, {
          docId,
          sheetId,
          cell,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `${actionLabel} note on cell ${cell}`,
          cell,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error(`[spreadsheet_note:${action}] Error:`, error);

      return failTool(
        "NOTE_OPERATION_FAILED",
        error instanceof Error ? error.message : `Failed to ${action} note`,
      );
    }
  });
};

/**
 * The consolidated spreadsheet_note tool for LangChain
 */
export const spreadsheetNoteTool = tool(handleSpreadsheetNote, {
  name: "spreadsheet_note",
  description: `Manage notes (comments) on cells - set or delete.

OVERVIEW:
This tool manages cell notes/comments. Use the 'action' parameter to specify what you want to do:
- "set": Add or update a note on a cell
- "delete": Remove a note from a cell

WHEN TO USE THIS TOOL:
- Adding explanatory notes to cells
- Updating existing notes with new content
- Removing notes from cells
- Providing context or instructions for specific data

PARAMETERS:
- docId: The document ID (required)
- action: "set" | "delete" (required)
- cell: A1 notation for the cell (e.g., 'A1', 'Sheet2!B5')
- sheetId: The sheet ID (optional, default: 1)
- note: The note text (required for 'set' action)

EXAMPLES:

Example 1 — Add a note to a cell:
  action: "set"
  docId: "abc123"
  cell: "A1"
  note: "This is the header row"

Example 2 — Update an existing note:
  action: "set"
  docId: "abc123"
  cell: "B5"
  note: "Updated calculation method"

Example 3 — Delete a note from a cell:
  action: "delete"
  docId: "abc123"
  cell: "A1"`,
  schema: SpreadsheetNoteSchema,
});

/**
 * Consolidated handler for spreadsheet_named_range tool (create/delete)
 */
const handleSpreadsheetNamedRange = async (
  input: SpreadsheetNamedRangeInput,
): Promise<string> => {
  const { docId, action, name, range, sheetId } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required", { field: "docId" });
  }

  if (!name || name.trim().length === 0) {
    return failTool("MISSING_NAME", "name is required", { field: "name" });
  }

  // Validate named range name format
  const validNamePattern = /^[A-Za-z_][A-Za-z0-9_.]*$/;
  if (!validNamePattern.test(name)) {
    return failTool(
      "INVALID_NAME",
      "Named range name must start with a letter or underscore, and contain only letters, numbers, underscores, and periods.",
      { field: "name", value: name },
    );
  }

  if (action === "create") {
    if (!range) {
      return failTool("MISSING_RANGE", "range is required for create action", {
        field: "range",
      });
    }

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data) {
            return failTool("NO_DOCUMENT_DATA", "Document has no data");
          }

          const spreadsheet = createSpreadsheetInterface(data, false);

          // Check if name already exists
          const existingNamedRanges = (spreadsheet.namedRanges ?? []) as Array<{
            name: string;
            namedRangeId?: string;
          }>;
          const existingIndex = existingNamedRanges.findIndex(
            (nr) => nr.name.toLowerCase() === name.toLowerCase(),
          );
          if (existingIndex !== -1) {
            return failTool(
              "NAME_EXISTS",
              `A named range with name "${name}" already exists`,
              { field: "name", value: name },
            );
          }

          // Parse range with sheet name support
          const defaultSheetId = sheetId ?? 1;
          const rangeParsed = parseRangeWithSheetName(
            range,
            spreadsheet,
            defaultSheetId,
          );

          if (!rangeParsed.selection?.range) {
            return failTool(
              "INVALID_RANGE",
              rangeParsed.error || `Invalid range: ${range}`,
              { field: "range", value: range },
            );
          }

          const resolvedSheetId = rangeParsed.sheetId;
          const namedRangeId = uuidString();
          const newNamedRange = {
            namedRangeId,
            name: name.trim(),
            range: {
              sheetId: resolvedSheetId,
              startRowIndex: rangeParsed.selection.range.startRowIndex,
              startColumnIndex: rangeParsed.selection.range.startColumnIndex,
              endRowIndex: rangeParsed.selection.range.endRowIndex,
              endColumnIndex: rangeParsed.selection.range.endColumnIndex,
            },
          };

          // Use spreadsheet interface to create the named range
          spreadsheet.createNamedRange(resolvedSheetId, newNamedRange);

          // Persist changes
          await persistSpreadsheetPatches(doc, spreadsheet);

          const sheetName = spreadsheet.sheets.find(
            (s) => s.sheetId === resolvedSheetId,
          )?.title;
          const rangeAddress = selectionToAddress(
            { range: rangeParsed.selection.range },
            sheetName,
          );

          return JSON.stringify({
            success: true,
            message: `Created named range "${name}" referencing ${rangeAddress}`,
            namedRangeId,
            name: name.trim(),
            range: rangeAddress,
            sheetId: resolvedSheetId,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "CREATE_NAMED_RANGE_ERROR",
          error instanceof Error
            ? error.message
            : "Failed to create named range",
        );
      }
    });
  }

  if (action === "delete") {
    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data) {
            return failTool("NO_DOCUMENT_DATA", "Document has no data");
          }

          const spreadsheet = createSpreadsheetInterface(data, false);

          // Find the named range by name
          const existingNamedRanges = spreadsheet.namedRanges ?? [];
          const targetRange = existingNamedRanges.find(
            (nr) => nr.name.toLowerCase() === name.toLowerCase(),
          );

          if (!targetRange || !targetRange.namedRangeId) {
            return failTool(
              "NAMED_RANGE_NOT_FOUND",
              `Named range "${name}" not found`,
              { field: "name", value: name },
            );
          }

          // Use spreadsheet interface to delete the named range
          spreadsheet.deleteNamedRange(targetRange.namedRangeId);

          // Persist changes
          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Deleted named range "${targetRange.name}"`,
            name: targetRange.name,
            namedRangeId: targetRange.namedRangeId,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "DELETE_NAMED_RANGE_ERROR",
          error instanceof Error
            ? error.message
            : "Failed to delete named range",
        );
      }
    });
  }

  return failTool("INVALID_ACTION", `Unknown action: ${action}`, {
    field: "action",
    value: action,
  });
};

export const spreadsheetNamedRangeTool = tool(handleSpreadsheetNamedRange, {
  name: "spreadsheet_named_range",
  description: `Manage named ranges in the spreadsheet - create or delete.

OVERVIEW:
Named ranges allow you to assign a name to a cell range, making formulas more readable and easier to maintain. For example, instead of =SUM(A1:A10), you can use =SUM(Revenue).

WHEN TO USE THIS TOOL:
- Creating named ranges for frequently referenced data
- Making formulas more readable with descriptive names
- Setting up dynamic ranges for charts or data validation
- Removing named ranges that are no longer needed

ACTIONS:
- "create": Create a new named range (requires name and range)
- "delete": Remove an existing named range (requires name)

NAMING RULES:
- Must start with a letter or underscore
- Can contain letters, numbers, underscores, and periods
- Cannot contain spaces or special characters
- Must be unique within the workbook (case-insensitive)

PARAMETERS:
- docId: The document ID (required)
- action: "create" | "delete" (required)
- name: The name for the named range (required)
- range: A1 notation range, can include sheet name (required for create)
- sheetId: Sheet ID for scoping (optional, defaults to active sheet)

EXAMPLES:

Example 1 — Create a named range:
  action: "create"
  docId: "abc123"
  name: "Revenue"
  range: "A1:A100"

Example 2 — Create a named range on a specific sheet:
  action: "create"
  docId: "abc123"
  name: "SalesData"
  range: "Sales!B2:D50"

Example 3 — Delete a named range:
  action: "delete"
  docId: "abc123"
  name: "OldRange"`,
  schema: SpreadsheetNamedRangeSchema,
});

/**
 * Consolidated handler for spreadsheet_sheet tool (create/update/delete)
 */
const handleSpreadsheetSheet = async (
  input: SpreadsheetSheetInput,
): Promise<string> => {
  const {
    docId,
    action,
    sheetId: inputSheetId,
    activeSheetId,
    title,
    index,
    hidden,
    merges,
    removeMerges,
    hideRows,
    showRows,
    hideCols,
    showCols,
    frozenRowCount,
    frozenColumnCount,
    showGridLines,
    tabColor,
    basicFilter,
    unsetFields,
    newSheetId,
  } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required", { field: "docId" });
  }

  // Validate sheetId requirements based on action
  if (
    (action === "update" || action === "delete" || action === "duplicate") &&
    isNil(inputSheetId)
  ) {
    return failTool(
      "MISSING_SHEET_ID",
      `sheetId is required for '${action}' action`,
      { field: "sheetId", action },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log(`[spreadsheet_sheet:${action}] Starting:`, {
      docId,
      sheetId: inputSheetId,
      title,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data, false);

        // === DELETE ACTION ===
        if (action === "delete") {
          const sheetId = inputSheetId!;
          const sheet = spreadsheet.sheets.find((s) => s.sheetId === sheetId);
          if (!sheet) {
            return failTool("SHEET_NOT_FOUND", `Sheet ${sheetId} not found`, {
              sheetId,
            });
          }

          if (spreadsheet.sheets.length === 1) {
            return failTool(
              "CANNOT_DELETE_LAST_SHEET",
              "Cannot delete the last sheet in a workbook",
            );
          }

          spreadsheet.deleteSheet(sheetId);
          const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

          console.log(`[spreadsheet_sheet:delete] Completed:`, {
            docId,
            sheetId,
            patchCount: patchTuples.length,
          });

          return JSON.stringify({
            success: true,
            message: `Successfully deleted sheet ${sheetId}`,
            sheetId,
          });
        }

        // === DUPLICATE ACTION ===
        if (action === "duplicate") {
          const sheetId = inputSheetId!;
          const sourceSheet = spreadsheet.sheets.find(
            (s) => s.sheetId === sheetId,
          );
          if (!sourceSheet) {
            return failTool("SHEET_NOT_FOUND", `Sheet ${sheetId} not found`, {
              sheetId,
            });
          }

          const duplicatedSheetId = spreadsheet.duplicateSheet(
            sheetId,
            newSheetId,
          );
          const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

          const duplicatedSheet = spreadsheet.sheets.find(
            (s) => s.sheetId === duplicatedSheetId,
          );

          console.log(`[spreadsheet_sheet:duplicate] Completed:`, {
            docId,
            sourceSheetId: sheetId,
            newSheetId: duplicatedSheetId,
            patchCount: patchTuples.length,
          });

          return JSON.stringify({
            success: true,
            message: `Successfully duplicated sheet ${sheetId} to new sheet ${duplicatedSheetId}`,
            sourceSheetId: sheetId,
            sheet: {
              sheetId: duplicatedSheetId,
              title: duplicatedSheet?.title ?? `Sheet${duplicatedSheetId}`,
            },
          });
        }

        // === CREATE ACTION ===
        if (action === "create") {
          if (!isNil(activeSheetId)) {
            spreadsheet.activeSheetId = activeSheetId;
          }

          // Build sheet spec for createNewSheet
          const spec: Record<string, unknown> = {};

          if (title) {
            spec.title = title;
          }
          if (inputSheetId !== undefined) {
            spec.sheetId = inputSheetId;
          }
          if (index !== undefined) {
            spec.index = index;
          }
          if (hidden !== undefined) {
            spec.hidden = hidden;
          }
          // Convert A1 notation merges to GridRange format
          if (merges && merges.length > 0) {
            const { validRanges, invalidRanges } = parseMergeRangesFromA1(
              merges,
            );
            if (invalidRanges.length > 0) {
              return failTool(
                "INVALID_MERGE_RANGE",
                "One or more merge ranges are invalid A1 ranges.",
                { invalidRanges },
                false,
              );
            }

            const overlapInRequest = findOverlappingMergePair(validRanges);
            if (overlapInRequest) {
              const [left, right] = overlapInRequest;
              return failTool(
                "OVERLAPPING_MERGE_RANGES",
                "Merge ranges cannot overlap each other.",
                {
                  conflictingRanges: [
                    rangeToA1OrFallback(left),
                    rangeToA1OrFallback(right),
                  ],
                },
                false,
              );
            }

            spec.merges = validRanges;
          }
          // Convert hideRows/showRows to rowMetadata
          const rowMetadata: DimensionProperties[] = [];
          if (hideRows) {
            for (const row of hideRows) {
              rowMetadata[row] = { hiddenByUser: true };
            }
          }
          if (showRows) {
            for (const row of showRows) {
              rowMetadata[row] = { hiddenByUser: false };
            }
          }
          if (rowMetadata.length > 0) {
            spec.rowMetadata = rowMetadata;
          }
          // Convert hideCols/showCols to columnMetadata
          const columnMetadata: DimensionProperties[] = [];
          if (hideCols) {
            for (const colLetter of hideCols) {
              const colIndex = alpha2number(colLetter);
              columnMetadata[colIndex] = { hiddenByUser: true };
            }
          }
          if (showCols) {
            for (const colLetter of showCols) {
              const colIndex = alpha2number(colLetter);
              columnMetadata[colIndex] = { hiddenByUser: false };
            }
          }
          if (columnMetadata.length > 0) {
            spec.columnMetadata = columnMetadata;
          }
          if (frozenRowCount !== undefined) {
            spec.frozenRowCount = frozenRowCount;
          }
          if (frozenColumnCount !== undefined) {
            spec.frozenColumnCount = frozenColumnCount;
          }
          if (showGridLines !== undefined) {
            spec.showGridLines = showGridLines;
          }
          if (tabColor !== undefined) {
            spec.tabColor = tabColor;
          }
          // Convert basicFilter A1 notation to FilterView
          if (basicFilter !== undefined) {
            if (basicFilter === null) {
              spec.basicFilter = null;
            } else {
              const filterSelection = addressToSelection(basicFilter);
              if (filterSelection?.range) {
                spec.basicFilter = {
                  id: uuidString(),
                  range: filterSelection.range,
                };
              }
            }
          }

          // Create the new sheet
          const newSheet = spreadsheet.createNewSheet(
            Object.keys(spec).length > 0 ? spec : undefined,
          );

          const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

          console.log(`[spreadsheet_sheet:create] Completed:`, {
            docId,
            newSheetId: newSheet.sheetId,
            newSheetTitle: newSheet.title,
            patchCount: patchTuples.length,
          });

          return JSON.stringify({
            success: true,
            message: `Successfully created sheet "${newSheet?.title}" with ID ${newSheet?.sheetId}`,
            sheet: {
              sheetId: newSheet?.sheetId,
              title: newSheet?.title,
            },
          });
        }

        // === UPDATE ACTION ===
        if (action === "update") {
          const sheetId = inputSheetId!;

          // Build sheet spec for updateSheet
          const spec: Partial<Sheet> = {};

          if (title !== undefined) {
            spec.title = title;
          }
          if (index !== undefined) {
            spec.index = index;
          }
          if (hidden !== undefined) {
            spec.hidden = hidden;
          }
          // Handle merges: add new merges and/or remove existing ones
          if (merges?.length || removeMerges?.length) {
            const sheet = spreadsheet.sheets.find((s) => s.sheetId === sheetId);
            let currentMerges = sheet?.merges ?? [];

            // Remove merges that match removeMerges ranges
            if (removeMerges?.length) {
              const { validRanges, invalidRanges } = parseMergeRangesFromA1(
                removeMerges,
              );
              if (invalidRanges.length > 0) {
                return failTool(
                  "INVALID_REMOVE_MERGE_RANGE",
                  "One or more removeMerges ranges are invalid A1 ranges.",
                  { invalidRanges },
                  false,
                );
              }

              const rangesToRemove = validRanges;

              currentMerges = currentMerges.filter((existing) => {
                const shouldRemove = rangesToRemove.some(
                  (toRemove) =>
                    existing.startRowIndex === toRemove.startRowIndex &&
                    existing.endRowIndex === toRemove.endRowIndex &&
                    existing.startColumnIndex === toRemove.startColumnIndex &&
                    existing.endColumnIndex === toRemove.endColumnIndex,
                );
                return !shouldRemove;
              });
            }

            // Add new merges (fail if they intersect with remaining merges or each other)
            if (merges?.length) {
              const { validRanges, invalidRanges } = parseMergeRangesFromA1(
                merges,
              );
              if (invalidRanges.length > 0) {
                return failTool(
                  "INVALID_MERGE_RANGE",
                  "One or more merge ranges are invalid A1 ranges.",
                  { invalidRanges },
                  false,
                );
              }

              const overlapInRequest = findOverlappingMergePair(validRanges);
              if (overlapInRequest) {
                const [left, right] = overlapInRequest;
                return failTool(
                  "OVERLAPPING_MERGE_RANGES",
                  "Merge ranges cannot overlap each other.",
                  {
                    conflictingRanges: [
                      rangeToA1OrFallback(left),
                      rangeToA1OrFallback(right),
                    ],
                  },
                  false,
                );
              }

              const overlapWithExisting = findOverlapWithExistingMerge(
                validRanges,
                currentMerges,
              );
              if (overlapWithExisting) {
                const [candidate, existing] = overlapWithExisting;
                return failTool(
                  "MERGE_OVERLAPS_EXISTING",
                  "Merge range overlaps an existing merge. Unmerge first using removeMerges.",
                  {
                    conflictingRanges: [
                      rangeToA1OrFallback(candidate),
                      rangeToA1OrFallback(existing),
                    ],
                  },
                  false,
                );
              }

              const newMerges = validRanges;
              currentMerges = [...currentMerges, ...newMerges];
            }

            spec.merges = currentMerges;
          }
          // Convert hideRows/showRows - merge with existing rowMetadata
          if (hideRows?.length || showRows?.length) {
            const sheet = spreadsheet.sheets.find((s) => s.sheetId === sheetId);
            const existingRowMetadata = sheet?.rowMetadata ?? [];
            const rowMetadata = [...existingRowMetadata];
            if (hideRows) {
              for (const row of hideRows) {
                rowMetadata[row] = { ...rowMetadata[row], hiddenByUser: true };
              }
            }
            if (showRows) {
              for (const row of showRows) {
                rowMetadata[row] = { ...rowMetadata[row], hiddenByUser: false };
              }
            }
            spec.rowMetadata = rowMetadata;
          }
          // Convert hideCols/showCols - merge with existing columnMetadata
          if (hideCols?.length || showCols?.length) {
            const sheet = spreadsheet.sheets.find((s) => s.sheetId === sheetId);
            const existingColMetadata = sheet?.columnMetadata ?? [];
            const columnMetadata = [...existingColMetadata];
            if (hideCols) {
              for (const colLetter of hideCols) {
                const colIndex = alpha2number(colLetter);
                columnMetadata[colIndex] = {
                  ...columnMetadata[colIndex],
                  hiddenByUser: true,
                };
              }
            }
            if (showCols) {
              for (const colLetter of showCols) {
                const colIndex = alpha2number(colLetter);
                columnMetadata[colIndex] = {
                  ...columnMetadata[colIndex],
                  hiddenByUser: false,
                };
              }
            }
            spec.columnMetadata = columnMetadata;
          }
          if (frozenRowCount !== undefined) {
            spec.frozenRowCount = frozenRowCount;
          }
          if (frozenColumnCount !== undefined) {
            spec.frozenColumnCount = frozenColumnCount;
          }
          if (showGridLines !== undefined) {
            spec.showGridLines = showGridLines;
          }
          if (tabColor !== undefined) {
            spec.tabColor = tabColor as Sheet["tabColor"];
          }
          // Convert basicFilter A1 notation to FilterView
          if (basicFilter !== undefined) {
            if (basicFilter === null) {
              spec.basicFilter = null;
            } else {
              const filterSelection = addressToSelection(basicFilter);
              if (filterSelection?.range) {
                const sheet = spreadsheet.sheets.find(
                  (s) => s.sheetId === sheetId,
                );
                const existingId = sheet?.basicFilter?.id;
                spec.basicFilter = {
                  id: existingId ?? uuidString(),
                  range: filterSelection.range,
                };
              }
            }
          }

          // Handle unsetFields - explicitly set these to null
          const validSheetSpecKeys = new Set([
            "frozenRowCount",
            "frozenColumnCount",
            "tabColor",
            "showGridLines",
            "hidden",
            "merges",
            "rowMetadata",
            "columnMetadata",
            "basicFilter",
          ]);

          if (unsetFields && unsetFields.length > 0) {
            for (const field of unsetFields) {
              if (!validSheetSpecKeys.has(field)) {
                console.warn(
                  `[spreadsheet_sheet:update] Ignoring invalid unsetField: ${field}`,
                );
                continue;
              }
              (spec as Record<string, unknown>)[field] = null;
            }
          }

          // Update the sheet
          spreadsheet.updateSheet(
            sheetId,
            Object.keys(spec).length > 0 ? spec : {},
          );

          const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

          console.log(`[spreadsheet_sheet:update] Completed:`, {
            docId,
            sheetId,
            patchCount: patchTuples.length,
          });

          return JSON.stringify({
            success: true,
            message: `Successfully updated sheet ${sheetId}`,
            sheetId,
          });
        }

        // Should never reach here
        return failTool("INVALID_ACTION", `Invalid action: ${action}`, {
          action,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error(`[spreadsheet_sheet:${action}] Error:`, error);
      return failTool(
        "SHEET_OPERATION_FAILED",
        error instanceof Error ? error.message : `Failed to ${action} sheet`,
      );
    }
  });
};

/**
 * The consolidated spreadsheet_sheet tool for LangChain
 */
export const spreadsheetSheetTool = tool(handleSpreadsheetSheet, {
  name: "spreadsheet_sheet",
  description: `Manage sheets (tabs) in a spreadsheet document - create, update, or delete.

OVERVIEW:
This tool provides unified sheet management. Use the 'action' parameter to specify what you want to do:
- "create": Add a new sheet/tab
- "update": Modify an existing sheet's properties
- "delete": Remove a sheet from the workbook
- "duplicate": Copy an existing sheet to a new sheet

WHEN TO USE THIS TOOL:
- Adding new worksheets to organize data
- Renaming sheet tabs or changing tab colors
- Setting frozen rows/columns
- Adding or removing cell merges
- Hiding/showing rows or columns
- Adding or removing basic filters
- Showing/hiding grid lines
- Deleting unwanted sheets
- Duplicating sheets as templates or backups

IMPORTANT MERGE SAFETY:
- Merge ranges must be valid A1 notation.
- Merge ranges must never overlap each other.
- New merges must not overlap existing merges on the sheet.
- If overlap is needed, unmerge first using removeMerges, then apply non-overlapping merges.

PARAMETERS:
- docId: The document ID (required for all actions)
- action: "create" | "update" | "delete" | "duplicate" (required)
- sheetId: Required for update/delete/duplicate, optional for create (auto-generated if omitted)
- newSheetId: Optional ID for the duplicated sheet (only for 'duplicate' action)

EXAMPLES:

Example 1 — Create a simple sheet:
  action: "create"
  docId: "abc123"
  title: "Sales Report"

Example 2 — Create a sheet with frozen header and filter:
  action: "create"
  docId: "abc123"
  title: "Data"
  frozenRowCount: 1
  basicFilter: "A1:D100"

Example 3 — Update sheet title and tab color:
  action: "update"
  docId: "abc123"
  sheetId: 1
  title: "Q1 Sales"
  tabColor: "#4285F4"

Example 4 — Add a basic filter to existing sheet:
  action: "update"
  docId: "abc123"
  sheetId: 1
  basicFilter: "A1:E50"

Example 5 — Remove basic filter:
  action: "update"
  docId: "abc123"
  sheetId: 1
  basicFilter: null

Example 6 — Hide rows and columns:
  action: "update"
  docId: "abc123"
  sheetId: 1
  hideRows: [2, 3, 4]
  hideCols: ["A", "B"]

Example 7 — Delete a sheet:
  action: "delete"
  docId: "abc123"
  sheetId: 2

Example 8 — Duplicate a sheet:
  action: "duplicate"
  docId: "abc123"
  sheetId: 1`,
  schema: SpreadsheetSheetSchema,
});

/**
 * Map simplified theme to actual TableTheme value
 */
const mapTableTheme = (
  theme: "none" | "light" | "medium" | "dark" | undefined,
): TableTheme | undefined => {
  switch (theme) {
    case "none":
      return "None";
    case "light":
      return "TableStyleLight9";
    case "medium":
      return "TableStyleMedium2";
    case "dark":
      return "TableStyleDark1";
    default:
      return undefined;
  }
};

/**
 * Map simplified stacked type to library stacked type
 */
const mapStackedType = (
  stackedType: "stacked" | "percentStacked" | "unstacked" | undefined,
): "STACKED" | "PERCENT_STACKED" | "UNSTACKED" | undefined => {
  switch (stackedType) {
    case "stacked":
      return "STACKED";
    case "percentStacked":
      return "PERCENT_STACKED";
    case "unstacked":
      return "UNSTACKED";
    default:
      return undefined;
  }
};

/**
 * Map simplified validation type + operator to ConditionType
 */
const mapValidationCondition = (
  validationType: string,
  operator?: string,
): ConditionType => {
  if (validationType === "list") {
    return "ONE_OF_LIST";
  }
  if (validationType === "custom") {
    return "CUSTOM_FORMULA";
  }

  // Number/wholeNumber validation
  if (validationType === "number" || validationType === "wholeNumber") {
    switch (operator) {
      case "equal":
        return "NUMBER_EQ";
      case "notEqual":
        return "NUMBER_NOT_EQ";
      case "greaterThan":
        return "NUMBER_GREATER";
      case "greaterThanOrEqual":
        return "NUMBER_GREATER_THAN_EQ";
      case "lessThan":
        return "NUMBER_LESS";
      case "lessThanOrEqual":
        return "NUMBER_LESS_THAN_EQ";
      case "notBetween":
        return "NUMBER_NOT_BETWEEN";
      case "between":
      default:
        return "NUMBER_BETWEEN";
    }
  }

  // Date validation
  if (validationType === "date") {
    switch (operator) {
      case "equal":
        return "DATE_EQ";
      case "notEqual":
        return "DATE_NOT_EQ";
      case "before":
        return "DATE_BEFORE";
      case "onOrBefore":
        return "DATE_ON_OR_BEFORE";
      case "after":
        return "DATE_AFTER";
      case "onOrAfter":
        return "DATE_ON_OR_AFTER";
      case "notBetween":
        return "DATE_NOT_BETWEEN";
      case "between":
      default:
        return "DATE_BETWEEN";
    }
  }

  return "CUSTOM_FORMULA";
};

/**
 * Build condition values array from input
 */
const buildConditionValues = (
  input:
    | SpreadsheetCreateDataValidationInput
    | SpreadsheetUpdateDataValidationInput,
): Array<{ userEnteredValue: string }> | undefined => {
  const { validationType, listValues, listRange, customFormula } = input;

  if (validationType === "list") {
    if (listRange) {
      // Reference to a range
      return [{ userEnteredValue: `=${listRange}` }];
    }
    if (listValues && listValues.length > 0) {
      return [{ userEnteredValue: listValues.join(",") }];
    }
    return undefined;
  }

  if (validationType === "custom" && customFormula) {
    return [{ userEnteredValue: customFormula }];
  }

  if (validationType === "number" || validationType === "wholeNumber") {
    const values: Array<{ userEnteredValue: string }> = [];
    if (input.minValue !== undefined) {
      values.push({ userEnteredValue: String(input.minValue) });
    }
    if (input.maxValue !== undefined) {
      values.push({ userEnteredValue: String(input.maxValue) });
    }
    return values.length > 0 ? values : undefined;
  }

  if (validationType === "date") {
    const values: Array<{ userEnteredValue: string }> = [];
    if (input.minDate !== undefined) {
      values.push({ userEnteredValue: input.minDate });
    }
    if (input.maxDate !== undefined) {
      values.push({ userEnteredValue: input.maxDate });
    }
    return values.length > 0 ? values : undefined;
  }

  return undefined;
};

/**
 * Map simplified condition type to ConditionType for conditional formatting
 */
const mapConditionalFormatCondition = (
  conditionType: string,
): ConditionType => {
  switch (conditionType) {
    case "greaterThan":
      return "NUMBER_GREATER";
    case "greaterThanOrEqual":
      return "NUMBER_GREATER_THAN_EQ";
    case "lessThan":
      return "NUMBER_LESS";
    case "lessThanOrEqual":
      return "NUMBER_LESS_THAN_EQ";
    case "equal":
      return "NUMBER_EQ";
    case "notEqual":
      return "NUMBER_NOT_EQ";
    case "between":
      return "NUMBER_BETWEEN";
    case "notBetween":
      return "NUMBER_NOT_BETWEEN";
    case "textContains":
      return "TEXT_CONTAINS";
    case "textNotContains":
      return "TEXT_NOT_CONTAINS";
    case "textStartsWith":
      return "TEXT_STARTS_WITH";
    case "textEndsWith":
      return "TEXT_ENDS_WITH";
    case "blank":
      return "BLANK";
    case "notBlank":
      return "NOT_BLANK";
    case "custom":
      return "CUSTOM_FORMULA";
    default:
      return "CUSTOM_FORMULA";
  }
};

// ==================== CONSOLIDATED TOOLS ====================

/**
 * Consolidated handler for clearing cells (values, formatting, or both)
 */
const handleSpreadsheetClearCells = async (
  input: SpreadsheetClearCellsInput,
): Promise<string> => {
  const {
    docId,
    sheetId: inputSheetId,
    ranges,
    clearType = "contents",
  } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required", { field: "docId" });
  }

  if (!ranges || ranges.length === 0) {
    return failTool("MISSING_RANGES", "At least one range is required", {
      field: "ranges",
    });
  }

  const defaultSheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_clearCells] Starting:", {
      docId,
      sheetId: defaultSheetId,
      rangeCount: ranges.length,
      clearType,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);
        const processedRanges: string[] = [];
        const errors: Array<{ range: string; error: string }> = [];
        const modifiedSheetIds = new Set<number>();

        for (const rangeStr of ranges) {
          try {
            // Parse range with sheet name support
            const rangeParsed = parseRangeWithSheetName(
              rangeStr,
              spreadsheet,
              defaultSheetId,
            );
            if (!rangeParsed.selection?.range) {
              errors.push({
                range: rangeStr,
                error: rangeParsed.error || `Invalid range`,
              });
              continue;
            }

            const rangeSheetId = rangeParsed.sheetId;
            const activeCell = {
              rowIndex: rangeParsed.selection.range.startRowIndex,
              columnIndex: rangeParsed.selection.range.startColumnIndex,
            };
            const selections: SelectionArea[] = [
              { range: rangeParsed.selection.range },
            ];

            spreadsheet.deleteCells(
              rangeSheetId,
              activeCell,
              selections,
              clearType,
            );

            processedRanges.push(rangeStr);
          } catch (itemError) {
            errors.push({
              range: rangeStr,
              error: itemError instanceof Error ? itemError.message : "Failed",
            });
          }
        }

        // Evaluate formulas for all modified sheets if contents were cleared
        let formulaResults;
        if (
          (clearType === "contents" || clearType === "all") &&
          modifiedSheetIds.size > 0
        ) {
          // Evaluate formulas for the first modified sheet (most common case)
          const firstSheetId = Array.from(modifiedSheetIds)[0];
          formulaResults = await evaluateFormulas(firstSheetId, spreadsheet);
        }

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_clearCells] Completed:", {
          docId,
          sheetId: defaultSheetId,
          clearType,
          processedCount: processedRanges.length,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully cleared ${clearType} from ${processedRanges.length} range(s)`,
          processedRanges,
          ...(formulaResults ? { formulaResults } : {}),
          ...(errors.length > 0 ? { errors } : {}),
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_clearCells] Error:", error);
      return failTool(
        "CLEAR_CELLS_FAILED",
        error instanceof Error ? error.message : "Failed to clear cells",
      );
    }
  });
};

export const spreadsheetClearCellsTool = tool(handleSpreadsheetClearCells, {
  name: "spreadsheet_clearCells",
  description: `Clear cell contents, formatting, or both from specified ranges.

OVERVIEW:
This tool clears content and/or formatting from cells without deleting rows or columns. Use the clearType parameter to control what gets cleared.

CLEAR TYPE OPTIONS:
- clearType: "contents" (default): Clears values/formulas but preserves formatting
- clearType: "formats": Clears only formatting, preserves content
- clearType: "all": Clears both content and formatting

WHEN TO USE:
- Deleting data while preserving formatting (clearType: "contents")
- Resetting formatting while keeping values (clearType: "formats")
- Completely clearing ranges including both (clearType: "all")
- Removing unwanted formatting from imported data
- Preparing cells before writing new data

IMPORTANT:
- This clears cell contents, not the cells themselves (use delete rows/columns for structural changes)
- Cell values and formulas are removed when clearing "contents" or "all"
- Cell formatting (colors, borders, fonts, number formats) is removed when clearing "formats" or "all"

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (required)
- ranges: Array of A1 notation ranges (e.g., ['A1:B5', 'D3:F10'])
- clearType: 'contents' (default) | 'formats' | 'all'

EXAMPLES:

Example 1 — Clear contents only (keep formatting):
  sheetId: 1, ranges: ["A1:C10"], clearType: "contents"

Example 2 — Clear formatting only (keep values):
  sheetId: 1, ranges: ["A1:B5"], clearType: "formats"

Example 3 — Clear everything:
  sheetId: 1, ranges: ["A1:Z100"], clearType: "all"

Example 4 — Clear multiple ranges (default clearType):
  sheetId: 1, ranges: ["A1:B5", "D3:F10", "H1:H20"]`,
  schema: SpreadsheetClearCellsSchema,
});

/**
 * Consolidated handler for table operations (create/update/delete)
 */
const handleSpreadsheetTable = async (
  input: SpreadsheetTableInput,
): Promise<string> => {
  const { docId, sheetId, action, tableId, tableName, ...rest } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required", { field: "docId" });
  }

  if (action === "create") {
    // Forward to create logic
    const createInput: SpreadsheetCreateTableInput = {
      docId,
      sheetId,
      range: rest.range!,
      title: rest.title!,
      columns: rest.columns!,
      theme: rest.theme,
      headerRow: rest.headerRow,
      showRowStripes: rest.showRowStripes,
      showColumnStripes: rest.showColumnStripes,
      showFirstColumn: rest.showFirstColumn,
      showLastColumn: rest.showLastColumn,
      filterButton: rest.filterButton,
      bandedRange: rest.bandedRange ?? undefined,
    };

    if (!createInput.range) {
      return failTool("MISSING_RANGE", "range is required for create", {
        field: "range",
      });
    }
    if (!createInput.title) {
      return failTool("MISSING_TITLE", "title is required for create", {
        field: "title",
      });
    }
    if (!createInput.columns) {
      return failTool("MISSING_COLUMNS", "columns is required for create", {
        field: "columns",
      });
    }

    const newTableId = uuidString();

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data);

          // Parse range with sheet name support
          const rangeParsed = parseRangeWithSheetName(
            createInput.range,
            spreadsheet,
            sheetId,
          );
          if (!rangeParsed.selection?.range) {
            return failTool(
              "INVALID_RANGE",
              rangeParsed.error || `Invalid range: ${createInput.range}`,
            );
          }

          const resolvedSheetId = rangeParsed.sheetId;

          const tableSpec = {
            id: newTableId,
            title: createInput.title,
            sheetId: resolvedSheetId,
            columns: createInput.columns.map((col) => ({
              name: col.name,
              ...(col.formula ? { formula: col.formula } : {}),
              ...(col.filterButton !== undefined
                ? { filterButton: col.filterButton }
                : {}),
            })),
            headerRow: createInput.headerRow,
            showRowStripes: createInput.showRowStripes,
            showColumnStripes: createInput.showColumnStripes,
            showFirstColumn: createInput.showFirstColumn,
            showLastColumn: createInput.showLastColumn,
            filterButton: createInput.filterButton,
            ...(createInput.bandedRange
              ? { bandedRange: createInput.bandedRange }
              : {}),
          };

          const mappedTheme = mapTableTheme(createInput.theme);
          const activeCell = {
            rowIndex: rangeParsed.selection.range.startRowIndex,
            columnIndex: rangeParsed.selection.range.startColumnIndex,
          };
          const selections: SelectionArea[] = [
            { range: rangeParsed.selection.range },
          ];

          spreadsheet.createTable(
            resolvedSheetId,
            activeCell,
            selections,
            tableSpec as Partial<TableView>,
            mappedTheme as TableTheme | undefined,
            createInput.bandedRange as BandedDefinition | undefined,
          );

          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully created table "${createInput.title}"`,
            tableId: newTableId,
            tableName: createInput.title,
          });
        } finally {
          queueMicrotask(() => close());
        }
      } catch (error) {
        return failTool(
          "CREATE_TABLE_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "update") {
    if (!tableId && !tableName) {
      return failTool(
        "MISSING_TABLE_IDENTIFIER",
        "tableId or tableName required for update",
      );
    }

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data);
          const tables = spreadsheet.tables || [];
          const table = tables.find(
            (t) => t.id === tableId || t.title === tableName,
          );

          if (!table) {
            return failTool("TABLE_NOT_FOUND", `Table not found`);
          }

          const updateSpec: Record<string, unknown> = {};
          if (rest.title) updateSpec.title = rest.title;
          if (rest.theme) updateSpec.theme = mapTableTheme(rest.theme);
          if (rest.columns) {
            updateSpec.columns = rest.columns.map((col) => ({
              name: col.name,
              ...(col.formula ? { formula: col.formula } : {}),
              ...(col.filterButton !== undefined
                ? { filterButton: col.filterButton }
                : {}),
            }));
          }
          if (rest.headerRow !== undefined)
            updateSpec.headerRow = rest.headerRow;
          if (rest.showRowStripes !== undefined)
            updateSpec.showRowStripes = rest.showRowStripes;
          if (rest.showColumnStripes !== undefined)
            updateSpec.showColumnStripes = rest.showColumnStripes;
          if (rest.showFirstColumn !== undefined)
            updateSpec.showFirstColumn = rest.showFirstColumn;
          if (rest.showLastColumn !== undefined)
            updateSpec.showLastColumn = rest.showLastColumn;
          if (rest.filterButton !== undefined)
            updateSpec.filterButton = rest.filterButton;
          if (rest.bandedRange !== undefined)
            updateSpec.bandedRange = rest.bandedRange;

          spreadsheet.updateTable(sheetId, table.id, updateSpec);
          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully updated table`,
            tableId: table.id,
          });
        } finally {
          queueMicrotask(() => close());
        }
      } catch (error) {
        return failTool(
          "UPDATE_TABLE_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "delete") {
    if (!tableId) {
      return failTool("MISSING_TABLE_ID", "tableId is required for delete");
    }

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data);
          const tables = spreadsheet.tables || [];
          const table = tables.find(
            (t) => t.id === tableId && t.sheetId === sheetId,
          );

          if (!table) {
            return failTool("TABLE_NOT_FOUND", `Table not found`);
          }

          spreadsheet.removeTable(table);
          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully deleted table`,
            tableId,
          });
        } finally {
          queueMicrotask(() => close());
        }
      } catch (error) {
        return failTool(
          "DELETE_TABLE_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  return failTool("INVALID_ACTION", `Invalid action: ${action}`);
};

export const spreadsheetTableTool = tool(handleSpreadsheetTable, {
  name: "spreadsheet_table",
  description: `Create, update, or delete tables in the spreadsheet.

OVERVIEW:
This tool converts a cell range into a structured table with headers, optional styling, and filtering capabilities. Tables support structured references in formulas (e.g., TableName[Column]).

WHEN TO USE:
- Converting raw data into a formatted table
- Adding filter buttons to column headers
- Applying alternating row colors (banding)
- Creating calculated columns with formulas
- Updating table properties or deleting tables

ACTIONS:
- create: sheetId, range, title (unique), columns required
- update: sheetId, tableId or tableName required, plus properties to change
- delete: sheetId, tableId required

IMPORTANT:
- The first row of the range becomes the header row
- Table names must be unique within the workbook
- When showRowStripes is true, you MUST also provide bandedRange

PARAMETERS:
- range: A1 notation range (e.g., 'A1:D10')
- title: Table name (required for create, must be unique)
- columns: Column definitions [{name, formula?, filterButton?}]
- theme: 'none' | 'light' | 'medium' | 'dark'
- headerRow: Show header row (default: true)
- totalRow: Show totals row (default: false)
- showRowStripes: Enable alternating row colors (requires bandedRange)
- bandedRange: Color definitions for row/column banding

EXAMPLES:

Example 1 — Simple table:
  action: "create", sheetId: 1, range: "A1:C10", title: "SalesData", columns: [{name: "Product"}, {name: "Price"}, {name: "Quantity"}]

Example 2 — Table with calculated column:
  action: "create", sheetId: 1, range: "A1:D10", title: "Invoice", columns: [{name: "Item"}, {name: "Price"}, {name: "Qty"}, {name: "Total", formula: "=[Price]*[Qty]"}], theme: "medium"

Example 3 — Update table theme:
  action: "update", sheetId: 1, tableName: "Sales", theme: "dark"

Example 4 — Delete table:
  action: "delete", sheetId: 1, tableId: "tbl_123"`,
  schema: SpreadsheetTableSchema,
});

/**
 * Consolidated handler for chart operations (create/update/delete)
 */
/**
 * Parse a range string that may include a sheet name (e.g., "'Sheet1'!A1:B5" or "A1:B5")
 * Returns the parsed selection and the resolved sheetId
 */
const parseRangeWithSheetName = (
  range: string,
  spreadsheet: ReturnType<typeof createSpreadsheetInterface>,
  defaultSheetId: number,
): { selection: SelectionArea | null; sheetId: number; error?: string } => {
  const normalizedRange = range.startsWith("=") ? range : `=${range}`;
  const parsedSelections = generateSelectionsFromFormula(normalizedRange);
  const selection = parsedSelections[0];

  if (!selection?.range) {
    return {
      selection: null,
      sheetId: defaultSheetId,
      error: `Invalid range: ${range}`,
    };
  }

  let resolvedSheetId = defaultSheetId;

  if (selection.sheetName) {
    const sheetName = desanitizeSheetName(selection.sheetName);
    const targetSheet = spreadsheet.sheets.find((sheet) => {
      const title = (sheet as { title?: string }).title;
      const name = (sheet as { name?: string }).name;
      return title === sheetName || name === sheetName;
    });

    if (targetSheet) {
      resolvedSheetId = targetSheet.sheetId;
    }
  }

  return { selection: { range: selection.range }, sheetId: resolvedSheetId };
};

const getFirstChartSourceSheetId = (
  chart: Pick<EmbeddedChart, "spec">,
  kind: "domains" | "series",
) => {
  const spec = chart.spec as Record<string, unknown>;
  const groups = Array.isArray(spec[kind])
    ? (spec[kind] as Array<Record<string, unknown>>)
    : [];

  const firstGroup = groups[0];
  if (!firstGroup || !Array.isArray(firstGroup.sources)) {
    return undefined;
  }

  const firstSource = firstGroup.sources[0] as
    | Record<string, unknown>
    | undefined;
  if (!firstSource || typeof firstSource.sheetId !== "number") {
    return undefined;
  }

  return firstSource.sheetId;
};

export const resolveChartUpdateDefaultSheetIds = (
  chart: Pick<EmbeddedChart, "spec" | "position">,
  inputSheetId: number | undefined,
) => {
  const domainSourceSheetId = getFirstChartSourceSheetId(chart, "domains");
  const seriesSourceSheetId = getFirstChartSourceSheetId(chart, "series");
  const chartPositionSheetId = chart.position?.sheetId;

  return {
    domainSheetId:
      domainSourceSheetId ?? chartPositionSheetId ?? inputSheetId ?? 1,
    seriesSheetId:
      seriesSourceSheetId ??
      domainSourceSheetId ??
      chartPositionSheetId ??
      inputSheetId ??
      1,
  };
};

export const buildChartDomainsUpdate = (
  input: { sheetId: number; range: GridRange }[],
) =>
  input.map(({ sheetId, range }) => ({
    sources: [
      {
        sheetId,
        ...range,
      },
    ],
  }));

export const buildChartSeriesUpdate = (
  input: { sheetId: number; range: GridRange; dataLabel?: string }[],
) =>
  input.map(({ sheetId, range, dataLabel }) => ({
    sources: [
      {
        sheetId,
        ...range,
      },
    ],
    ...(dataLabel ? { dataLabel } : {}),
  }));

const parseChartSeriesInput = (seriesInput: {
  range: string;
  label?: string;
}) => {
  const dataLabel = seriesInput.label?.trim();
  return {
    range: seriesInput.range,
    dataLabel: dataLabel && dataLabel.length > 0 ? dataLabel : undefined,
  };
};

const handleSpreadsheetChart = async (
  input: SpreadsheetChartInput,
): Promise<string> => {
  const { docId, sheetId, action, chartId, ...rest } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required", { field: "docId" });
  }

  if (action === "create") {
    if (!sheetId) {
      return failTool("MISSING_SHEET_ID", "sheetId is required for create");
    }
    if (!rest.domain) {
      return failTool("MISSING_DOMAIN", "domain is required for create");
    }
    if (!rest.series || rest.series.length === 0) {
      return failTool("MISSING_SERIES", "series is required for create");
    }
    if (!rest.chartType) {
      return failTool("MISSING_CHART_TYPE", "chartType is required for create");
    }

    const newChartId = uuidString();

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data, false);

          // Parse domain range with potential sheet name
          const domainParsed = parseRangeWithSheetName(
            rest.domain!,
            spreadsheet,
            sheetId,
          );
          if (!domainParsed.selection?.range) {
            return failTool(
              "INVALID_DOMAIN",
              domainParsed.error || `Invalid domain range: ${rest.domain}`,
            );
          }

          // Parse series ranges with potential sheet names
          const seriesParsed = rest.series!.map((seriesInput) => {
            const parsedInput = parseChartSeriesInput(seriesInput);
            const parsed = parseRangeWithSheetName(
              parsedInput.range,
              spreadsheet,
              sheetId,
            );
            if (!parsed.selection?.range)
              throw new Error(
                parsed.error || `Invalid series range: ${parsedInput.range}`,
              );
            return {
              range: parsed.selection.range,
              sheetId: parsed.sheetId,
              dataLabel: parsedInput.dataLabel,
            };
          });

          // Build chart spec with proper structure (using sheetId from parsed ranges)
          const chartSpec: Partial<ChartSpec> = {
            chartType: rest.chartType as ChartSpec["chartType"],
            domains: [
              {
                sources: [
                  {
                    sheetId: domainParsed.sheetId,
                    ...domainParsed.selection.range,
                  },
                ],
              },
            ],
            series: buildChartSeriesUpdate(seriesParsed),
            ...(rest.title ? { title: rest.title } : {}),
            ...(rest.subtitle ? { subtitle: rest.subtitle } : {}),
            ...(rest.xAxisTitle
              ? { horizontalAxisTitle: rest.xAxisTitle }
              : {}),
            ...(rest.yAxisTitle ? { verticalAxisTitle: rest.yAxisTitle } : {}),
            ...(rest.stackedType
              ? { stackedType: mapStackedType(rest.stackedType) }
              : {}),
          };

          // Determine anchor position
          let anchorRowIndex = 1;
          let anchorColumnIndex =
            domainParsed.selection.range.endColumnIndex + 2;

          if (rest.anchorCell) {
            const anchorSel = addressToSelection(rest.anchorCell);
            if (anchorSel?.range) {
              anchorRowIndex = anchorSel.range.startRowIndex;
              anchorColumnIndex = anchorSel.range.startColumnIndex;
            }
          }

          const chart = {
            chartId: newChartId,
            spec: chartSpec,
            position: {
              sheetId,
              overlayPosition: {
                anchorCell: {
                  rowIndex: anchorRowIndex,
                  columnIndex: anchorColumnIndex,
                },
                widthPixels: rest.width ?? 400,
                heightPixels: rest.height ?? 300,
              },
            },
          } as EmbeddedChart;

          // createChart expects: sheetId, activeCell, selections, chartSpec
          const activeCell = {
            rowIndex: anchorRowIndex,
            columnIndex: anchorColumnIndex,
          };
          const selections: SelectionArea[] = [
            { range: domainParsed.selection.range },
          ];
          spreadsheet.createChart(sheetId, activeCell, selections, chart);
          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully created chart`,
            chartId: newChartId,
          });
        } finally {
          queueMicrotask(() => close());
        }
      } catch (error) {
        return failTool(
          "CREATE_CHART_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "update") {
    if (!chartId) {
      return failTool("MISSING_CHART_ID", "chartId is required for update");
    }

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data, false);
          const charts = spreadsheet.charts || [];
          const chart = charts.find((c) => String(c.chartId) === chartId);

          if (!chart) {
            return failTool("CHART_NOT_FOUND", `Chart not found`);
          }

          // Handle spec updates - using Record<string, unknown> for flexibility
          const specUpdates: Record<string, unknown> = {};
          if (rest.title !== undefined)
            specUpdates.title = rest.title ?? undefined;
          if (rest.subtitle !== undefined)
            specUpdates.subtitle = rest.subtitle ?? undefined;
          if (rest.chartType)
            specUpdates.chartType = rest.chartType.toUpperCase();
          if (rest.xAxisTitle !== undefined)
            specUpdates.horizontalAxisTitle = rest.xAxisTitle ?? undefined;
          if (rest.yAxisTitle !== undefined)
            specUpdates.verticalAxisTitle = rest.yAxisTitle ?? undefined;
          if (rest.stackedType)
            specUpdates.stackedType = mapStackedType(rest.stackedType);

          const { domainSheetId, seriesSheetId } =
            resolveChartUpdateDefaultSheetIds(chart, sheetId);

          if (rest.domain) {
            const domainParsed = parseRangeWithSheetName(
              rest.domain,
              spreadsheet,
              domainSheetId,
            );
            if (domainParsed.selection?.range) {
              specUpdates.domains = buildChartDomainsUpdate([
                {
                  sheetId: domainParsed.sheetId,
                  range: domainParsed.selection.range,
                },
              ]);
            }
          }

          if (rest.series) {
            specUpdates.series = rest.series.map((seriesInput) => {
              const parsedInput = parseChartSeriesInput(seriesInput);
              const parsed = parseRangeWithSheetName(
                parsedInput.range,
                spreadsheet,
                seriesSheetId,
              );
              if (!parsed.selection?.range)
                throw new Error(
                  parsed.error || `Invalid series range: ${parsedInput.range}`,
                );
              return buildChartSeriesUpdate([
                {
                  sheetId: parsed.sheetId,
                  range: parsed.selection.range,
                  dataLabel: parsedInput.dataLabel,
                },
              ])[0];
            });
          }

          const updates: Partial<EmbeddedChart> = {};
          if (Object.keys(specUpdates).length > 0) {
            updates.spec = { ...chart.spec, ...specUpdates } as ChartSpec;
          }

          // Handle position updates
          if (rest.anchorCell || rest.width || rest.height) {
            const currentPosition = chart.position?.overlayPosition;
            const newPosition: Record<string, unknown> = { ...currentPosition };

            if (rest.anchorCell) {
              const anchorSel = addressToSelection(rest.anchorCell);
              if (anchorSel?.range) {
                newPosition.anchorCell = {
                  rowIndex: anchorSel.range.startRowIndex,
                  columnIndex: anchorSel.range.startColumnIndex,
                };
              }
            }
            if (rest.width) newPosition.widthPixels = rest.width;
            if (rest.height) newPosition.heightPixels = rest.height;

            updates.position = {
              sheetId: sheetId ?? 1,
              overlayPosition: newPosition,
            } as EmbeddedChart["position"];
          }

          // updateChart expects the full chart object
          const updatedChart = { ...chart, ...updates } as EmbeddedChart;
          spreadsheet.updateChart(updatedChart);
          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully updated chart`,
            chartId,
          });
        } finally {
          queueMicrotask(() => close());
        }
      } catch (error) {
        return failTool(
          "UPDATE_CHART_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "delete") {
    if (!chartId) {
      return failTool("MISSING_CHART_ID", "chartId is required for delete");
    }

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data, false);
          const charts = spreadsheet.charts || [];
          const chart = charts.find((c) => String(c.chartId) === chartId);

          if (!chart) {
            return failTool("CHART_NOT_FOUND", `Chart not found`);
          }

          spreadsheet.deleteChart(chartId);
          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully deleted chart`,
            chartId,
          });
        } finally {
          queueMicrotask(() => close());
        }
      } catch (error) {
        return failTool(
          "DELETE_CHART_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  return failTool("INVALID_ACTION", `Invalid action: ${action}`);
};

export const spreadsheetChartTool = tool(handleSpreadsheetChart, {
  name: "spreadsheet_chart",
  description: `Create, update, or delete charts in the spreadsheet.

OVERVIEW:
This tool creates chart visualizations. You specify the domain (X-axis categories) and series (Y-axis data) explicitly.

WHEN TO USE:
- Creating bar, column, line, pie, or area charts
- Visualizing tabular data
- Updating chart titles, data ranges, or styling
- Removing existing charts

ACTIONS:
- create: sheetId, domain, series, chartType required
- update: chartId required, plus properties to change
- delete: chartId required

IMPORTANT - DATA RANGES:
- domain: Range for X-axis labels/categories (e.g., 'A2:A10'). Usually a single column. DO NOT include header row.
- series: Array of series objects (e.g., [{ range: 'B2:B10', label: 'Revenue' }, { range: 'C2:C10', label: 'Profit' }]). DO NOT include header rows.

CHART TYPES:
1. 'bar' - Horizontal bars
2. 'column' - Vertical bars (most common)
3. 'line' - Line chart with points
4. 'pie' - Circular pie chart
5. 'area' - Filled area chart
6. 'scatter' - XY scatter plot

PARAMETERS:
- domain: A1 notation range for X-axis categories, excluding header (required)
- series: Array of series objects ({ range, label }), excluding headers (required)
- chartType: Type of chart (required)
- title: Chart title
- subtitle: Chart subtitle
- anchorCell: Where to place chart (e.g., 'F1')
- width: Chart width in pixels (default: 400)
- height: Chart height in pixels (default: 300)
- stackedType: 'stacked' | 'percentStacked' | 'unstacked' (for bar/column/area, default: unstacked)
- xAxisTitle: Horizontal axis title
- yAxisTitle: Vertical axis title

EXAMPLES:

Given data in A1:C5:
  | Month | Sales | Profit |
  | Jan   | 100   | 20     |
  | Feb   | 150   | 35     |

Example 1 — Column chart with two series:
  action: "create", sheetId: 1, domain: "A2:A5", series: [{ range: "B2:B5", label: "Sales" }, { range: "C2:C5", label: "Profit" }], chartType: "column", title: "Monthly Performance"

Example 2 — Line chart with single series:
  action: "create", sheetId: 1, domain: "A2:A5", series: [{ range: "B2:B5", label: "Sales" }], chartType: "line", title: "Sales Trend", anchorCell: "E1"

Example 3 — Column chart with named series:
  action: "create", sheetId: 1, domain: "A2:A5", series: [{ range: "B2:B5", label: "Revenue" }, { range: "C2:C5", label: "Profit" }], chartType: "column", title: "Revenue vs Profit"

Example 4 — Update chart title:
  action: "update", chartId: "chart_123", title: "New Title"

Example 5 — Delete chart:
  action: "delete", chartId: "chart_123"`,
  schema: SpreadsheetChartSchema,
});

/**
 * Consolidated handler for data validation operations (create/update/delete/query)
 */
const handleSpreadsheetDataValidation = async (
  input: SpreadsheetDataValidationInput,
): Promise<string> => {
  const { docId, sheetId, action, validationId, ...rest } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required", { field: "docId" });
  }

  if (action === "query") {
    // Query validations
    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data, false);
          let validations = spreadsheet.dataValidations || [];

          // Filter by sheetId if provided - use type assertion
          if (sheetId) {
            validations = validations.filter(
              (v) => (v as Record<string, unknown>).sheetId === sheetId,
            );
          }

          // Filter by range if provided (supports sheet names)
          if (rest.range) {
            const filterParsed = parseRangeWithSheetName(
              rest.range,
              spreadsheet,
              sheetId ?? 1,
            );
            if (filterParsed.selection?.range) {
              validations = validations.filter((v) => {
                const vRange = v.ranges?.[0];
                if (!vRange) return false;
                // Also filter by sheetId if parsed from range
                const vSheetId = (v as Record<string, unknown>).sheetId;
                if (vSheetId !== filterParsed.sheetId) return false;
                return areaIntersects(filterParsed.selection!.range!, vRange);
              });
            }
          }

          // Format output - use type assertion for sheetId since it's stored at rule level
          const results = validations.map((v) => ({
            validationId: v.id,
            sheetId: (v as Record<string, unknown>).sheetId,
            ranges: v.ranges?.map((r) => selectionToAddress({ range: r })),
            condition: v.condition,
          }));

          return JSON.stringify({
            success: true,
            validations: results,
            count: results.length,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "QUERY_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "create") {
    if (!sheetId) {
      return failTool("MISSING_SHEET_ID", "sheetId is required for create");
    }
    if (!rest.range) {
      return failTool("MISSING_RANGE", "range is required for create");
    }
    if (!rest.validationType) {
      return failTool("MISSING_VALIDATION_TYPE", "validationType is required");
    }

    // Validate list type has values
    if (
      rest.validationType === "list" &&
      !rest.listValues?.length &&
      !rest.listRange
    ) {
      return failTool(
        "MISSING_LIST_VALUES",
        "listValues or listRange required for list type",
      );
    }

    const newValidationId = uuidString();

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data, false);

          // Parse range with sheet name support
          const rangeParsed = parseRangeWithSheetName(
            rest.range!,
            spreadsheet,
            sheetId,
          );
          if (!rangeParsed.selection?.range) {
            return failTool(
              "INVALID_RANGE",
              rangeParsed.error || `Invalid range: ${rest.range}`,
            );
          }

          const resolvedSheetId = rangeParsed.sheetId;

          const conditionType = mapValidationCondition(
            rest.validationType!,
            rest.numberOperator || rest.dateOperator,
          );

          const conditionValues = buildConditionValues({
            validationType: rest.validationType!,
            listValues: rest.listValues,
            listRange: rest.listRange,
            customFormula: rest.customFormula,
            minValue: rest.minValue,
            maxValue: rest.maxValue,
            minDate: rest.minDate,
            maxDate: rest.maxDate,
          } as SpreadsheetCreateDataValidationInput);

          const validationRule: DataValidationRuleRecord = {
            id: newValidationId,
            sheetId: resolvedSheetId,
            ranges: [
              {
                sheetId: resolvedSheetId,
                ...rangeParsed.selection.range,
              },
            ],
            condition: {
              type: conditionType,
              values: conditionValues,
            },
            strict:
              rest.errorStyle !== "warning" &&
              rest.errorStyle !== "information",
            showDropdown: rest.showDropdown ?? true,
            allowBlank: rest.allowBlank ?? true,
            inputMessage: rest.inputMessage
              ? {
                  message: rest.inputMessage,
                  title: rest.inputTitle ?? undefined,
                }
              : undefined,
            errorMessage: rest.errorMessage
              ? {
                  message: rest.errorMessage,
                  title: rest.errorTitle ?? undefined,
                }
              : undefined,
          } as DataValidationRuleRecord;

          spreadsheet.createDataValidationRule(validationRule);

          // trigger calc
          await spreadsheet.calculatePending();

          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully created data validation`,
            validationId: newValidationId,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "CREATE_VALIDATION_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "update") {
    if (!validationId) {
      return failTool(
        "MISSING_VALIDATION_ID",
        "validationId is required for update",
      );
    }
    if (!sheetId) {
      return failTool("MISSING_SHEET_ID", "sheetId is required for update");
    }

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data);
          const validations = spreadsheet.dataValidations || [];
          const validation = validations.find((v) => v.id === validationId);

          if (!validation) {
            return failTool("VALIDATION_NOT_FOUND", `Validation not found`);
          }

          const updates: Record<string, unknown> = {};

          if (rest.range) {
            // Parse range with sheet name support
            const rangeParsed = parseRangeWithSheetName(
              rest.range,
              spreadsheet,
              sheetId ?? 1,
            );
            if (rangeParsed.selection?.range) {
              updates.ranges = [
                {
                  sheetId: rangeParsed.sheetId,
                  ...rangeParsed.selection.range,
                },
              ];
            }
          }

          if (rest.validationType) {
            const conditionType = mapValidationCondition(
              rest.validationType,
              rest.numberOperator || rest.dateOperator,
            );
            const conditionValues = buildConditionValues({
              validationType: rest.validationType,
              listValues: rest.listValues,
              listRange: rest.listRange,
              customFormula: rest.customFormula,
              minValue: rest.minValue,
              maxValue: rest.maxValue,
              minDate: rest.minDate,
              maxDate: rest.maxDate,
            } as SpreadsheetCreateDataValidationInput);

            updates.condition = {
              type: conditionType,
              values: conditionValues,
            };
          }

          if (rest.showDropdown !== undefined)
            updates.showDropdown = rest.showDropdown;
          if (rest.allowBlank !== undefined)
            updates.allowBlank = rest.allowBlank;
          if (rest.errorStyle !== undefined) {
            updates.strict =
              rest.errorStyle !== "warning" &&
              rest.errorStyle !== "information";
          }
          if (
            rest.inputMessage !== undefined ||
            rest.inputTitle !== undefined
          ) {
            const existingInput = (validation as Record<string, unknown>)
              .inputMessage as { message?: string; title?: string } | undefined;
            updates.inputMessage = {
              message: rest.inputMessage ?? existingInput?.message ?? "",
              title: rest.inputTitle ?? existingInput?.title,
            };
          }
          if (
            rest.errorMessage !== undefined ||
            rest.errorTitle !== undefined
          ) {
            const existingError = (validation as Record<string, unknown>)
              .errorMessage as { message?: string; title?: string } | undefined;
            updates.errorMessage = {
              message: rest.errorMessage ?? existingError?.message ?? "",
              title: rest.errorTitle ?? existingError?.title,
            };
          }

          // updateDataValidationRule expects (updatedRule, previousRule)
          const updatedRule = {
            ...validation,
            ...updates,
          } as DataValidationRuleRecord;
          spreadsheet.updateDataValidationRule(updatedRule, validation);

          // trigger calc
          await spreadsheet.calculatePending();

          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully updated data validation`,
            validationId,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "UPDATE_VALIDATION_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "delete") {
    if (!validationId) {
      return failTool(
        "MISSING_VALIDATION_ID",
        "validationId is required for delete",
      );
    }
    if (!sheetId) {
      return failTool("MISSING_SHEET_ID", "sheetId is required for delete");
    }

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data);
          const validations = spreadsheet.dataValidations || [];
          const validation = validations.find((v) => v.id === validationId);

          if (!validation) {
            return failTool("VALIDATION_NOT_FOUND", `Validation not found`);
          }

          spreadsheet.deleteDataValidationRule(validation);

          // trigger calc
          await spreadsheet.calculatePending();

          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully deleted data validation`,
            validationId,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "DELETE_VALIDATION_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  return failTool("INVALID_ACTION", `Invalid action: ${action}`);
};

export const spreadsheetDataValidationTool = tool(
  handleSpreadsheetDataValidation,
  {
    name: "spreadsheet_dataValidation",
    description: `Create, update, delete, or query data validation rules.

OVERVIEW:
This tool adds input validation to cells, such as dropdown lists, number ranges, or custom formulas. Use action parameter for create/update/delete/query.

WHEN TO USE:
- Creating dropdown lists for user selection
- Restricting input to numbers, dates, or custom formulas
- Finding existing validation rules on a sheet
- Updating or removing existing validation rules

ACTIONS:
- create: sheetId, range, validationType required
- update: sheetId, validationId required, plus properties to change
- delete: sheetId, validationId required
- query: optional sheetId/range filters to find existing rules

VALIDATION TYPES:

1. LIST - Dropdown with predefined values:
   validationType: "list"
   listValues: ["Option1", "Option2", "Option3"]
   OR
   listRange: "Sheet2!A1:A10" (reference another range)

2. NUMBER - Numeric validation:
   validationType: "number" (decimals allowed) or "wholeNumber" (integers only)
   numberOperator: "between" | "notBetween" | "equal" | "notEqual" | "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual"
   minValue: 0
   maxValue: 100

3. DATE - Date validation:
   validationType: "date"
   dateOperator: "between" | "notBetween" | "equal" | "notEqual" | "before" | "onOrBefore" | "after" | "onOrAfter"
   minDate: "2024-01-01"
   maxDate: "2024-12-31"

4. CUSTOM - Formula-based validation:
   validationType: "custom"
   customFormula: "=A1>0" (must return TRUE for valid values)

COMMON OPTIONS:
- allowBlank: Allow empty cells (default: true)
- showDropdown: Show dropdown arrow for lists (default: true)
- errorStyle: "stop" (reject) | "warning" | "information"
- errorTitle/errorMessage: Custom error dialog
- inputTitle/inputMessage: Help text when cell is selected

IMPORTANT: Use EXACTLY the range the user specifies. If they say "E1", use "E1" - do NOT expand to "E1:E100".

EXAMPLES:

Example 1 — Dropdown for a single cell:
  action: "create", sheetId: 1, range: "E1", validationType: "list", listValues: ["Option1", "Option2"]

Example 2 — Dropdown for a column range:
  action: "create", sheetId: 1, range: "B2:B50", validationType: "list", listValues: ["Pending", "In Progress", "Done"]

Example 3 — Number validation between range:
  action: "create", sheetId: 1, range: "C5", validationType: "number", numberOperator: "between", minValue: 1, maxValue: 100

Example 4 — Date validation:
  action: "create", sheetId: 1, range: "D2:D50", validationType: "date", dateOperator: "between", minDate: "2024-01-01", maxDate: "2024-12-31"

Example 5 — Custom formula validation:
  action: "create", sheetId: 1, range: "A1:A10", validationType: "custom", customFormula: "=LEN(A1)<=50"

Example 6 — Query existing validations:
  action: "query", sheetId: 1

Example 7 — Update validation:
  action: "update", sheetId: 1, validationId: "val_123", listValues: ["New Option1", "New Option2"]

Example 8 — Delete validation:
  action: "delete", sheetId: 1, validationId: "val_123"`,
    schema: SpreadsheetDataValidationSchema,
  },
);

/**
 * Consolidated handler for conditional format operations (create/update/delete/query)
 */
type ConditionalFormatRuleType =
  | "condition"
  | "colorScale"
  | "topBottom"
  | "duplicates";

type ConditionalFormatCreatePayloadInput = {
  ruleType: ConditionalFormatRuleType;
  conditionType?: string;
  conditionValues?: Array<string | number>;
  customFormula?: string;
  colorScaleType?: "2color" | "3color";
  minColor?: string;
  midColor?: string;
  maxColor?: string;
  topBottomType?: "top" | "bottom";
  rank?: number;
  isPercent?: boolean;
  duplicateType?: "duplicate" | "unique";
  backgroundColor?: string;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
};

const buildConditionalFormatStyle = (
  input: Pick<
    ConditionalFormatCreatePayloadInput,
    "backgroundColor" | "textColor" | "bold" | "italic"
  >,
): CellFormat => {
  const format: CellFormat = {};
  if (input.backgroundColor) format.backgroundColor = input.backgroundColor;
  if (input.textColor) format.textFormat = { color: input.textColor };
  if (input.bold) format.textFormat = { ...format.textFormat, bold: true };
  if (input.italic) format.textFormat = { ...format.textFormat, italic: true };
  return format;
};

export const getConditionalFormatRuleType = (
  rule: Pick<
    ConditionalFormatRule,
    "gradientRule" | "topBottomRule" | "distinctRule"
  >,
): ConditionalFormatRuleType =>
  rule.gradientRule
    ? "colorScale"
    : rule.topBottomRule
      ? "topBottom"
      : rule.distinctRule
        ? "duplicates"
        : "condition";

export const buildConditionalFormatCreatePayload = (
  input: ConditionalFormatCreatePayloadInput,
): Pick<
  ConditionalFormatRule,
  "booleanRule" | "gradientRule" | "topBottomRule" | "distinctRule"
> => {
  const format = buildConditionalFormatStyle(input);

  if (input.ruleType === "colorScale") {
    return {
      gradientRule: {
        minpoint: {
          type: "MIN",
          color: input.minColor || "#FF0000",
        },
        maxpoint: {
          type: "MAX",
          color: input.maxColor || "#00FF00",
        },
        ...(input.colorScaleType === "3color" && input.midColor
          ? {
              midpoint: {
                type: "PERCENTILE",
                value: "50",
                color: input.midColor,
              },
            }
          : {}),
      },
    };
  }

  if (input.ruleType === "topBottom") {
    return {
      topBottomRule: {
        type: input.topBottomType === "bottom" ? "BOTTOM" : "TOP",
        rank: input.rank && input.rank > 0 ? input.rank : 10,
        isPercent: input.isPercent ?? false,
        format,
      },
    };
  }

  if (input.ruleType === "duplicates") {
    return {
      distinctRule: {
        type: input.duplicateType === "unique" ? "UNIQUE" : "DUPLICATE",
        format,
      },
    };
  }

  let condition: {
    type: ConditionType;
    values?: Array<{ userEnteredValue: string }>;
  };
  const conditionType = mapConditionalFormatCondition(
    input.conditionType || "greaterThan",
  );
  condition = {
    type: conditionType,
    values: input.conditionValues?.map((v) => ({
      userEnteredValue: String(v),
    })),
  };
  if (input.customFormula) {
    condition = {
      type: "CUSTOM_FORMULA",
      values: [{ userEnteredValue: input.customFormula }],
    };
  }

  return {
    booleanRule: {
      condition,
      format,
    },
  };
};

const handleSpreadsheetConditionalFormat = async (
  input: SpreadsheetConditionalFormatInput,
): Promise<string> => {
  const { docId, sheetId, action, ruleId, ...rest } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required", { field: "docId" });
  }

  if (action === "query") {
    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data);
          let rules = spreadsheet.conditionalFormats || [];

          if (sheetId) {
            rules = rules.filter(
              (r) => (r as Record<string, unknown>).sheetId === sheetId,
            );
          }

          if (rest.range) {
            // Parse range with sheet name support
            const filterParsed = parseRangeWithSheetName(
              rest.range,
              spreadsheet,
              sheetId ?? 1,
            );
            if (filterParsed.selection?.range) {
              rules = rules.filter((r) => {
                const rRange = r.ranges?.[0];
                if (!rRange) return false;
                // Also filter by sheetId if parsed from range
                const rSheetId = (r as Record<string, unknown>).sheetId;
                if (rSheetId !== filterParsed.sheetId) return false;
                return areaIntersects(filterParsed.selection!.range!, rRange);
              });
            }
          }

          const results = rules.map((r) => ({
            ruleId: r.id,
            sheetId: (r as Record<string, unknown>).sheetId,
            ranges: r.ranges?.map((range) => selectionToAddress({ range })),
            ruleType: getConditionalFormatRuleType(r),
            booleanRule: r.booleanRule,
            gradientRule: r.gradientRule,
            topBottomRule: r.topBottomRule,
            distinctRule: r.distinctRule,
            enabled: r.enabled,
          }));

          return JSON.stringify({
            success: true,
            conditionalFormats: results,
            count: results.length,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "QUERY_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "create") {
    if (!sheetId) {
      return failTool("MISSING_SHEET_ID", "sheetId is required for create");
    }
    if (!rest.range) {
      return failTool("MISSING_RANGE", "range is required for create");
    }
    const ruleType = rest.ruleType;
    if (!ruleType) {
      return failTool("MISSING_RULE_TYPE", "ruleType is required for create");
    }

    const newRuleId = uuidString();

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data);

          // Parse range with sheet name support
          const rangeParsed = parseRangeWithSheetName(
            rest.range!,
            spreadsheet,
            sheetId,
          );
          if (!rangeParsed.selection?.range) {
            return failTool(
              "INVALID_RANGE",
              rangeParsed.error || `Invalid range: ${rest.range}`,
            );
          }

          const resolvedSheetId = rangeParsed.sheetId;

          const rule = {
            id: newRuleId,
            sheetId: resolvedSheetId,
            ranges: [
              {
                sheetId: resolvedSheetId,
                ...rangeParsed.selection.range,
              },
            ],
            enabled: true,
          } as ConditionalFormatRule;

          Object.assign(
            rule,
            buildConditionalFormatCreatePayload({
              ruleType,
              conditionType: rest.conditionType,
              conditionValues: rest.conditionValues,
              customFormula: rest.customFormula,
              colorScaleType: rest.colorScaleType,
              minColor: rest.minColor,
              midColor: rest.midColor,
              maxColor: rest.maxColor,
              topBottomType: rest.topBottomType,
              rank: rest.rank,
              isPercent: rest.isPercent,
              duplicateType: rest.duplicateType,
              backgroundColor: rest.backgroundColor,
              textColor: rest.textColor,
              bold: rest.bold,
              italic: rest.italic,
            }),
          );

          spreadsheet.createConditionalFormattingRule(rule);

          // trigger calc
          await spreadsheet.calculatePending();

          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully created conditional format`,
            ruleId: newRuleId,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "CREATE_FORMAT_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "update") {
    if (!ruleId) {
      return failTool("MISSING_RULE_ID", "ruleId is required for update");
    }
    if (!sheetId) {
      return failTool("MISSING_SHEET_ID", "sheetId is required for update");
    }

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data);
          const rules = spreadsheet.conditionalFormats || [];
          const existingRule = rules.find((r) => r.id === ruleId);

          if (!existingRule) {
            return failTool("RULE_NOT_FOUND", `Rule not found`);
          }

          const updates: Record<string, unknown> = {};

          if (rest.range) {
            // Parse range with sheet name support
            const rangeParsed = parseRangeWithSheetName(
              rest.range,
              spreadsheet,
              sheetId ?? 1,
            );
            if (rangeParsed.selection?.range) {
              updates.ranges = [
                {
                  sheetId: rangeParsed.sheetId,
                  ...rangeParsed.selection.range,
                },
              ];
            }
          }

          if (rest.enabled !== undefined) updates.enabled = rest.enabled;

          // Update style payload based on the existing rule shape
          if (
            rest.backgroundColor ||
            rest.textColor ||
            rest.bold !== undefined ||
            rest.italic !== undefined
          ) {
            if (existingRule.booleanRule) {
              const format: CellFormat = {
                ...(existingRule.booleanRule.format || {}),
              };
              if (rest.backgroundColor)
                format.backgroundColor = rest.backgroundColor;
              if (rest.textColor)
                format.textFormat = {
                  ...format.textFormat,
                  color: rest.textColor,
                };
              if (rest.bold !== undefined)
                format.textFormat = { ...format.textFormat, bold: rest.bold };
              if (rest.italic !== undefined)
                format.textFormat = {
                  ...format.textFormat,
                  italic: rest.italic,
                };

              updates.booleanRule = {
                ...existingRule.booleanRule,
                format,
              };
            } else if (existingRule.topBottomRule) {
              const format: CellFormat = {
                ...(existingRule.topBottomRule.format || {}),
              };
              if (rest.backgroundColor)
                format.backgroundColor = rest.backgroundColor;
              if (rest.textColor)
                format.textFormat = {
                  ...format.textFormat,
                  color: rest.textColor,
                };
              if (rest.bold !== undefined)
                format.textFormat = { ...format.textFormat, bold: rest.bold };
              if (rest.italic !== undefined)
                format.textFormat = {
                  ...format.textFormat,
                  italic: rest.italic,
                };

              updates.topBottomRule = {
                ...existingRule.topBottomRule,
                format,
              };
            } else if (existingRule.distinctRule) {
              const format: CellFormat = {
                ...(existingRule.distinctRule.format || {}),
              };
              if (rest.backgroundColor)
                format.backgroundColor = rest.backgroundColor;
              if (rest.textColor)
                format.textFormat = {
                  ...format.textFormat,
                  color: rest.textColor,
                };
              if (rest.bold !== undefined)
                format.textFormat = { ...format.textFormat, bold: rest.bold };
              if (rest.italic !== undefined)
                format.textFormat = {
                  ...format.textFormat,
                  italic: rest.italic,
                };

              updates.distinctRule = {
                ...existingRule.distinctRule,
                format,
              };
            }
          }

          // Update top/bottom fields
          if (
            existingRule.topBottomRule &&
            (rest.topBottomType ||
              rest.rank !== undefined ||
              rest.isPercent !== undefined)
          ) {
            updates.topBottomRule = {
              ...(updates.topBottomRule as Record<string, unknown>),
              ...existingRule.topBottomRule,
              ...(rest.topBottomType
                ? { type: rest.topBottomType === "bottom" ? "BOTTOM" : "TOP" }
                : {}),
              ...(rest.rank !== undefined
                ? { rank: rest.rank > 0 ? rest.rank : 1 }
                : {}),
              ...(rest.isPercent !== undefined
                ? { isPercent: rest.isPercent }
                : {}),
            };
          }

          // Update duplicate/unique selector
          if (existingRule.distinctRule && rest.duplicateType) {
            updates.distinctRule = {
              ...(updates.distinctRule as Record<string, unknown>),
              ...existingRule.distinctRule,
              type: rest.duplicateType === "unique" ? "UNIQUE" : "DUPLICATE",
            };
          }

          // Update boolean condition-specific fields
          if (
            existingRule.booleanRule &&
            (rest.conditionType || rest.conditionValues || rest.customFormula)
          ) {
            const conditionType = mapConditionalFormatCondition(
              rest.conditionType || "greaterThan",
            );
            let condition: {
              type: string;
              values?: Array<{ userEnteredValue: string }>;
            } = {
              type: conditionType,
              values: rest.conditionValues?.map((v) => ({
                userEnteredValue: String(v),
              })),
            };
            if (rest.customFormula) {
              condition = {
                type: "CUSTOM_FORMULA",
                values: [{ userEnteredValue: rest.customFormula }],
              };
            }
            updates.booleanRule = {
              ...(updates.booleanRule as Record<string, unknown>),
              ...existingRule.booleanRule,
              condition,
            };
          }

          // updateConditionalFormattingRule expects (updatedRule, previousRule)
          const updatedRule = {
            ...existingRule,
            ...updates,
          } as ConditionalFormatRule;
          spreadsheet.updateConditionalFormattingRule(
            updatedRule,
            existingRule,
          );

          // trigger calc
          await spreadsheet.calculatePending();

          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully updated conditional format`,
            ruleId,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "UPDATE_FORMAT_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  if (action === "delete") {
    if (!ruleId) {
      return failTool("MISSING_RULE_ID", "ruleId is required for delete");
    }
    if (!sheetId) {
      return failTool("MISSING_SHEET_ID", "sheetId is required for delete");
    }

    return withDocumentWriteLock(docId, async () => {
      try {
        const { doc, close } = await getShareDBDocument(docId);

        try {
          const data = doc.data as ShareDBSpreadsheetDoc | null;
          if (!data)
            return failTool("NO_DOCUMENT_DATA", "Document has no data");

          const spreadsheet = createSpreadsheetInterface(data);
          const rules = spreadsheet.conditionalFormats || [];
          const rule = rules.find((r) => r.id === ruleId);

          if (!rule) {
            return failTool("RULE_NOT_FOUND", `Rule not found`);
          }

          spreadsheet.deleteConditionalFormattingRule(rule);

          // trigger calc
          await spreadsheet.calculatePending();

          await persistSpreadsheetPatches(doc, spreadsheet);

          return JSON.stringify({
            success: true,
            message: `Successfully deleted conditional format`,
            ruleId,
          });
        } finally {
          close();
        }
      } catch (error) {
        return failTool(
          "DELETE_FORMAT_FAILED",
          error instanceof Error ? error.message : "Failed",
        );
      }
    });
  }

  return failTool("INVALID_ACTION", `Invalid action: ${action}`);
};

export const spreadsheetConditionalFormatTool = tool(
  handleSpreadsheetConditionalFormat,
  {
    name: "spreadsheet_conditionalFormat",
    description: `Create, update, delete, or query conditional formatting rules.

OVERVIEW:
This tool applies visual formatting based on cell values or conditions. Use action parameter to create/update/delete/query rules.

WHEN TO USE:
- Highlighting cells based on value conditions (>, <, =, between, etc.)
- Applying color scales/heatmaps to numeric data
- Highlighting top/bottom N values or percentages
- Highlighting duplicate or unique values
- Updating or removing existing conditional format rules

ACTIONS:
- create: sheetId, range, ruleType required
- update: sheetId, ruleId required, plus properties to change
- delete: sheetId, ruleId required
- query: optional sheetId/range filters to find existing rules

RULE TYPES:

1. CONDITION - Format cells based on value conditions:
   ruleType: "condition"
   conditionType: "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual" | "equal" | "notEqual" | "between" | "notBetween" | "textContains" | "textNotContains" | "textStartsWith" | "textEndsWith" | "blank" | "notBlank" | "custom"
   conditionValues: [50] or [10, 90] for between/notBetween
   customFormula: "=A1>B1" (for custom type only)
   backgroundColor: "#FFCCCC"
   textColor: "#FF0000"
   bold: true/false
   italic: true/false

2. COLOR SCALE - Gradient colors based on values:
   ruleType: "colorScale"
   colorScaleType: "2color" or "3color"
   minColor: "#FF0000" (red for low values)
   midColor: "#FFFF00" (yellow for mid, only for 3color)
   maxColor: "#00FF00" (green for high values)

3. TOP/BOTTOM - Highlight top or bottom values:
   ruleType: "topBottom"
   topBottomType: "top" or "bottom"
   rank: 10 (number of items)
   isPercent: true (top 10%) or false (top 10 items)
   backgroundColor/textColor/bold/italic for format

4. DUPLICATES - Highlight duplicate or unique values:
   ruleType: "duplicates"
   duplicateType: "duplicate" or "unique"
   backgroundColor/textColor/bold/italic for format

IMPORTANT: Use EXACTLY the range the user specifies.

EXAMPLES:

Example 1 — Highlight cells > 100 with red background:
  action: "create", sheetId: 1, range: "C2:C50", ruleType: "condition", conditionType: "greaterThan", conditionValues: [100], backgroundColor: "#FFCCCC"

Example 2 — 3-color scale (red → yellow → green):
  action: "create", sheetId: 1, range: "D2:D50", ruleType: "colorScale", colorScaleType: "3color", minColor: "#FF0000", midColor: "#FFFF00", maxColor: "#00FF00"

Example 3 — Highlight top 10%:
  action: "create", sheetId: 1, range: "E2:E50", ruleType: "topBottom", topBottomType: "top", rank: 10, isPercent: true, backgroundColor: "#90EE90"

Example 4 — Highlight duplicates:
  action: "create", sheetId: 1, range: "A2:A100", ruleType: "duplicates", duplicateType: "duplicate", backgroundColor: "#FFB6C1"

Example 5 — Custom formula (highlight if A > B):
  action: "create", sheetId: 1, range: "A1:A100", ruleType: "condition", conditionType: "custom", customFormula: "=A1>B1", backgroundColor: "#FFFFCC"

Example 6 — Query existing rules:
  action: "query", sheetId: 1

Example 7 — Update rule format:
  action: "update", sheetId: 1, ruleId: "xyz789", backgroundColor: "#CCCCFF"

Example 8 — Delete rule:
  action: "delete", sheetId: 1, ruleId: "xyz789"`,
    schema: SpreadsheetConditionalFormatSchema,
  },
);

/**
 * Handler for spreadsheet_getAuditSnapshot tool
 * Collects comprehensive data for deep audit analysis
 */
const handleSpreadsheetGetAuditSnapshot = async (
  input: SpreadsheetGetAuditSnapshotInput,
): Promise<string> => {
  const { docId, sheetId: targetSheetId } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required", { field: "docId" });
  }

  console.log("[spreadsheet_getAuditSnapshot] Starting:", {
    docId,
    sheetId: targetSheetId,
  });

  try {
    const { doc, close } = await getShareDBDocument(docId);

    try {
      const data = doc.data as ShareDBSpreadsheetDoc | null;

      if (!data) {
        return failTool("NO_DOCUMENT_DATA", "Document has no data");
      }

      const spreadsheet = createSpreadsheetInterface(data, true);
      const cellXfs = spreadsheet.cellXfs;

      // Determine which sheets to audit
      const sheetsToAudit = targetSheetId
        ? spreadsheet.sheets.filter((s) => s.sheetId === targetSheetId)
        : spreadsheet.sheets;

      if (sheetsToAudit.length === 0) {
        return failTool(
          "SHEET_NOT_FOUND",
          `Sheet with ID ${targetSheetId} not found`,
        );
      }

      const auditSheets: Array<Record<string, unknown>> = [];

      for (const sheetInfo of sheetsToAudit) {
        const sheetId = sheetInfo.sheetId;
        const sheetTitle =
          (sheetInfo as { title?: string }).title ||
          (sheetInfo as { name?: string }).name ||
          `Sheet${sheetId}`;
        const sheetData = spreadsheet.sheetData[sheetId];
        const sheet = spreadsheet.sheets.find((s) => s.sheetId === sheetId) as
          | Sheet
          | undefined;

        // Calculate data bounds
        let maxRow = 0;
        let maxCol = 0;
        if (sheetData) {
          for (const rowIndexStr of Object.keys(sheetData)) {
            const rowIndex = parseInt(rowIndexStr, 10);
            if (isNaN(rowIndex)) continue;
            const rowData = sheetData[rowIndex];
            if (!rowData?.values) continue;
            for (const colIndexStr of Object.keys(rowData.values)) {
              const colIndex = parseInt(colIndexStr, 10);
              if (isNaN(colIndex)) continue;
              if (rowData.values[colIndex]) {
                maxRow = Math.max(maxRow, rowIndex);
                maxCol = Math.max(maxCol, colIndex);
              }
            }
          }
        }

        const usedRange =
          maxRow > 0 && maxCol > 0
            ? `A1:${cellToAddress({ rowIndex: maxRow, columnIndex: maxCol })}`
            : "A1";

        // Collect hidden rows/columns
        const hiddenRows: number[] = [];
        const hiddenColumns: number[] = [];
        const rowMetadata = (sheet as Record<string, unknown>)?.rowMetadata as
          | DimensionProperties[]
          | undefined;
        const columnMetadata = (sheet as Record<string, unknown>)
          ?.columnMetadata as DimensionProperties[] | undefined;

        if (rowMetadata) {
          rowMetadata.forEach((meta, idx) => {
            if (meta?.hiddenByUser) hiddenRows.push(idx);
          });
        }
        if (columnMetadata) {
          columnMetadata.forEach((meta, idx) => {
            if (meta?.hiddenByUser) hiddenColumns.push(idx);
          });
        }

        // Collect merges
        const merges: string[] = [];
        const sheetMerges = (sheet as Record<string, unknown>)?.merges as
          | Array<GridRange>
          | undefined;
        if (sheetMerges) {
          for (const merge of sheetMerges) {
            const addr = selectionToAddress({ range: merge });
            if (addr) merges.push(addr);
          }
        }

        // Collect formulas with their results and detect errors
        const formulas: Array<{
          cell: string;
          formula: string;
          result: unknown;
          isError: boolean;
          errorType?: string;
        }> = [];

        // Collect formatting inventory
        const fontMap = new Map<string, string[]>();
        const numberFormatMap = new Map<string, string[]>();
        const backgroundMap = new Map<string, string[]>();
        const alignmentMap = new Map<string, string[]>();

        // Scan all cells
        if (sheetData) {
          for (let rowIndex = 1; rowIndex <= maxRow; rowIndex++) {
            const rowData = sheetData[rowIndex];
            if (!rowData?.values) continue;

            for (let columnIndex = 1; columnIndex <= maxCol; columnIndex++) {
              const cellData = rowData.values[columnIndex];
              if (!cellData) continue;

              const address = cellToAddress({ rowIndex, columnIndex });
              if (!address) continue;

              // Check for formula
              const ue = getCellUserEnteredValue(cellData);
              const formula = getExtendedValueFormula(ue);

              if (formula) {
                const effectiveValue = getCellEffectiveValue(cellData);
                const errorValue = getExtendedValueError(effectiveValue) as
                  | ErrorValue
                  | undefined
                  | null;
                const ev =
                  getExtendedValueBool(effectiveValue) ??
                  getExtendedValueNumber(effectiveValue) ??
                  getExtendedValueString(effectiveValue);

                // Detect formula errors
                const isError = errorValue?.type === "Error";
                let errorType: string | undefined;
                if (isError) {
                  errorType = `${errorValue.name}: ${errorValue.message}`;
                }

                formulas.push({
                  cell: address,
                  formula,
                  result: ev,
                  isError,
                  errorType,
                });
              }

              // Collect formatting
              const ef = getCellEffectiveFormat(cellData);
              const style = (ef as StyleReference)?.sid
                ? cellXfs.get(String((ef as StyleReference)?.sid))
                : ef;
              if (style && typeof style === "object") {
                const s = style as Record<string, unknown>;

                // Font
                const textFormat = s.textFormat as
                  | Record<string, unknown>
                  | undefined;
                if (textFormat) {
                  const fontKey = JSON.stringify({
                    family: textFormat.fontFamily,
                    size: textFormat.fontSize,
                    bold: textFormat.bold,
                    italic: textFormat.italic,
                  });
                  const existing = fontMap.get(fontKey) || [];
                  existing.push(address);
                  fontMap.set(fontKey, existing);
                }

                // Number format
                const numberFormat = s.numberFormat as
                  | Record<string, unknown>
                  | undefined;
                if (numberFormat?.pattern) {
                  const pattern = String(numberFormat.pattern);
                  const existing = numberFormatMap.get(pattern) || [];
                  existing.push(address);
                  numberFormatMap.set(pattern, existing);
                }

                // Background color
                const bgColor = s.backgroundColor as string | undefined;
                if (bgColor) {
                  const existing = backgroundMap.get(bgColor) || [];
                  existing.push(address);
                  backgroundMap.set(bgColor, existing);
                }

                // Alignment
                const hAlign = s.horizontalAlignment as string | undefined;
                const vAlign = s.verticalAlignment as string | undefined;
                if (hAlign || vAlign) {
                  const alignKey = `${hAlign || "default"}:${vAlign || "default"}`;
                  const existing = alignmentMap.get(alignKey) || [];
                  existing.push(address);
                  alignmentMap.set(alignKey, existing);
                }
              }
            }
          }
        }

        // Collect conditional formats for this sheet
        const conditionalFormats = (spreadsheet.conditionalFormats || [])
          .filter((r) => (r as Record<string, unknown>).sheetId === sheetId)
          .map((r) => ({
            ruleId: r.id,
            ranges: r.ranges?.map((range) => selectionToAddress({ range })),
            ruleType: r.gradientRule
              ? "colorScale"
              : r.topBottomRule
                ? "topBottom"
                : r.distinctRule
                  ? "duplicates"
                  : "condition",
            booleanRule: r.booleanRule,
            gradientRule: r.gradientRule,
            topBottomRule: r.topBottomRule,
            distinctRule: r.distinctRule,
            enabled: r.enabled,
          }));

        // Collect data validations for this sheet
        const dataValidations = (spreadsheet.dataValidations || [])
          .filter((v) => (v as Record<string, unknown>).sheetId === sheetId)
          .map((v) => ({
            validationId: v.id,
            ranges: v.ranges?.map((r) => selectionToAddress({ range: r })),
            condition: v.condition,
          }));

        // Collect charts for this sheet
        const charts = (spreadsheet.charts || [])
          .filter((c) => {
            const pos = (c as EmbeddedChart).position;
            return pos && pos.sheetId === sheetId;
          })
          .map((c) => {
            const chart = c as EmbeddedChart;
            const spec = chart.spec as Record<string, unknown> | undefined;

            // Convert domains to A1 notation
            const domainA1s: string[] = [];
            const domains = spec?.domains as
              | Array<{ sources?: Array<{ sheetId?: number }> }>
              | undefined;
            if (domains && Array.isArray(domains)) {
              for (const domain of domains) {
                if (domain.sources && Array.isArray(domain.sources)) {
                  for (const source of domain.sources) {
                    const { sheetId: sourceSheetId, ...range } = source as {
                      sheetId?: number;
                    };
                    const sourceSheetName = spreadsheet.sheets.find(
                      (s) => s.sheetId === sourceSheetId,
                    )?.title;
                    const a1 = selectionToAddress(
                      { range: range as GridRange },
                      sourceSheetName,
                    );
                    if (a1) domainA1s.push(a1);
                  }
                }
              }
            }

            // Convert series to A1 notation
            const seriesA1s: string[] = [];
            const series = spec?.series as
              | Array<{ sources?: Array<{ sheetId?: number }> }>
              | undefined;
            if (series && Array.isArray(series)) {
              for (const s of series) {
                if (s.sources && Array.isArray(s.sources)) {
                  for (const source of s.sources) {
                    const { sheetId: sourceSheetId, ...range } = source as {
                      sheetId?: number;
                    };
                    const sourceSheetName = spreadsheet.sheets.find(
                      (sh) => sh.sheetId === sourceSheetId,
                    )?.title;
                    const a1 = selectionToAddress(
                      { range: range as GridRange },
                      sourceSheetName,
                    );
                    if (a1) seriesA1s.push(a1);
                  }
                }
              }
            }

            return {
              chartId: chart.chartId,
              type: spec?.chartType || "unknown",
              position: chart.position,
              ...(domainA1s.length > 0 ? { domains: domainA1s } : {}),
              ...(seriesA1s.length > 0 ? { series: seriesA1s } : {}),
            };
          });

        // Build formats summary (limit to avoid huge responses)
        const formatsSummary = {
          uniqueFonts: fontMap.size,
          fonts: Array.from(fontMap.entries())
            .slice(0, 10)
            .map(([key, cells]) => ({
              style: JSON.parse(key),
              cellCount: cells.length,
              ranges: compressA1CellsToRanges(cells),
            })),
          uniqueNumberFormats: numberFormatMap.size,
          numberFormats: Array.from(numberFormatMap.entries())
            .slice(0, 10)
            .map(([pattern, cells]) => ({
              pattern,
              cellCount: cells.length,
              ranges: compressA1CellsToRanges(cells),
            })),
          uniqueBackgrounds: backgroundMap.size,
          backgrounds: Array.from(backgroundMap.entries())
            .slice(0, 10)
            .map(([color, cells]) => ({
              color,
              cellCount: cells.length,
              ranges: compressA1CellsToRanges(cells),
            })),
          uniqueAlignments: alignmentMap.size,
          alignments: Array.from(alignmentMap.entries())
            .slice(0, 10)
            .map(([key, cells]) => {
              const [h, v] = key.split(":");
              return {
                horizontal: h,
                vertical: v,
                cellCount: cells.length,
                ranges: compressA1CellsToRanges(cells),
              };
            }),
        };

        // Separate errors from valid formulas
        const formulaErrors = formulas.filter((f) => f.isError);
        const validFormulas = formulas.filter((f) => !f.isError);

        auditSheets.push({
          sheetId,
          title: sheetTitle,
          structure: {
            usedRange,
            frozenRows: (sheet as Record<string, unknown>)?.frozenRowCount || 0,
            frozenColumns:
              (sheet as Record<string, unknown>)?.frozenColumnCount || 0,
            merges,
            hiddenRows,
            hiddenColumns,
            showGridLines:
              (sheet as Record<string, unknown>)?.showGridLines ?? true,
          },
          formulas: {
            total: formulas.length,
            errors: formulaErrors,
            errorCount: formulaErrors.length,
            // Include sample of valid formulas for pattern analysis
            sample: validFormulas.slice(0, 20),
          },
          formats: formatsSummary,
          conditionalFormats,
          dataValidations,
          charts,
        });
      }

      return JSON.stringify({
        success: true,
        sheets: auditSheets,
        summary: {
          totalSheets: auditSheets.length,
          totalFormulaErrors: auditSheets.reduce(
            (sum, s) =>
              sum +
              (((s.formulas as Record<string, unknown>)
                ?.errorCount as number) || 0),
            0,
          ),
          totalConditionalFormats: auditSheets.reduce(
            (sum, s) =>
              sum + ((s.conditionalFormats as unknown[])?.length || 0),
            0,
          ),
          totalDataValidations: auditSheets.reduce(
            (sum, s) => sum + ((s.dataValidations as unknown[])?.length || 0),
            0,
          ),
        },
      });
    } finally {
      close();
    }
  } catch (error) {
    console.error("[spreadsheet_getAuditSnapshot] Error:", error);
    return failTool(
      "AUDIT_FAILED",
      error instanceof Error ? error.message : "Failed to get audit snapshot",
    );
  }
};

export const spreadsheetGetAuditSnapshotTool = tool(
  handleSpreadsheetGetAuditSnapshot,
  {
    name: "spreadsheet_getAuditSnapshot",
    description: `Collect comprehensive audit data from a spreadsheet for deep analysis.

OVERVIEW:
This tool gathers all data needed to perform a thorough audit of a spreadsheet, including formulas, formatting patterns, conditional formats, data validations, and structural information.

WHEN TO USE:
- When performing a "deep audit" of a spreadsheet
- Before suggesting fixes for formula errors or formatting inconsistencies
- To understand the overall health and structure of a workbook

RETURNS:
For each sheet, returns:
- structure: usedRange, frozen rows/cols, merges, hidden rows/cols, gridlines
- formulas: all formulas with their results, error detection (errors separated)
- formats: inventory of unique fonts, number formats, backgrounds, alignments
- conditionalFormats: all conditional formatting rules
- dataValidations: all data validation rules
- charts: embedded charts

The summary includes total error counts across all sheets.

EXAMPLES:

Example 1 — Audit entire workbook:
  docId: "abc123"

Example 2 — Audit specific sheet:
  docId: "abc123"
  sheetId: 1`,
    schema: SpreadsheetGetAuditSnapshotSchema,
  },
);

const webSearchSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe("Search query text describing what to find on the web."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Maximum number of source links to return (default: 5)."),
  includeDomains: z
    .array(z.string())
    .optional()
    .describe(
      "Optional domain allowlist. Example: ['sec.gov', 'investor.apple.com']",
    ),
  excludeDomains: z
    .array(z.string())
    .optional()
    .describe("Optional domain blocklist to exclude from results."),
});

type WebSearchInput = z.infer<typeof webSearchSchema>;

type OpenAIResponsesOutputTextAnnotation = {
  type?: string;
  title?: string;
  url?: string;
};

type OpenAIResponsesOutputTextPart = {
  type?: string;
  text?: string;
  annotations?: OpenAIResponsesOutputTextAnnotation[];
};

type OpenAIResponsesOutputItem = {
  type?: string;
  content?: OpenAIResponsesOutputTextPart[];
};

type OpenAIResponsesPayload = {
  output_text?: string;
  output?: OpenAIResponsesOutputItem[];
};

type WebSearchSnippet = {
  text: string;
  citationUrls: string[];
};

const handleWebSearch = async (input: WebSearchInput): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return failTool(
      "MISSING_OPENAI_API_KEY",
      "OPENAI_API_KEY is not configured, so web search cannot run.",
      undefined,
      false,
    );
  }

  const maxResults = input.maxResults ?? 5;
  const model = process.env.OPENAI_WEBSEARCH_MODEL?.trim() || "gpt-4.1-mini";

  const instructions: string[] = [
    `Find up-to-date information for this query: ${input.query}`,
  ];

  if ((input.includeDomains?.length ?? 0) > 0) {
    instructions.push(
      `Prefer and limit results to these domains when possible: ${input.includeDomains!.join(", ")}`,
    );
  }

  if ((input.excludeDomains?.length ?? 0) > 0) {
    instructions.push(
      `Exclude these domains: ${input.excludeDomains!.join(", ")}`,
    );
  }

  instructions.push(
    "Return a concise factual answer and include source citations.",
  );

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        tools: [{ type: "web_search_preview" }],
        input: instructions.join("\n"),
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      return failTool(
        "WEB_SEARCH_REQUEST_FAILED",
        `Web search request failed with status ${response.status}.`,
        {
          status: response.status,
          statusText: response.statusText,
          responseBody: responseText.slice(0, 1200),
        },
      );
    }

    const payload = (await response.json()) as OpenAIResponsesPayload;
    const outputText =
      typeof payload.output_text === "string" ? payload.output_text : "";

    const sourceMap = new Map<
      string,
      { url: string; title: string | null; domain: string }
    >();
    const snippets: WebSearchSnippet[] = [];
    const outputItems = Array.isArray(payload.output) ? payload.output : [];
    const textSegments: string[] = [];

    for (const item of outputItems) {
      const contentParts = Array.isArray(item.content) ? item.content : [];
      for (const part of contentParts) {
        const partText =
          typeof part.text === "string" ? part.text.trim() : undefined;
        const partCitationUrls: string[] = [];
        const annotations = Array.isArray(part.annotations)
          ? part.annotations
          : [];

        for (const annotation of annotations) {
          const url =
            annotation.type === "url_citation" &&
            typeof annotation.url === "string"
              ? annotation.url
              : null;
          if (!url || sourceMap.has(url)) {
            continue;
          }

          sourceMap.set(url, {
            url,
            title:
              typeof annotation.title === "string" ? annotation.title : null,
            domain: getHostname(url),
          });
          partCitationUrls.push(url);
        }

        if (partText && partText.length > 0) {
          textSegments.push(partText);
          snippets.push({
            text: partText,
            citationUrls: Array.from(new Set(partCitationUrls)),
          });
        }
      }
    }

    const sources = Array.from(sourceMap.values()).slice(0, maxResults);
    const synthesizedAnswer =
      outputText.trim().length > 0
        ? outputText.trim()
        : textSegments.join("\n\n").trim();

    return JSON.stringify({
      success: true,
      query: input.query,
      answer: synthesizedAnswer.length > 0 ? synthesizedAnswer : null,
      sourceCount: sources.length,
      sources,
      snippets: snippets.slice(0, 8),
    });
  } catch (error) {
    return failTool(
      "WEB_SEARCH_FAILED",
      error instanceof Error ? error.message : "Web search failed.",
    );
  }
};

export const webSearchTool = tool(handleWebSearch, {
  name: "web_search",
  description: `Search the public web and return a concise answer with citations.

Use this for current information, facts, or references that require internet access.
Supports optional include/exclude domain filtering.`,
  schema: webSearchSchema,
});

const askUserQuestionSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z
          .string()
          .min(1)
          .describe("Question text shown to the user."),
        header: z
          .string()
          .min(1)
          .describe("Short section header for the question."),
        options: z
          .array(
            z.object({
              label: z.string().min(1).describe("Option label"),
              description: z
                .string()
                .min(1)
                .describe("One-sentence option explanation"),
            }),
          )
          .min(1)
          .max(8)
          .describe("Available choices for this question."),
        multiSelect: z
          .boolean()
          .optional()
          .describe("Whether multiple options can be selected."),
      }),
    )
    .min(1)
    .max(5)
    .describe("One or more user questions to collect structured answers."),
});

type AskUserQuestionInput = z.infer<typeof askUserQuestionSchema>;

const handleAskUserQuestion = async (
  input: AskUserQuestionInput,
): Promise<string> => {
  return JSON.stringify({
    success: true,
    pendingUserInput: true,
    questions: input.questions.map((question) => ({
      ...question,
      multiSelect: question.multiSelect === true,
    })),
    message: "Waiting for user answers via tool UI.",
  });
};

export const askUserQuestionTool = tool(handleAskUserQuestion, {
  name: "assistant_askUserQuestion",
  description: `Ask one or more structured multiple-choice questions to the user.

Use this when you need user preferences or assumptions before proceeding.
The UI will render options and return the user's selections back to the model.`,
  schema: askUserQuestionSchema,
});

const confirmPlanExecutionSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe("Short plan title shown to the user."),
  summary: z
    .string()
    .min(1)
    .max(1500)
    .describe("Plain-language summary of what will be executed."),
  steps: z
    .array(z.string().min(1))
    .min(1)
    .max(12)
    .describe(
      'Array of plan steps. Example: ["Create headers in row 1", "Add sample data rows", "Apply formatting"]',
    ),
  risks: z
    .array(z.string().min(1))
    .max(8)
    .optional()
    .describe(
      'Optional array of actual downside risks only. Example: ["May overwrite existing data", "Requires write access"]. Do not include safety assurances like "Sheet is blank, so no data will be overwritten".',
    ),
  reason: z
    .string()
    .min(1)
    .max(600)
    .optional()
    .describe(
      "Optional reason why confirmation is needed before applying changes.",
    ),
});

type ConfirmPlanExecutionInput = z.infer<typeof confirmPlanExecutionSchema>;

const handleConfirmPlanExecution = async (
  input: ConfirmPlanExecutionInput,
): Promise<string> => {
  return JSON.stringify({
    success: true,
    pendingUserInput: true,
    title: input.title.trim(),
    summary: input.summary.trim(),
    steps: input.steps.map((step) => step.trim()).filter(Boolean),
    risks: Array.isArray(input.risks)
      ? input.risks.map((risk) => risk.trim()).filter(Boolean)
      : [],
    reason:
      typeof input.reason === "string" && input.reason.trim().length > 0
        ? input.reason.trim()
        : null,
    message: "Waiting for user decision before applying this plan.",
  });
};

export const confirmPlanExecutionTool = tool(handleConfirmPlanExecution, {
  name: "assistant_confirmPlanExecution",
  description: `Ask the user to review and approve a plan before applying changes.

Use this when the action is high-impact, destructive, expensive, or ambiguous.
The UI will show the plan and return approval or requested changes.`,
  schema: confirmPlanExecutionSchema,
});

/**
 * All available tools for the spreadsheet assistant
 */
export const spreadsheetTools = [
  spreadsheetChangeBatchTool,
  spreadsheetFormatRangeTool,
  spreadsheetModifyRowsColsTool,
  spreadsheetQueryRangeTool,
  spreadsheetSetIterativeModeTool,
  spreadsheetReadDocumentTool,
  spreadsheetGetRowColMetadataTool,
  spreadsheetSetRowColDimensionsTool,
  spreadsheetApplyFillTool,
  // Consolidated tools
  spreadsheetNoteTool,
  spreadsheetNamedRangeTool,
  spreadsheetClearCellsTool,
  spreadsheetTableTool,
  spreadsheetChartTool,
  spreadsheetDataValidationTool,
  spreadsheetConditionalFormatTool,
  spreadsheetSheetTool,
  // Audit tools
  spreadsheetGetAuditSnapshotTool,
  // Internet tools
  webSearchTool,
  // Interactive tools
  askUserQuestionTool,
  confirmPlanExecutionTool,
];
