import { tool } from "@langchain/core/tools";
import {
  addressToSelection,
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
  getExtendedValueString,
  isNil,
  uuidString,
} from "@rowsncolumns/utils";

import {
  type CellData,
  type CellFormatType,
  type CellStyleData,
  type SpreadsheetApplyFillInput,
  SpreadsheetApplyFillSchema,
  type SpreadsheetChangeBatchInput,
  SpreadsheetChangeBatchSchema,
  type SpreadsheetClearFormattingInput,
  SpreadsheetClearFormattingSchema,
  type SpreadsheetCreateSheetInput,
  SpreadsheetCreateSheetSchema,
  type SpreadsheetDeleteCellsInput,
  SpreadsheetDeleteCellsSchema,
  type SpreadsheetDeleteColumnsInput,
  SpreadsheetDeleteColumnsSchema,
  type SpreadsheetDeleteRowsInput,
  SpreadsheetDeleteRowsSchema,
  type SpreadsheetDuplicateSheetInput,
  SpreadsheetDuplicateSheetSchema,
  type SpreadsheetFormatRangeInput,
  SpreadsheetFormatRangeSchema,
  type SpreadsheetInsertColumnsInput,
  SpreadsheetInsertColumnsSchema,
  type SpreadsheetInsertNoteInput,
  SpreadsheetInsertNoteSchema,
  type SpreadsheetInsertRowsInput,
  SpreadsheetInsertRowsSchema,
  type SpreadsheetQueryRangeInput,
  SpreadsheetQueryRangeSchema,
  type SpreadsheetSetIterativeModeInput,
  SpreadsheetSetIterativeModeSchema,
  type SpreadsheetUpdateSheetInput,
  SpreadsheetUpdateSheetSchema,
  type SpreadsheetReadDocumentInput,
  SpreadsheetReadDocumentSchema,
  type SpreadsheetSetRowColDimensionsInput,
  SpreadsheetSetRowColDimensionsSchema,
  type SpreadsheetCreateTableInput,
  SpreadsheetCreateTableSchema,
  type SpreadsheetUpdateTableInput,
  SpreadsheetUpdateTableSchema,
  type SpreadsheetCreateChartInput,
  SpreadsheetCreateChartSchema,
  type SpreadsheetUpdateChartInput,
  SpreadsheetUpdateChartSchema,
  type SpreadsheetDeleteSheetInput,
  SpreadsheetDeleteSheetSchema,
  type SpreadsheetDeleteChartInput,
  SpreadsheetDeleteChartSchema,
  type SpreadsheetDeleteTableInput,
  SpreadsheetDeleteTableSchema,
  type SpreadsheetCreateDataValidationInput,
  SpreadsheetCreateDataValidationSchema,
  type SpreadsheetUpdateDataValidationInput,
  SpreadsheetUpdateDataValidationSchema,
  type SpreadsheetDeleteDataValidationInput,
  SpreadsheetDeleteDataValidationSchema,
  type SpreadsheetCreateConditionalFormatInput,
  SpreadsheetCreateConditionalFormatSchema,
  type SpreadsheetUpdateConditionalFormatInput,
  SpreadsheetUpdateConditionalFormatSchema,
  type SpreadsheetDeleteConditionalFormatInput,
  SpreadsheetDeleteConditionalFormatSchema,
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
import {
  type StyleReference,
  type TableTheme,
  type BandedDefinition,
  type TableView,
  type EmbeddedChart,
  type ChartSpec,
  type ConditionalFormatRule,
} from "@rowsncolumns/spreadsheet";
import type {
  SelectionArea,
  ConditionType,
  DataValidationRuleRecord,
  CellFormat,
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
          formula,
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

const documentWriteQueue = new Map<string, Promise<void>>();

const withDocumentWriteLock = async <T>(
  docId: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = documentWriteQueue.get(docId) ?? Promise.resolve();
  const waitForPrevious = previous.catch(() => undefined);

  let releaseCurrentQueue!: () => void;
  const currentQueue = new Promise<void>((resolve) => {
    releaseCurrentQueue = resolve;
  });
  const queued = waitForPrevious.then(() => currentQueue);
  documentWriteQueue.set(docId, queued);

  await waitForPrevious;

  try {
    return await operation();
  } finally {
    releaseCurrentQueue();
    if (documentWriteQueue.get(docId) === queued) {
      documentWriteQueue.delete(docId);
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

  // Use provided sheetId or default to 1
  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_changeBatch] Starting:", {
      docId,
      sheetId,
      range,
    });

    try {
      // Parse the range
      const selection = addressToSelection(range);

      if (!selection?.range) {
        return failTool("INVALID_RANGE", `Invalid range: ${range}`, { range });
      }

      // Connect to ShareDB
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

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

CRITICAL RULES:
1. Range uses A1 notation (e.g., 'A1:C3', 'B2:D5').
2. 'cells' must be a 2D array: list of rows. Dimensions MUST match the range.
3. Each cell object can have 'value', 'formula', and/or 'citation' (or be empty {}).
4. Use empty objects {} for blank cells you want to skip.
5. Only the target range is modified — never affects data outside.
6. IMPORTANT: Write data values BEFORE formulas that reference them.
   If a formula references cell B5, make sure B5 has a value first.
7. FORMULA ERRORS: When you see errors in formulaResults (e.g., #ERROR!, #REF!, #NAME?, #VALUE!, #DIV/0!, #NULL!, #N/A), you MUST attempt to fix them:
   - #REF!: Formula references a cell that was deleted or moved. Update the reference.
   - #NAME?: Unrecognized function or named range. Check spelling.
   - #VALUE!: Wrong type of argument. Ensure numbers aren't stored as text.
   - #DIV/0!: Division by zero. Add a check like =IF(B1=0, 0, A1/B1).
   - #N/A: Value not found in lookup. Verify the lookup value exists.
   - #ERROR!: General error. Review the formula syntax and cell references.
   Never leave formula errors unaddressed - always investigate and fix them.
8. PREFER FORMULAS: When referencing data from other cells, creating financial models, or building tabular content, prefer using formulas over hardcoded values. Formulas ensure data stays in sync and calculations update automatically.
9. BATCHING: Multiple tool calls are permitted and encouraged for large datasets. You can write data in batches (e.g., 5-10 rows at a time) using separate tool calls. This improves reliability and allows for incremental progress.
10. USE APPLYFILL FOR SEQUENCES: When writing sequential patterns (1, 2, 3... or Jan, Feb, Mar... or dates), DO NOT manually list each value. Instead:
    - Write only the first 1-2 values to establish the pattern
    - Use spreadsheet_applyFill to extend the sequence automatically
    Example: For "Fiscal Month 1, 2, 3...12" across B5:M5:
      Step 1: Write range "B5:C5" with cells [[{"value": 1}, {"value": 2}]]
      Step 2: applyFill with sourceRange "B5:C5", fillRange "B5:M5"
    This saves tokens and is more efficient than listing all 12 values.
11. CITATIONS: Use the 'citation' field to track data sources. Citations MUST be accompanied by a 'value' or 'formula'.
    - Format: URL with optional 'excerpt' query param for scroll-to-text highlighting
    - Example: "https://example.com/report.pdf?excerpt=Q3%20revenue%20was%20%2412M"

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
  ]`,
  schema: SpreadsheetChangeBatchSchema,
});

/**
 * Handler for the spreadsheet_createSheet tool
 */
const handleSpreadsheetCreateSheet = async (
  input: SpreadsheetCreateSheetInput,
): Promise<string> => {
  const { docId, sheetSpec, activeSheetId } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required to create a sheet",
    });
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_createSheet] Starting:", {
      docId,
      activeSheetId,
      sheetSpec,
    });

    try {
      // Connect to ShareDB
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

        if (!isNil(activeSheetId)) {
          spreadsheet.activeSheetId = activeSheetId;
        }

        // Build sheet spec for createNewSheet
        const spec: Record<string, unknown> = {};

        if (sheetSpec?.title) {
          spec.title = sheetSpec.title;
        }
        if (sheetSpec?.sheetId !== undefined) {
          spec.sheetId = sheetSpec.sheetId;
        }
        if (sheetSpec?.hidden !== undefined) {
          spec.hidden = sheetSpec.hidden;
        }
        if (sheetSpec?.merges) {
          spec.merges = sheetSpec.merges;
        }
        if (sheetSpec?.rowMetadata) {
          spec.rowMetadata = sheetSpec.rowMetadata;
        }
        if (sheetSpec?.columnMetadata) {
          spec.columnMetadata = sheetSpec.columnMetadata;
        }
        if (sheetSpec?.frozenRowCount !== undefined) {
          spec.frozenRowCount = sheetSpec.frozenRowCount;
        }
        if (sheetSpec?.frozenColumnCount !== undefined) {
          spec.frozenColumnCount = sheetSpec.frozenColumnCount;
        }
        if (sheetSpec?.showGridLines !== undefined) {
          spec.showGridLines = sheetSpec.showGridLines;
        }
        if (sheetSpec?.tabColor !== undefined) {
          // tabColor can be a hex string or { theme, tint } object
          spec.tabColor = sheetSpec.tabColor;
        }

        // Create the new sheet
        const newSheet = spreadsheet.createNewSheet(
          Object.keys(spec).length > 0 ? spec : undefined,
        );

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_createSheet] Completed:", {
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
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_createSheet] Error:", error);

      return JSON.stringify({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create sheet",
      });
    }
  });
};

/**
 * The spreadsheet_createSheet tool for LangChain
 */
export const spreadsheetCreateSheetTool = tool(handleSpreadsheetCreateSheet, {
  name: "spreadsheet_createSheet",
  description: `Create a new sheet (tab) in a spreadsheet document.

OVERVIEW:
This tool creates a new sheet/tab in an existing spreadsheet. You can optionally configure the sheet's properties like title, frozen rows/columns, tab color, and more.

WHEN TO USE THIS TOOL:
- Adding a new worksheet to organize data separately
- Creating a dedicated sheet for charts, summaries, or reports
- Setting up multi-sheet workbooks

EXAMPLES:

Example 1 — Create a simple sheet with default settings:
  docId: "abc123"
  (no sheetSpec needed)

Example 2 — Create a named sheet with frozen header row:
  docId: "abc123"
  sheetSpec: {
    "title": "Sales Report",
    "frozenRowCount": 1
  }

Example 3 — Create a colored sheet with hex color:
  docId: "abc123"
  sheetSpec: {
    "title": "Dashboard",
    "frozenRowCount": 2,
    "frozenColumnCount": 1,
    "tabColor": "#4285F4"
  }

Example 4 — Create a sheet with theme-based color:
  docId: "abc123"
  sheetSpec: {
    "title": "Summary",
    "tabColor": { "theme": 4, "tint": 0.4 }
  }`,
  schema: SpreadsheetCreateSheetSchema,
});

/**
 * All available tools for the spreadsheet assistant
 */
/**
 * Handler for the spreadsheet_updateSheet tool
 */
const handleSpreadsheetUpdateSheet = async (
  input: SpreadsheetUpdateSheetInput,
): Promise<string> => {
  const { docId, sheetId, sheetSpec, unsetFields } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required to update a sheet",
    });
  }

  if (isNil(sheetId)) {
    return JSON.stringify({
      success: false,
      error: "sheetId is required to update a sheet",
    });
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_updateSheet] Starting:", {
      docId,
      sheetId,
      sheetSpec,
      unsetFields,
    });

    try {
      // Connect to ShareDB
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

        // Build sheet spec for updateSheet
        const spec: Record<string, unknown> = {};

        if (sheetSpec?.title !== undefined) {
          spec.title = sheetSpec.title;
        }
        if (sheetSpec?.hidden !== undefined) {
          spec.hidden = sheetSpec.hidden;
        }
        if (sheetSpec?.merges !== undefined) {
          spec.merges = sheetSpec.merges;
        }
        if (sheetSpec?.rowMetadata !== undefined) {
          spec.rowMetadata = sheetSpec.rowMetadata;
        }
        if (sheetSpec?.columnMetadata !== undefined) {
          spec.columnMetadata = sheetSpec.columnMetadata;
        }
        if (sheetSpec?.frozenRowCount !== undefined) {
          spec.frozenRowCount = sheetSpec.frozenRowCount;
        }
        if (sheetSpec?.frozenColumnCount !== undefined) {
          spec.frozenColumnCount = sheetSpec.frozenColumnCount;
        }
        if (sheetSpec?.showGridLines !== undefined) {
          spec.showGridLines = sheetSpec.showGridLines;
        }
        if (sheetSpec?.tabColor !== undefined) {
          spec.tabColor = sheetSpec.tabColor;
        }

        // Handle unsetFields - explicitly set these to null
        // Valid SheetSpec keys that can be unset
        const validSheetSpecKeys = new Set([
          "frozenRowCount",
          "frozenColumnCount",
          "tabColor",
          "showGridLines",
          "hidden",
          "merges",
          "rowMetadata",
          "columnMetadata",
        ]);

        if (unsetFields && unsetFields.length > 0) {
          for (const field of unsetFields) {
            if (!validSheetSpecKeys.has(field)) {
              console.warn(
                `[spreadsheet_updateSheet] Ignoring invalid unsetField: ${field}`,
              );
              continue;
            }
            spec[field] = null;
          }
        }

        // Update the sheet
        spreadsheet.updateSheet(
          sheetId,
          Object.keys(spec).length > 0 ? spec : {},
        );

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_updateSheet] Completed:", {
          docId,
          sheetId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully updated sheet ${sheetId}`,
          sheetId,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_updateSheet] Error:", error);

      return JSON.stringify({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update sheet",
      });
    }
  });
};

/**
 * The spreadsheet_updateSheet tool for LangChain
 */
export const spreadsheetUpdateSheetTool = tool(handleSpreadsheetUpdateSheet, {
  name: "spreadsheet_updateSheet",
  description: `Update an existing sheet (tab) in a spreadsheet document.

OVERVIEW:
This tool updates properties of an existing sheet/tab. Use this to change sheet title, tab color, frozen rows/columns, row heights, column widths, merges, and more.

WHEN TO USE THIS TOOL:
- Renaming a sheet tab
- Changing tab color
- Setting frozen rows/columns
- Adjusting row heights or column widths
- Adding or modifying cell merges
- Showing/hiding grid lines
- Hiding/unhiding a sheet

IMPORTANT: To change row heights or column widths, populate rowMetadata or columnMetadata arrays with { index, size } objects.

SIZE DEFAULTS:
- Default row height: 21 pixels (MINIMUM recommended - sizes below 21 can cause text to be cut off or not visible)
- Default column width: 100 pixels
- When adjusting row heights, always use size >= 21 to ensure text visibility

EXAMPLES:

Example 1 — Rename a sheet:
  docId: "abc123"
  sheetId: 1
  sheetSpec: { "title": "Q1 Sales" }

Example 2 — Change tab color:
  docId: "abc123"
  sheetId: 1
  sheetSpec: { "tabColor": "#4285F4" }

Example 3 — Remove tab color:
  docId: "abc123"
  sheetId: 1
  sheetSpec: {}
  unsetFields: ["tabColor"]

Example 4 — Freeze header row and first column:
  docId: "abc123"
  sheetId: 1
  sheetSpec: {
    "frozenRowCount": 1,
    "frozenColumnCount": 1
  }

Example 5 — Set specific row heights:
  docId: "abc123"
  sheetId: 1
  sheetSpec: {
    "rowMetadata": [
      { "index": 0, "size": 40 },
      { "index": 5, "size": 50 }
    ]
  }

Example 6 — Set column widths:
  docId: "abc123"
  sheetId: 1
  sheetSpec: {
    "columnMetadata": [
      { "index": 0, "size": 200 },
      { "index": 1, "size": 150 }
    ]
  }`,
  schema: SpreadsheetUpdateSheetSchema,
});

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

  // Use provided sheetId or default to 1
  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_formatRange] Starting:", {
      docId,
      sheetId,
      range,
    });

    try {
      // Parse the range
      const selection = addressToSelection(range);

      if (!selection?.range) {
        return JSON.stringify({
          success: false,
          error: `Invalid range: ${range}`,
        });
      }

      // Connect to ShareDB
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
        const formatting = expandedCells.map((row) =>
          row.map((cell) => cell.cellStyles),
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

OVERVIEW:
This tool applies formatting (styles) to a 2D grid of cells at a specified range using A1 notation. It only affects the cells covered by the provided cells array — no other part of the sheet is changed.

WHEN TO USE THIS TOOL:
- Making text bold, italic, underlined, or strikethrough
- Changing font colors or background colors
- Applying borders to cells
- Setting number formats (currency, percentage, etc.)
- Aligning text horizontally or vertically

FORMATTING BEHAVIOR:
- Auto-format lightly by default to make outputs look presentable
- For small edits on existing sheets, avoid broad cosmetic reformatting unless the user explicitly requests it
- Preserve existing cell formatting by default
- When writing data, match the format of surrounding cells if present
- Do not apply bold to entire tables/ranges by default; reserve bold for headers, section labels, and totals

WHEN FORMATTING IS APPLIED, use these standards:
- Numbers: right-align, use thousands separator (#,##0)
- Currency: '$#,##0.00' with parentheses for negatives '($#,##0.00)'
- Percentages: '0.0%', right-align
- Text: left-align
- Headers: bold, center-align
- Totals: bold with top border
- Column headers (Year 1, Year 2, etc.): bold, center-align
- Data body cells: regular weight (non-bold) unless emphasis is explicitly requested

INPUT CELL CONVENTION (financial models only, when requested):
- Light blue background
- No background = formula/calculated

CELLSTYLES PROPERTIES (CellFormat):
- textFormat: {bold, italic, underline, strikethrough, fontFamily, fontSize, color}
- backgroundColor: Hex color string (e.g., '#FF0000') or theme object
- borders: {top, right, bottom, left} with style, width, color
- numberFormat: {type, pattern}
- horizontalAlignment: 'left', 'center', 'right'
- verticalAlignment: 'top', 'middle', 'bottom'
- wrapStrategy: 'overflow', 'wrap', 'clip'

SHORTHAND SUPPORT:
For convenience, you can use shorthand properties in cellStyles:
- {fontWeight: "bold"} → {textFormat: {bold: true}}
- {fontStyle: "italic"} → {textFormat: {italic: true}}

CRITICAL RULES:
1. Range uses A1 notation (e.g., 'A1:C3', 'B2:D5').
2. 'cells' must be a 2D array: list of rows.
3. Each cell object should have 'cellStyles' with formatting properties.
4. Use empty objects {} for cells that should not be formatted.
5. Only the target range is modified — never affects data outside.
6. AUTO-EXPANSION: If you provide exactly ONE cell [[{...}]], it will automatically expand to fill the entire range. This is useful when applying the same formatting to all cells in a range.
7. If using AUTO-EXPANSION with textFormat.bold=true, only do so for header-only or totals-only ranges. Do not auto-expand bold across mixed header+data regions.
8. BATCHING: Multiple tool calls are permitted and encouraged for large ranges. You can format in batches (e.g., 5-10 rows at a time) using separate tool calls. This improves reliability.

EXAMPLES:

Example 1 — Make A3:H3 italic (using auto-expansion):
  range: "A3:H3"
  cells: [[{"cellStyles": {"textFormat": {"italic": true, "fontSize": 11, "color": "#666666"}}}]]
  // Single cell auto-expands to fill all 8 cells (A3:H3)

Example 2 — Apply distinct formatting to header row (A1:C1):
  range: "A1:C1"
  cells: [
    [
      {"cellStyles": {"textFormat": {"bold": true, "fontSize": 14}, "backgroundColor": "#4A90E2"}},
      {"cellStyles": {"textFormat": {"bold": true, "fontSize": 14}, "backgroundColor": "#50C878"}},
      {"cellStyles": {"textFormat": {"bold": true, "fontSize": 14}, "backgroundColor": "#FF6B6B"}}
    ]
  ]
  // Each cell gets its own distinct formatting (different background colors)

Example 3 — Format range with mixed styles (A1:B3):
  range: "A1:B3"
  cells: [
    [
      {"cellStyles": {"backgroundColor": "#E8E8E8"}},
      {"cellStyles": {"backgroundColor": "#E8E8E8"}}
    ],
    [
      {"cellStyles": {"textFormat": {"italic": true}}},
      {"cellStyles": {}}
    ],
    [
      {"cellStyles": {"textFormat": {"underline": true}}},
      {"cellStyles": {"backgroundColor": "#FFFACD"}}
    ]
  ]
  // Row 1: Gray background
  // Row 2: First cell italic, second cell no formatting
  // Row 3: First cell underlined, second cell yellow background`,
  schema: SpreadsheetFormatRangeSchema,
});

/**
 * Handler for the spreadsheet_insertRows tool
 */
const handleSpreadsheetInsertRows = async (
  input: SpreadsheetInsertRowsInput,
): Promise<string> => {
  const {
    docId,
    sheetId: inputSheetId,
    referenceRowIndex,
    numRows = 1,
  } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required to modify the spreadsheet",
    });
  }

  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_insertRows] Starting:", {
      docId,
      sheetId,
      referenceRowIndex,
      numRows,
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

        const spreadsheet = createSpreadsheetInterface(data);

        // Insert rows
        spreadsheet.insertRow(sheetId, referenceRowIndex, numRows);

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_insertRows] Completed:", {
          docId,
          sheetId,
          referenceRowIndex,
          numRows,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully inserted ${numRows} row(s) at row index ${referenceRowIndex}`,
          referenceRowIndex,
          numRows,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_insertRows] Error:", error);

      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Failed to insert rows",
      });
    }
  });
};

/**
 * The spreadsheet_insertRows tool for LangChain
 */
export const spreadsheetInsertRowsTool = tool(handleSpreadsheetInsertRows, {
  name: "spreadsheet_insertRows",
  description: `Inserts empty rows into a spreadsheet sheet or table.

Args:
  docId: The ID of the spreadsheet
  sheetId: The sheet ID (default: 1)
  referenceRowIndex: The 1-based starting row index where the row is being inserted. If user is inserting row after an index, then referenceRowIndex is the next row index.
  numRows: Number of rows to insert (default: 1)`,
  schema: SpreadsheetInsertRowsSchema,
});

/**
 * Handler for the spreadsheet_insertColumns tool
 */
const handleSpreadsheetInsertColumns = async (
  input: SpreadsheetInsertColumnsInput,
): Promise<string> => {
  const {
    docId,
    sheetId: inputSheetId,
    referenceColumnIndex,
    numColumns = 1,
  } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required to modify the spreadsheet",
    });
  }

  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_insertColumns] Starting:", {
      docId,
      sheetId,
      referenceColumnIndex,
      numColumns,
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

        const spreadsheet = createSpreadsheetInterface(data);

        // Insert columns
        spreadsheet.insertColumn(sheetId, referenceColumnIndex, numColumns);

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_insertColumns] Completed:", {
          docId,
          sheetId,
          referenceColumnIndex,
          numColumns,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully inserted ${numColumns} column(s) at column index ${referenceColumnIndex}`,
          referenceColumnIndex,
          numColumns,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_insertColumns] Error:", error);

      return JSON.stringify({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to insert columns",
      });
    }
  });
};

/**
 * The spreadsheet_insertColumns tool for LangChain
 */
export const spreadsheetInsertColumnsTool = tool(
  handleSpreadsheetInsertColumns,
  {
    name: "spreadsheet_insertColumns",
    description: `Inserts empty columns into a spreadsheet sheet or table.

Args:
  docId: The ID of the spreadsheet
  sheetId: The sheet ID (default: 1)
  referenceColumnIndex: the 1-based starting column index where the column is being inserted.
  numColumns: Number of columns to insert (default: 1)`,
    schema: SpreadsheetInsertColumnsSchema,
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

      const spreadsheet = createSpreadsheetInterface(data);
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

          let sheetId = spreadsheet.activeSheetId ?? 1;
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
  description: `Query multiple ranges of cells from an  spreadsheet to get cell data.

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
  - range: A1 notation range (e.g., 'A1:D10', "'Sheet 2'!A1:C20")
  - layer: 'values' or 'formatting'

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

Example 2 — Query multiple ranges:
  docId: "abc123"
  items: [
    {"range": "A1:D10", "layer": "values"},
    {"range": "A1:A10", "layer": "formatting"}
  ]

Example 3 — Query from a specific sheet:
  docId: "abc123"
  items: [{"range": "'Sheet 2'!A1:C20", "layer": "values"}]`,
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

      await new Promise<void>((resolve, reject) => {
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

        doc.submitOp(op, {}, (err?: unknown) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });

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
  const { docId, sheetId: inputSheetId, range: rangeStr } = input;

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

      const spreadsheet = createSpreadsheetInterface(data);
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

        if (rangeStr && inputSheetId) {
          // Parse the provided range
          const selection = addressToSelection(rangeStr);
          if (selection?.range) {
            startRowIndex = selection.range.startRowIndex;
            endRowIndex = selection.range.endRowIndex;
            startColumnIndex = selection.range.startColumnIndex;
            endColumnIndex = selection.range.endColumnIndex;
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

      console.log("[spreadsheet_readDocument] Completed:", {
        docId,
        sheetCount: resultSheets.length,
      });

      return JSON.stringify({
        success: true,
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
  description: `Read content from a spreadsheet and return values in a workbook format.

OVERVIEW:
This tool reads cell data from a spreadsheet and returns it in a structured format. You can read all sheets, a specific sheet by ID or name, or a specific range within a sheet.

ROUTING GUIDANCE (OVERVIEW-FIRST TOOL):
- Use this tool for broad workbook or sheet exploration and structural understanding.
- If the user asks for specific cells/ranges (targeted reads), use spreadsheet_queryRange instead.
- Prefer spreadsheet_readDocument when deciding what ranges to query next, not for repeated scoped reads.

WHEN TO USE THIS TOOL:
- Getting an overview of the entire spreadsheet structure
- Reading all data from one or more sheets
- Understanding the layout and content of a workbook
- Initial exploration of a spreadsheet before making modifications

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: Optional sheet ID to read from (1-based). If provided, takes priority over sheetName.
- sheetName: Optional sheet name to read from. Used if sheetId is not provided.
- range: Optional A1 notation range (e.g., 'A1:B10'). Only applies when sheetId or sheetName is provided.

RETURNS:
JSON with workbook structure:
{
  "success": true,
  "workbook": {
    "sheets": [
      {
        "sheetName": "Sheet1",
        "sheetId": 1,
        "dimension": "A1:D14",
        "cells": {
          "A1": "value" or ["formatted", effective_value] or ["formatted", effective_value, formula]
        },
        "styles": {}
      }
    ]
  }
}

Cell values are returned in one of three formats:
- Plain value (string/number/boolean) when formatted equals effective
- [formatted_value, effective_value] when formatting differs (e.g., currency)
- [formatted_value, effective_value, formula] when cell has a formula

Empty cells are ignored (not included in the cells object).

EXAMPLES:

Example 1 — Read all sheets:
  docId: "abc123"

Example 2 — Read specific sheet by ID:
  docId: "abc123"
  sheetId: 1

Example 3 — Read specific sheet by name:
  docId: "abc123"
  sheetName: "Sales Report"

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

/**
 * Handler for the spreadsheet_setRowColDimensions tool
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
    console.log("[spreadsheet_setRowColDimensions] Starting:", {
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

        const spreadsheet = createSpreadsheetInterface(data);

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

        console.log("[spreadsheet_setRowColDimensions] Completed:", {
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
      console.error("[spreadsheet_setRowColDimensions] Error:", error);

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
 * The spreadsheet_setRowColDimensions tool for LangChain
 */
export const spreadsheetSetRowColDimensionsTool = tool(
  handleSpreadsheetSetRowColDimensions,
  {
    name: "spreadsheet_setRowColDimensions",
    description: `Set the width of columns or height of rows in a spreadsheet.

Use this tool to adjust column widths or row heights. Supports autofit
(automatically adjust to content) or fixed pixel sizes.

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
 * Handler for the spreadsheet_duplicateSheet tool
 * Copies an existing sheet to a new sheet
 */
const handleSpreadsheetDuplicateSheet = async (
  input: SpreadsheetDuplicateSheetInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId, newSheetId } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to duplicate a sheet",
      { field: "docId" },
    );
  }

  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_duplicateSheet] Starting:", {
      docId,
      sheetId,
      newSheetId,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Check if source sheet exists
        const sourceSheet = spreadsheet.sheets.find(
          (sheet) => sheet.sheetId === sheetId,
        );
        if (!sourceSheet) {
          return failTool(
            "SHEET_NOT_FOUND",
            `Sheet with ID ${sheetId} not found`,
            { sheetId },
          );
        }

        // Duplicate the sheet
        const duplicatedSheetId = spreadsheet.duplicateSheet(
          sheetId,
          newSheetId,
        );

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        // Find the new sheet to get its title
        const newSheet = spreadsheet.sheets.find(
          (sheet) => sheet.sheetId === duplicatedSheetId,
        );

        console.log("[spreadsheet_duplicateSheet] Completed:", {
          docId,
          sourceSheetId: sheetId,
          newSheetId: duplicatedSheetId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully duplicated sheet ${sheetId} to new sheet ${duplicatedSheetId}`,
          sourceSheetId: sheetId,
          newSheet: {
            sheetId: duplicatedSheetId,
            title:
              (newSheet as { title?: string })?.title ??
              `Sheet${duplicatedSheetId}`,
          },
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_duplicateSheet] Error:", error);

      return failTool(
        "DUPLICATE_SHEET_FAILED",
        error instanceof Error ? error.message : "Failed to duplicate sheet",
      );
    }
  });
};

/**
 * The spreadsheet_duplicateSheet tool for LangChain
 */
export const spreadsheetDuplicateSheetTool = tool(
  handleSpreadsheetDuplicateSheet,
  {
    name: "spreadsheet_duplicateSheet",
    description: `Copies an existing sheet to a new sheet in an  spreadsheet.

OVERVIEW:
This tool duplicates an existing sheet (tab) including all its data, formatting, and structure. The new sheet will be an exact copy of the source sheet.

WHEN TO USE THIS TOOL:
- Creating a backup copy of a sheet before making changes
- Using an existing sheet as a template for a new sheet
- Duplicating a sheet to create variations (e.g., monthly reports)

IMPORTANT:
- All indices are 1-based

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: The sheet ID (1-based) of the sheet to duplicate (default: 1)
- newSheetId: Optional sheet ID for the new duplicated sheet. If not provided, one will be auto-generated.

EXAMPLES:

Example 1 — Duplicate the first sheet:
  docId: "abc123"
  sheetId: 1

Example 2 — Duplicate a specific sheet with a specific new ID:
  docId: "abc123"
  sheetId: 2
  newSheetId: 5`,
    schema: SpreadsheetDuplicateSheetSchema,
  },
);

/**
 * Handler for the spreadsheet_deleteCells tool
 * Deletes (clears) cell contents in multiple ranges
 */
const handleSpreadsheetDeleteCells = async (
  input: SpreadsheetDeleteCellsInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId, ranges } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to delete cells", {
      field: "docId",
    });
  }

  if (!ranges || ranges.length === 0) {
    return failTool(
      "MISSING_RANGES",
      "At least one range is required to delete cells",
      { field: "ranges" },
    );
  }

  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_deleteCells] Starting:", {
      docId,
      sheetId,
      itemCount: ranges.length,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Convert A1 ranges to selections and delete each
        const deletedRanges: string[] = [];
        const errors: Array<{ range: string; error: string }> = [];

        for (const rangeStr of ranges) {
          try {
            const selection = addressToSelection(rangeStr);

            if (!selection?.range) {
              errors.push({
                range: rangeStr,
                error: `Invalid range: ${rangeStr}`,
              });
              continue;
            }

            // Create activeCell from the start of the selection
            const activeCell = {
              rowIndex: selection.range.startRowIndex,
              columnIndex: selection.range.startColumnIndex,
            };

            // Create selections array with the range
            const selections: SelectionArea[] = [{ range: selection.range }];

            // Delete cells
            spreadsheet.deleteCells(sheetId, activeCell, selections);
            deletedRanges.push(rangeStr);
          } catch (itemError) {
            errors.push({
              range: rangeStr,
              error:
                itemError instanceof Error
                  ? itemError.message
                  : "Failed to delete range",
            });
          }
        }

        // Evaluate formulas
        const formulaResults = await evaluateFormulas(sheetId, spreadsheet);

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_deleteCells] Completed:", {
          docId,
          sheetId,
          deletedCount: deletedRanges.length,
          errorCount: errors.length,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully deleted ${deletedRanges.length} range(s)`,
          deletedRanges,
          formulaResults,
          ...(errors.length > 0 ? { errors } : {}),
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_deleteCells] Error:", error);

      return failTool(
        "DELETE_CELLS_FAILED",
        error instanceof Error ? error.message : "Failed to delete cells",
      );
    }
  });
};

/**
 * The spreadsheet_deleteCells tool for LangChain
 */
export const spreadsheetDeleteCellsTool = tool(handleSpreadsheetDeleteCells, {
  name: "spreadsheet_deleteCells",
  description: `Delete (clear) cell contents in multiple ranges within a sheet.

OVERVIEW:
This tool clears the contents of cells in the specified ranges. It removes values and formulas from cells but does not delete rows or columns.

WHEN TO USE THIS TOOL:
- Clearing data from specific cell ranges
- Removing values before writing new data
- Cleaning up sections of a spreadsheet

IMPORTANT:
- All indices are 1-based
- This clears cell contents, not the cells themselves (use delete rows/columns for structural changes)

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: The sheet ID (1-based, default: 1)
- ranges: List of A1 notation ranges to delete (e.g., ['A1:B5', 'D3:F10'])

EXAMPLES:

Example 1 — Delete a single range:
  docId: "abc123"
  sheetId: 1
  ranges: ["A1:C10"]

Example 2 — Delete multiple ranges:
  docId: "abc123"
  sheetId: 1
  ranges: ["A1:B5", "D3:F10", "H1:H20"]

Example 3 — Delete a single cell:
  docId: "abc123"
  ranges: ["B5"]`,
  schema: SpreadsheetDeleteCellsSchema,
});

/**
 * Handler for the spreadsheet_clearFormatting tool
 * Clears formatting from multiple cell ranges while preserving values
 */
const handleSpreadsheetClearFormatting = async (
  input: SpreadsheetClearFormattingInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId, ranges } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to clear formatting", {
      field: "docId",
    });
  }

  if (!ranges || ranges.length === 0) {
    return failTool(
      "MISSING_RANGES",
      "At least one range is required to clear formatting",
      { field: "ranges" },
    );
  }

  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_clearFormatting] Starting:", {
      docId,
      sheetId,
      rangeCount: ranges.length,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Convert A1 ranges to selections and clear formatting for each
        const clearedRanges: string[] = [];
        const errors: Array<{ range: string; error: string }> = [];

        for (const rangeStr of ranges) {
          try {
            const selection = addressToSelection(rangeStr);

            if (!selection?.range) {
              errors.push({
                range: rangeStr,
                error: `Invalid range: ${rangeStr}`,
              });
              continue;
            }

            // Create activeCell from the start of the selection
            const activeCell = {
              rowIndex: selection.range.startRowIndex,
              columnIndex: selection.range.startColumnIndex,
            };

            // Create selections array with the range
            const selections = [{ range: selection.range }];

            // Clear formatting
            spreadsheet.clearFormatting(sheetId, activeCell, selections);
            clearedRanges.push(rangeStr);
          } catch (itemError) {
            errors.push({
              range: rangeStr,
              error:
                itemError instanceof Error
                  ? itemError.message
                  : "Failed to clear formatting",
            });
          }
        }

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_clearFormatting] Completed:", {
          docId,
          sheetId,
          clearedCount: clearedRanges.length,
          errorCount: errors.length,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully cleared formatting from ${clearedRanges.length} range(s)`,
          clearedRanges,
          ...(errors.length > 0 ? { errors } : {}),
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_clearFormatting] Error:", error);

      return failTool(
        "CLEAR_FORMATTING_FAILED",
        error instanceof Error ? error.message : "Failed to clear formatting",
      );
    }
  });
};

/**
 * The spreadsheet_clearFormatting tool for LangChain
 */
export const spreadsheetClearFormattingTool = tool(
  handleSpreadsheetClearFormatting,
  {
    name: "spreadsheet_clearFormatting",
    description: `Clear formatting from multiple cell ranges within a sheet.

OVERVIEW:
This tool removes all visual formatting (colors, borders, fonts, number formats, etc.) from the specified ranges while preserving cell values and formulas.

WHEN TO USE THIS TOOL:
- Removing unwanted formatting from cells
- Resetting cells to default appearance
- Cleaning up imported data that has inconsistent formatting
- Preparing cells before applying new uniform formatting

IMPORTANT:
- All indices are 1-based
- Cell values and formulas are preserved - only visual formatting is removed

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: The sheet ID (1-based, default: 1)
- ranges: List of A1 notation ranges to clear formatting from (e.g., ['A1:B5', 'D3:F10'])

EXAMPLES:

Example 1 — Clear formatting from a single range:
  docId: "abc123"
  sheetId: 1
  ranges: ["A1:C10"]

Example 2 — Clear formatting from multiple ranges:
  docId: "abc123"
  sheetId: 1
  ranges: ["A1:B5", "D3:F10", "H1:H20"]

Example 3 — Clear formatting from entire columns:
  docId: "abc123"
  ranges: ["A:C"]`,
    schema: SpreadsheetClearFormattingSchema,
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

  const sheetId = inputSheetId ?? 1;

  // Parse activeCell from A1 notation
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

  // Parse sourceRange from A1 notation
  const sourceSelection = addressToSelection(sourceRange);
  if (!sourceSelection?.range) {
    return failTool(
      "INVALID_SOURCE_RANGE",
      `Invalid sourceRange: ${sourceRange}`,
      { sourceRange },
    );
  }

  // Parse fillRange from A1 notation
  const fillSelection = addressToSelection(fillRange);
  if (!fillSelection?.range) {
    return failTool("INVALID_FILL_RANGE", `Invalid fillRange: ${fillRange}`, {
      fillRange,
    });
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_applyFill] Starting:", {
      docId,
      sheetId,
      activeCell,
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

        // Create selections array from source range
        const selections = [{ range: sourceSelection.range }];

        // Apply fill operation
        await spreadsheet.applyFill(
          sheetId,
          activeCell,
          { range: fillSelection.range },
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
  2. applyFill: Extend to full range (sourceRange: "B5:C5", fillRange: "B5:M5")

IMPORTANT:
- All indices are 1-based
- fillRange must INCLUDE the sourceRange (it's the entire area, not just the destination)
- The tool auto-detects patterns (numbers, dates, series)

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: The sheet ID (1-based, default: 1)
- activeCell: A1 notation for the active cell, typically the top-left of the source (e.g., 'A1')
- sourceRange: A1 notation for the source range containing the pattern (e.g., 'A1:A2')
- fillRange: A1 notation for the entire fill area INCLUDING source (e.g., 'A1:A10')

EXAMPLES:

Example 1 — Fill down a number sequence (1, 2 in A1:A2 → fills 3, 4, 5 in A3:A5):
  docId: "abc123"
  sheetId: 1
  activeCell: "A1"
  sourceRange: "A1:A2"
  fillRange: "A1:A5"

Example 2 — Copy a formula down (formula in B2 → copy to B3:B10):
  docId: "abc123"
  activeCell: "B2"
  sourceRange: "B2"
  fillRange: "B2:B10"

Example 3 — Fill right with a value (value in A1 → copy to B1:E1):
  docId: "abc123"
  activeCell: "A1"
  sourceRange: "A1"
  fillRange: "A1:E1"

Example 4 — Extend a date series (Jan, Feb in A1:A2 → fills Mar, Apr... in A3:A12):
  docId: "abc123"
  activeCell: "A1"
  sourceRange: "A1:A2"
  fillRange: "A1:A12"`,
  schema: SpreadsheetApplyFillSchema,
});

/**
 * Handler for the spreadsheet_insertNote tool
 * Inserts or updates a note (comment) on a cell
 */
const handleSpreadsheetInsertNote = async (
  input: SpreadsheetInsertNoteInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId, cell, note } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to insert a note", {
      field: "docId",
    });
  }

  if (!cell) {
    return failTool("MISSING_CELL", "cell is required", { field: "cell" });
  }

  const sheetId = inputSheetId ?? 1;

  // Parse cell from A1 notation
  const cellSelection = addressToSelection(cell);
  if (!cellSelection?.range) {
    return failTool("INVALID_CELL", `Invalid cell: ${cell}`, { cell });
  }

  const cellInterface = {
    rowIndex: cellSelection.range.startRowIndex,
    columnIndex: cellSelection.range.startColumnIndex,
  };

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_insertNote] Starting:", {
      docId,
      sheetId,
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

        const spreadsheet = createSpreadsheetInterface(data);

        // Insert or remove note
        spreadsheet.insertNote(sheetId, cellInterface, note);

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        const action = note ? "inserted/updated" : "removed";
        console.log("[spreadsheet_insertNote] Completed:", {
          docId,
          sheetId,
          cell,
          action,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully ${action} note on cell ${cell}`,
          cell,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_insertNote] Error:", error);

      return failTool(
        "INSERT_NOTE_FAILED",
        error instanceof Error ? error.message : "Failed to insert note",
      );
    }
  });
};

/**
 * The spreadsheet_insertNote tool for LangChain
 */
export const spreadsheetInsertNoteTool = tool(handleSpreadsheetInsertNote, {
  name: "spreadsheet_insertNote",
  description: `Insert, update, or remove a note (comment) on a cell.

OVERVIEW:
This tool adds a note/comment to a specific cell. Notes are visible when hovering over the cell and can contain explanatory text, instructions, or comments.

WHEN TO USE THIS TOOL:
- Adding explanatory notes to cells
- Providing context or instructions for specific data
- Leaving comments for collaborators
- Removing existing notes (by omitting the note parameter)

IMPORTANT:
- All indices are 1-based
- To remove a note, call without the note parameter or with an empty string

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: The sheet ID (1-based, default: 1)
- cell: A1 notation for the cell (e.g., 'A1', 'B5')
- note: The note text (optional - omit to remove existing note)

EXAMPLES:

Example 1 — Add a note to a cell:
  docId: "abc123"
  cell: "A1"
  note: "This is the header row"

Example 2 — Update an existing note:
  docId: "abc123"
  cell: "B5"
  note: "Updated calculation method"

Example 3 — Remove a note from a cell:
  docId: "abc123"
  cell: "A1"`,
  schema: SpreadsheetInsertNoteSchema,
});

/**
 * Handler for the spreadsheet_deleteRows tool
 * Deletes rows from a spreadsheet
 */
const handleSpreadsheetDeleteRows = async (
  input: SpreadsheetDeleteRowsInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId, rowIndexes } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to delete rows", {
      field: "docId",
    });
  }

  if (!rowIndexes || rowIndexes.length === 0) {
    return failTool(
      "MISSING_ROW_INDEXES",
      "At least one row index is required",
      { field: "rowIndexes" },
    );
  }

  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_deleteRows] Starting:", {
      docId,
      sheetId,
      rowIndexes,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Delete rows
        spreadsheet.deleteRow(sheetId, rowIndexes);

        // Evaluate formulas
        const formulaResults = await evaluateFormulas(sheetId, spreadsheet);

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_deleteRows] Completed:", {
          docId,
          sheetId,
          rowIndexes,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully deleted ${rowIndexes.length} row(s)`,
          deletedRows: rowIndexes,
          formulaResults,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_deleteRows] Error:", error);

      return failTool(
        "DELETE_ROWS_FAILED",
        error instanceof Error ? error.message : "Failed to delete rows",
      );
    }
  });
};

/**
 * The spreadsheet_deleteRows tool for LangChain
 */
export const spreadsheetDeleteRowsTool = tool(handleSpreadsheetDeleteRows, {
  name: "spreadsheet_deleteRows",
  description: `Delete rows from a spreadsheet.

OVERVIEW:
This tool removes entire rows from a sheet. All data in the specified rows will be deleted, and rows below will shift up.

WHEN TO USE THIS TOOL:
- Removing unwanted data rows
- Cleaning up empty rows
- Deleting multiple rows at once

IMPORTANT:
- All indices are 1-based (row 1 is the first row)
- Deleting rows will shift all rows below upward
- This is a destructive operation - data cannot be recovered

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: The sheet ID (1-based, default: 1)
- rowIndexes: Array of 1-based row indexes to delete (e.g., [1, 3, 5])

EXAMPLES:

Example 1 — Delete a single row:
  docId: "abc123"
  sheetId: 1
  rowIndexes: [5]

Example 2 — Delete multiple rows:
  docId: "abc123"
  sheetId: 1
  rowIndexes: [2, 4, 6, 8]

Example 3 — Delete a range of consecutive rows (rows 10-15):
  docId: "abc123"
  rowIndexes: [10, 11, 12, 13, 14, 15]`,
  schema: SpreadsheetDeleteRowsSchema,
});

/**
 * Handler for the spreadsheet_deleteColumns tool
 * Deletes columns from a spreadsheet
 */
const handleSpreadsheetDeleteColumns = async (
  input: SpreadsheetDeleteColumnsInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId, columnIndexes } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to delete columns", {
      field: "docId",
    });
  }

  if (!columnIndexes || columnIndexes.length === 0) {
    return failTool(
      "MISSING_COLUMN_INDEXES",
      "At least one column index is required",
      { field: "columnIndexes" },
    );
  }

  const sheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_deleteColumns] Starting:", {
      docId,
      sheetId,
      columnIndexes,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Delete columns
        spreadsheet.deleteColumn(sheetId, columnIndexes);

        // Evaluate formulas
        const formulaResults = await evaluateFormulas(sheetId, spreadsheet);

        // Persist changes
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_deleteColumns] Completed:", {
          docId,
          sheetId,
          columnIndexes,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully deleted ${columnIndexes.length} column(s)`,
          deletedColumns: columnIndexes,
          formulaResults,
        });
      } finally {
        close();
      }
    } catch (error) {
      console.error("[spreadsheet_deleteColumns] Error:", error);

      return failTool(
        "DELETE_COLUMNS_FAILED",
        error instanceof Error ? error.message : "Failed to delete columns",
      );
    }
  });
};

/**
 * The spreadsheet_deleteColumns tool for LangChain
 */
export const spreadsheetDeleteColumnsTool = tool(
  handleSpreadsheetDeleteColumns,
  {
    name: "spreadsheet_deleteColumns",
    description: `Delete columns from a spreadsheet.

OVERVIEW:
This tool removes entire columns from a sheet. All data in the specified columns will be deleted, and columns to the right will shift left.

WHEN TO USE THIS TOOL:
- Removing unwanted data columns
- Cleaning up empty columns
- Deleting multiple columns at once

IMPORTANT:
- All indices are 1-based (A=1, B=2, C=3, etc.)
- Deleting columns will shift all columns to the right leftward
- This is a destructive operation - data cannot be recovered

PARAMETERS:
- docId: The document ID of the spreadsheet (required)
- sheetId: The sheet ID (1-based, default: 1)
- columnIndexes: Array of 1-based column indexes to delete (A=1, B=2, C=3, etc.)

EXAMPLES:

Example 1 — Delete column A:
  docId: "abc123"
  sheetId: 1
  columnIndexes: [1]

Example 2 — Delete columns B and D:
  docId: "abc123"
  sheetId: 1
  columnIndexes: [2, 4]

Example 3 — Delete columns A through C:
  docId: "abc123"
  columnIndexes: [1, 2, 3]`,
    schema: SpreadsheetDeleteColumnsSchema,
  },
);

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
 * Handler for the spreadsheet_createTable tool
 */
const handleSpreadsheetCreateTable = async (
  input: SpreadsheetCreateTableInput,
): Promise<string> => {
  const {
    docId,
    sheetId,
    range,
    title,
    columns,
    theme,
    bandedRange,
    ...options
  } = input;

  // Create table ID
  const tableId = uuidString();
  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to create a table", {
      field: "docId",
    });
  }

  if (!title || title.trim().length === 0) {
    return failTool("MISSING_TITLE", "title is required for creating a table", {
      field: "title",
    });
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_createTable] Starting:", {
      docId,
      sheetId,
      range,
      title,
    });

    try {
      const selection = addressToSelection(range);
      if (!selection?.range) {
        return failTool("INVALID_RANGE", `Invalid range: ${range}`, { range });
      }

      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Build table spec
        const tableSpec = {
          id: tableId,
          title,
          sheetId,
          columns: columns.map((col) => ({
            name: col.name,
            ...(col.formula ? { formula: col.formula } : {}),
            ...(col.filterButton !== undefined
              ? { filterButton: col.filterButton }
              : {}),
          })),
          ...options,
          ...(bandedRange ? { bandedRange } : {}),
        };

        // Map simplified theme to actual theme
        const mappedTheme = mapTableTheme(theme);

        // Create the table
        const activeCell = {
          rowIndex: selection.range.startRowIndex,
          columnIndex: selection.range.startColumnIndex,
        };
        const selections: SelectionArea[] = [{ range: selection.range }];

        spreadsheet.createTable(
          sheetId,
          activeCell,
          selections,
          tableSpec as Partial<TableView>,
          mappedTheme as TableTheme | undefined,
          bandedRange as BandedDefinition | undefined,
        );

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_createTable] Completed:", {
          docId,
          title,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully created table "${title}" at ${range}`,
          tableName: title,
          tableId,
          range,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_createTable] Error:", error);
      return failTool(
        "CREATE_TABLE_FAILED",
        error instanceof Error ? error.message : "Failed to create table",
      );
    }
  });
};

/**
 * The spreadsheet_createTable tool for LangChain
 */
export const spreadsheetCreateTableTool = tool(handleSpreadsheetCreateTable, {
  name: "spreadsheet_createTable",
  description: `Create a formatted table from a range of cells.

OVERVIEW:
This tool converts a cell range into a structured table with headers, optional styling, and filtering capabilities. Tables support structured references in formulas (e.g., TableName[Column]).

WHEN TO USE THIS TOOL:
- Converting raw data into a formatted table
- Adding filter buttons to column headers
- Applying alternating row colors (banding)
- Creating calculated columns with formulas

IMPORTANT:
- The first row of the range becomes the header row
- Table names must be unique within the workbook
- When showRowStripes is true, you MUST also provide bandedRange

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (required)
- range: A1 notation range (e.g., 'A1:D10')
- title: Table name (required, must be unique)
- columns: Column definitions with name, optional formula, optional filterButton
- theme: 'none', 'light', 'medium', or 'dark'
- headerRow: Whether to show header row (default: true)
- totalRow: Whether to show totals row (default: false)
- showRowStripes: Enable alternating row colors (requires bandedRange)
- bandedRange: Color definitions for row/column banding

EXAMPLES:

Example 1 — Simple table:
  docId: "abc123"
  sheetId: 1
  range: "A1:C10"
  title: "SalesData"
  columns: [{ name: "Product" }, { name: "Price" }, { name: "Quantity" }]

Example 2 — Table with calculated column:
  docId: "abc123"
  sheetId: 1
  range: "A1:D10"
  title: "Invoice"
  columns: [
    { name: "Item" },
    { name: "Price" },
    { name: "Qty" },
    { name: "Total", formula: "=[Price]*[Qty]" }
  ]
  theme: "medium"`,
  schema: SpreadsheetCreateTableSchema,
});

/**
 * Handler for the spreadsheet_updateTable tool
 */
const handleSpreadsheetUpdateTable = async (
  input: SpreadsheetUpdateTableInput,
): Promise<string> => {
  const {
    docId,
    sheetId,
    tableId,
    tableName,
    theme,
    columns,
    bandedRange,
    ...updates
  } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to update a table", {
      field: "docId",
    });
  }

  if (!tableId && !tableName) {
    return failTool(
      "MISSING_TABLE_IDENTIFIER",
      "Either tableId or tableName is required to update a table",
      {
        fields: ["tableId", "tableName"],
      },
    );
  }

  const tableIdentifier = tableId || tableName;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_updateTable] Starting:", {
      docId,
      sheetId,
      tableId,
      tableName,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Find the table by ID or name
        const tables = spreadsheet.tables || [];
        const table = tables.find(
          (t) => t.id === tableId || t.title === tableName,
        );

        if (!table) {
          return failTool(
            "TABLE_NOT_FOUND",
            `Table "${tableIdentifier}" not found`,
            { tableId, tableName },
          );
        }

        // Build update spec
        const updateSpec: Record<string, unknown> = {
          ...updates,
        };

        // Map simplified theme to actual theme
        if (theme) {
          updateSpec.theme = mapTableTheme(theme);
        }

        // Map columns if provided
        if (columns) {
          updateSpec.columns = columns.map((col) => ({
            name: col.name,
            ...(col.formula ? { formula: col.formula } : {}),
            ...(col.filterButton !== undefined
              ? { filterButton: col.filterButton }
              : {}),
          }));
        }

        // Handle bandedRange - include null to remove existing banding
        if (bandedRange !== undefined) {
          updateSpec.bandedRange = bandedRange;
        }

        spreadsheet.updateTable(sheetId, table.id, updateSpec);

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_updateTable] Completed:", {
          docId,
          tableId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully updated table "${tableId}"`,
          tableId,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_updateTable] Error:", error);
      return failTool(
        "UPDATE_TABLE_FAILED",
        error instanceof Error ? error.message : "Failed to update table",
      );
    }
  });
};

/**
 * The spreadsheet_updateTable tool for LangChain
 */
export const spreadsheetUpdateTableTool = tool(handleSpreadsheetUpdateTable, {
  name: "spreadsheet_updateTable",
  description: `Update properties of an existing table.

OVERVIEW:
This tool modifies an existing table's properties such as name, theme, column definitions, and display options.

WHEN TO USE THIS TOOL:
- Renaming a table
- Changing table theme/style
- Adding or removing totals row
- Modifying column headers or calculated columns
- Toggling row/column stripes

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (required)
- tableId: The table ID to update (provide either tableId or tableName)
- tableName: The table name to update (provide either tableId or tableName)
- title: New table name (for renaming)
- columns: Updated column definitions
- theme: 'none', 'light', 'medium', or 'dark'
- headerRow: Whether to show header row
- totalRow: Whether to show totals row
- showRowStripes: Enable alternating row colors
- showColumnStripes: Enable alternating column colors
- bandedRange: Color definitions for banding (set to null to remove)

EXAMPLES:

Example 1 — Change table theme by name:
  docId: "abc123"
  sheetId: 1
  tableName: "SalesData"
  theme: "dark"

Example 2 — Add totals row:
  docId: "abc123"
  sheetId: 1
  tableName: "Invoice"
  totalRow: true

Example 3 — Remove banding:
  docId: "abc123"
  sheetId: 1
  tableName: "SalesData"
  bandedRange: null
  showRowStripes: false`,
  schema: SpreadsheetUpdateTableSchema,
});

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
 * Handler for the spreadsheet_createChart tool
 */
const handleSpreadsheetCreateChart = async (
  input: SpreadsheetCreateChartInput,
): Promise<string> => {
  const {
    docId,
    sheetId,
    domain,
    series,
    chartType,
    title,
    subtitle,
    anchorCell,
    width = 400,
    height = 300,
    stackedType,
    xAxisTitle,
    yAxisTitle,
  } = input;

  const chartId = uuidString();

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to create a chart", {
      field: "docId",
    });
  }

  if (!domain) {
    return failTool(
      "MISSING_DOMAIN",
      "domain is required for creating a chart (X-axis categories)",
      { field: "domain" },
    );
  }

  if (!series || series.length === 0) {
    return failTool(
      "MISSING_SERIES",
      "series is required for creating a chart (at least one data series)",
      { field: "series" },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_createChart] Starting:", {
      docId,
      sheetId,
      domain,
      series,
      chartType,
    });

    try {
      // Parse domain range
      const domainSelection = addressToSelection(domain);
      if (!domainSelection?.range) {
        return failTool("INVALID_DOMAIN", `Invalid domain range: ${domain}`, {
          domain,
        });
      }

      // Parse series ranges
      const seriesSelections = series
        .map((s, i) => {
          const sel = addressToSelection(s);
          return sel?.range;
        })
        .filter((el) => !isNil(el));

      // Parse anchor cell if provided
      let anchorCellParsed = {
        rowIndex: domainSelection.range.startRowIndex,
        columnIndex: domainSelection.range.endColumnIndex + 2, // Default: 2 columns right of domain
      };
      if (anchorCell) {
        const anchorSelection = addressToSelection(anchorCell);
        if (anchorSelection?.range) {
          anchorCellParsed = {
            rowIndex: anchorSelection.range.startRowIndex,
            columnIndex: anchorSelection.range.startColumnIndex,
          };
        }
      }

      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Build chart spec with explicit domain and series
        const chartSpec: Partial<ChartSpec> = {
          chartType,
          title,
          subtitle,
          horizontalAxisTitle: xAxisTitle,
          verticalAxisTitle: yAxisTitle,
          stackedType: mapStackedType(stackedType),
          domains: [
            {
              sources: [
                {
                  sheetId,
                  startRowIndex: domainSelection.range.startRowIndex,
                  endRowIndex: domainSelection.range.endRowIndex,
                  startColumnIndex: domainSelection.range.startColumnIndex,
                  endColumnIndex: domainSelection.range.endColumnIndex,
                },
              ],
            },
          ],
          series: seriesSelections.map((s) => ({
            sources: [
              {
                ...s,
                sheetId,
              },
            ],
          })),
        };

        const activeCell = {
          rowIndex: domainSelection.range.startRowIndex,
          columnIndex: domainSelection.range.startColumnIndex,
        };
        const selections = [{ range: domainSelection.range }];

        // Build embedded chart with position
        const embeddedChart: Partial<EmbeddedChart> = {
          chartId,
          spec: chartSpec as ChartSpec,
          position: {
            sheetId,
            overlayPosition: {
              anchorCell: anchorCellParsed,
              widthPixels: width,
              heightPixels: height,
              offsetXPixels: 0,
              offsetYPixels: 0,
            },
          },
        };

        spreadsheet.createChart(
          sheetId,
          activeCell,
          selections,
          embeddedChart as EmbeddedChart,
        );

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_createChart] Completed:", {
          docId,
          chartType,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully created ${chartType} chart with ${series.length} series`,
          chartType,
          domain,
          series,
          chartId,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_createChart] Error:", error);
      return failTool(
        "CREATE_CHART_FAILED",
        error instanceof Error ? error.message : "Failed to create chart",
      );
    }
  });
};

/**
 * The spreadsheet_createChart tool for LangChain
 */
export const spreadsheetCreateChartTool = tool(handleSpreadsheetCreateChart, {
  name: "spreadsheet_createChart",
  description: `Create a chart from spreadsheet data with explicit domain and series.

OVERVIEW:
This tool creates a chart visualization. You specify the domain (X-axis categories) and series (Y-axis data) explicitly.

IMPORTANT - DATA RANGES:
- domain: Range for X-axis labels/categories (e.g., 'A2:A10'). Usually a single column. DO NOT include header row.
- series: Array of ranges for data series (e.g., ['B2:B10', 'C2:C10']). Each range becomes a separate line/bar. DO NOT include header rows.

WHEN TO USE THIS TOOL:
- Creating bar, column, line, pie, or area charts
- Visualizing tabular data
- Adding charts next to data tables

CHART TYPES:
- 'bar': Horizontal bars
- 'column': Vertical bars (most common)
- 'line': Line chart with points
- 'pie': Circular pie chart
- 'area': Filled area chart
- 'scatter': XY scatter plot

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (required)
- domain: A1 notation range for X-axis categories, excluding header (e.g., 'A2:A10') (required)
- series: Array of A1 notation ranges for data series, excluding headers (e.g., ['B2:B10', 'C2:C10']) (required)
- chartType: Type of chart (required)
- title: Chart title
- subtitle: Chart subtitle
- anchorCell: Where to place chart (e.g., 'F1')
- width: Chart width in pixels (default: 400)
- height: Chart height in pixels (default: 300)
- stackedType: 'stacked', 'percentStacked', or 'unstacked' (for bar/column/area)
- xAxisTitle: Horizontal axis title
- yAxisTitle: Vertical axis title

EXAMPLES:

Given data in A1:C5:
  | Month | Sales | Profit |
  | Jan   | 100   | 20     |
  | Feb   | 150   | 35     |
  | Mar   | 120   | 25     |
  | Apr   | 180   | 45     |

Example 1 — Column chart with two series:
  docId: "abc123"
  sheetId: 1
  domain: "A2:A5"
  series: ["B2:B5", "C2:C5"]
  chartType: "column"
  title: "Monthly Performance"

Example 2 — Line chart with single series:
  docId: "abc123"
  sheetId: 1
  domain: "A2:A5"
  series: ["B2:B5"]
  chartType: "line"
  title: "Sales Trend"
  anchorCell: "E1"`,
  schema: SpreadsheetCreateChartSchema,
});

/**
 * Handler for the spreadsheet_updateChart tool
 */
const handleSpreadsheetUpdateChart = async (
  input: SpreadsheetUpdateChartInput,
): Promise<string> => {
  const {
    docId,
    sheetId,
    chartId,
    title,
    subtitle,
    domain,
    series,
    chartType,
    stackedType,
    xAxisTitle,
    yAxisTitle,
    anchorCell,
    width,
    height,
  } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to update a chart", {
      field: "docId",
    });
  }

  if (!chartId) {
    return failTool(
      "MISSING_CHART_ID",
      "chartId is required to update a chart",
      {
        field: "chartId",
      },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_updateChart] Starting:", {
      docId,
      sheetId,
      chartId,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Find the chart by ID
        const charts = spreadsheet.charts || [];
        const chart = charts.find((c) => String(c.chartId) === chartId);

        if (!chart) {
          return failTool("CHART_NOT_FOUND", `Chart "${chartId}" not found`, {
            chartId,
          });
        }

        // Build updated chart
        const updatedChart: EmbeddedChart = { ...chart };

        // Update spec properties
        if (title !== undefined) updatedChart.spec.title = title;
        if (subtitle !== undefined) updatedChart.spec.subtitle = subtitle;
        if (chartType !== undefined) {
          (updatedChart.spec as { chartType: string }).chartType = chartType;
        }
        if (stackedType !== undefined) {
          (updatedChart.spec as { stackedType?: string }).stackedType =
            mapStackedType(stackedType);
        }
        if (xAxisTitle !== undefined)
          updatedChart.spec.horizontalAxisTitle = xAxisTitle;
        if (yAxisTitle !== undefined)
          updatedChart.spec.verticalAxisTitle = yAxisTitle;

        // Update domain if provided
        if (domain) {
          const domainSelection = addressToSelection(domain);
          if (domainSelection?.range) {
            (updatedChart.spec as { domains: unknown[] }).domains = [
              {
                sources: [
                  {
                    sheetId,
                    startRowIndex: domainSelection.range.startRowIndex,
                    endRowIndex: domainSelection.range.endRowIndex,
                    startColumnIndex: domainSelection.range.startColumnIndex,
                    endColumnIndex: domainSelection.range.endColumnIndex,
                  },
                ],
              },
            ];
          }
        }

        // Update series if provided
        if (series && series.length > 0) {
          const seriesSelections = series
            .map((s) => addressToSelection(s))
            .filter(
              (sel): sel is NonNullable<typeof sel> => sel?.range != null,
            );

          if (seriesSelections.length > 0) {
            (updatedChart.spec as { series: unknown[] }).series =
              seriesSelections.map((sel) => ({
                sources: [
                  {
                    sheetId,
                    startRowIndex: sel.range.startRowIndex,
                    endRowIndex: sel.range.endRowIndex,
                    startColumnIndex: sel.range.startColumnIndex,
                    endColumnIndex: sel.range.endColumnIndex,
                  },
                ],
              }));
          }
        }

        // Update position if provided
        if (anchorCell) {
          const anchorSelection = addressToSelection(anchorCell);
          if (anchorSelection?.range) {
            updatedChart.position.overlayPosition.anchorCell = {
              rowIndex: anchorSelection.range.startRowIndex,
              columnIndex: anchorSelection.range.startColumnIndex,
            };
          }
        }
        if (width !== undefined) {
          updatedChart.position.overlayPosition.widthPixels = width;
        }
        if (height !== undefined) {
          updatedChart.position.overlayPosition.heightPixels = height;
        }

        spreadsheet.updateChart(updatedChart);

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_updateChart] Completed:", {
          docId,
          chartId: chart.chartId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully updated chart "${chart.spec.title}"`,
          chartId: chart.chartId,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_updateChart] Error:", error);
      return failTool(
        "UPDATE_CHART_FAILED",
        error instanceof Error ? error.message : "Failed to update chart",
      );
    }
  });
};

/**
 * The spreadsheet_updateChart tool for LangChain
 */
export const spreadsheetUpdateChartTool = tool(handleSpreadsheetUpdateChart, {
  name: "spreadsheet_updateChart",
  description: `Update properties of an existing chart.

OVERVIEW:
This tool modifies an existing chart's properties such as title, type, data sources, and position.

WHEN TO USE THIS TOOL:
- Changing chart title or subtitle
- Switching chart type (e.g., bar to line)
- Updating domain (X-axis categories) or series (Y-axis data)
- Moving or resizing the chart

IMPORTANT - DATA RANGES:
- domain: Range for X-axis labels/categories (e.g., 'A2:A10'). DO NOT include header row.
- series: Array of ranges for data series (e.g., ['B2:B10', 'C2:C10']). DO NOT include header rows.

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (required)
- chartId: The chart ID to update (required)
- title: New chart title (set to null to clear)
- subtitle: New chart subtitle (set to null to clear)
- domain: New A1 notation range for X-axis categories, excluding header (e.g., 'A2:A20')
- series: New array of A1 notation ranges for data series, excluding headers (e.g., ['B2:B20', 'C2:C20'])
- chartType: Change to different chart type
- stackedType: 'stacked', 'percentStacked', or 'unstacked'
- xAxisTitle: New horizontal axis title
- yAxisTitle: New vertical axis title
- anchorCell: Move chart to this cell
- width: New width in pixels
- height: New height in pixels

EXAMPLES:

Example 1 — Change chart title:
  docId: "abc123"
  sheetId: 1
  chartId: "chart_1"
  title: "Q1 Sales Report"

Example 2 — Convert to line chart and resize:
  docId: "abc123"
  sheetId: 1
  chartId: "chart_2"
  chartType: "line"
  width: 600
  height: 400

Example 3 — Update data sources (extend range):
  docId: "abc123"
  sheetId: 1
  chartId: "chart_1"
  domain: "A2:A50"
  series: ["B2:B50", "C2:C50"]`,
  schema: SpreadsheetUpdateChartSchema,
});

/**
 * Handler for the spreadsheet_deleteSheet tool
 */
const handleSpreadsheetDeleteSheet = async (
  input: SpreadsheetDeleteSheetInput,
): Promise<string> => {
  const { docId, sheetId } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to delete a sheet", {
      field: "docId",
    });
  }

  if (sheetId === undefined || sheetId === null) {
    return failTool(
      "MISSING_SHEET_ID",
      "sheetId is required to delete a sheet",
      { field: "sheetId" },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_deleteSheet] Starting:", { docId, sheetId });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Check if sheet exists
        const sheet = spreadsheet.sheets.find((s) => s.sheetId === sheetId);
        if (!sheet) {
          return failTool("SHEET_NOT_FOUND", `Sheet ${sheetId} not found`, {
            sheetId,
          });
        }

        // Don't allow deleting the last sheet
        if (spreadsheet.sheets.length <= 1) {
          return failTool(
            "CANNOT_DELETE_LAST_SHEET",
            "Cannot delete the last sheet in the document",
            { sheetId },
          );
        }

        const sheetTitle = sheet.title;
        spreadsheet.deleteSheet(sheetId);

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_deleteSheet] Completed:", {
          docId,
          sheetId,
          sheetTitle,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully deleted sheet "${sheetTitle}"`,
          sheetId,
          sheetTitle,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_deleteSheet] Error:", error);
      return failTool(
        "DELETE_SHEET_FAILED",
        error instanceof Error ? error.message : "Failed to delete sheet",
      );
    }
  });
};

/**
 * The spreadsheet_deleteSheet tool for LangChain
 */
export const spreadsheetDeleteSheetTool = tool(handleSpreadsheetDeleteSheet, {
  name: "spreadsheet_deleteSheet",
  description: `Delete a sheet from the spreadsheet.

OVERVIEW:
This tool permanently removes a sheet/tab from the document.

WHEN TO USE THIS TOOL:
- Removing unwanted sheets
- Cleaning up temporary sheets
- Reorganizing a workbook

IMPORTANT:
- Cannot delete the last remaining sheet
- All data in the sheet will be permanently lost
- Charts and tables on the sheet will also be deleted

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID to delete (required)

EXAMPLE:
  docId: "abc123"
  sheetId: 2`,
  schema: SpreadsheetDeleteSheetSchema,
});

/**
 * Handler for the spreadsheet_deleteChart tool
 */
const handleSpreadsheetDeleteChart = async (
  input: SpreadsheetDeleteChartInput,
): Promise<string> => {
  const { docId, chartId } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to delete a chart", {
      field: "docId",
    });
  }

  if (!chartId) {
    return failTool(
      "MISSING_CHART_ID",
      "chartId is required to delete a chart",
      { field: "chartId" },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_deleteChart] Starting:", { docId, chartId });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Check if chart exists
        const charts = spreadsheet.charts || [];
        const chart = charts.find((c) => String(c.chartId) === chartId);
        if (!chart) {
          return failTool("CHART_NOT_FOUND", `Chart "${chartId}" not found`, {
            chartId,
          });
        }

        spreadsheet.deleteChart(chartId);

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_deleteChart] Completed:", {
          docId,
          chartId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully deleted chart`,
          chartId,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_deleteChart] Error:", error);
      return failTool(
        "DELETE_CHART_FAILED",
        error instanceof Error ? error.message : "Failed to delete chart",
      );
    }
  });
};

/**
 * The spreadsheet_deleteChart tool for LangChain
 */
export const spreadsheetDeleteChartTool = tool(handleSpreadsheetDeleteChart, {
  name: "spreadsheet_deleteChart",
  description: `Delete a chart from the spreadsheet.

OVERVIEW:
This tool permanently removes a chart from the document.

WHEN TO USE THIS TOOL:
- Removing unwanted charts
- Replacing a chart with a new one
- Cleaning up visualizations

PARAMETERS:
- docId: The document ID (required)
- chartId: The chart ID to delete (required)

EXAMPLE:
  docId: "abc123"
  chartId: "chart_abc123"`,
  schema: SpreadsheetDeleteChartSchema,
});

/**
 * Handler for the spreadsheet_deleteTable tool
 */
const handleSpreadsheetDeleteTable = async (
  input: SpreadsheetDeleteTableInput,
): Promise<string> => {
  const { docId, sheetId, tableId } = input;

  if (!docId) {
    return failTool("MISSING_DOC_ID", "docId is required to delete a table", {
      field: "docId",
    });
  }

  if (!tableId) {
    return failTool(
      "MISSING_TABLE_ID",
      "tableId is required to delete a table",
      { field: "tableId" },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_deleteTable] Starting:", {
      docId,
      sheetId,
      tableId,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Find the table
        const tables = spreadsheet.tables || [];
        const table = tables.find(
          (t) => t.id === tableId && t.sheetId === sheetId,
        );
        if (!table) {
          return failTool(
            "TABLE_NOT_FOUND",
            `Table "${tableId}" not found on sheet ${sheetId}`,
            { tableId, sheetId },
          );
        }

        spreadsheet.removeTable(table);

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_deleteTable] Completed:", {
          docId,
          sheetId,
          tableId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully deleted table`,
          tableId,
          sheetId,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_deleteTable] Error:", error);
      return failTool(
        "DELETE_TABLE_FAILED",
        error instanceof Error ? error.message : "Failed to delete table",
      );
    }
  });
};

/**
 * The spreadsheet_deleteTable tool for LangChain
 */
export const spreadsheetDeleteTableTool = tool(handleSpreadsheetDeleteTable, {
  name: "spreadsheet_deleteTable",
  description: `Delete a table from the spreadsheet.

OVERVIEW:
This tool removes a table definition from the document. The underlying cell data remains; only the table formatting and structure is removed.

WHEN TO USE THIS TOOL:
- Converting a table back to plain cells
- Removing table formatting
- Reorganizing data structure

NOTE: This removes the table definition only. Cell values and basic formatting remain intact.

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID containing the table (required)
- tableId: The table ID to delete (required)

EXAMPLE:
  docId: "abc123"
  sheetId: 1
  tableId: "table_abc123"`,
  schema: SpreadsheetDeleteTableSchema,
});

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
 * Handler for the spreadsheet_createDataValidation tool
 */
const handleSpreadsheetCreateDataValidation = async (
  input: SpreadsheetCreateDataValidationInput,
): Promise<string> => {
  const {
    docId,
    sheetId,
    range,
    validationType,
    allowBlank = true,
    showDropdown = true,
    inputTitle,
    inputMessage,
    errorStyle = "stop",
    errorTitle,
    errorMessage,
  } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to create data validation",
      { field: "docId" },
    );
  }

  if (!range) {
    return failTool("MISSING_RANGE", "range is required for data validation", {
      field: "range",
    });
  }

  if (!validationType) {
    return failTool("MISSING_VALIDATION_TYPE", "validationType is required", {
      field: "validationType",
    });
  }

  // Validate list type has values
  if (
    validationType === "list" &&
    !input.listValues?.length &&
    !input.listRange
  ) {
    return failTool(
      "MISSING_LIST_VALUES",
      "listValues or listRange is required for list validation",
      { field: "listValues" },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_createDataValidation] Starting:", {
      docId,
      sheetId,
      range,
      validationType,
    });

    try {
      const selection = addressToSelection(range);
      if (!selection?.range) {
        return failTool("INVALID_RANGE", `Invalid range: ${range}`, { range });
      }

      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        const validationId = uuidString();
        const conditionType = mapValidationCondition(
          validationType,
          input.numberOperator || input.dateOperator,
        );
        const conditionValues = buildConditionValues(input);

        const rule: DataValidationRuleRecord = {
          id: validationId,
          ranges: [
            {
              sheetId,
              startRowIndex: selection.range.startRowIndex,
              endRowIndex: selection.range.endRowIndex,
              startColumnIndex: selection.range.startColumnIndex,
              endColumnIndex: selection.range.endColumnIndex,
            },
          ],
          condition: {
            type: conditionType,
            values: conditionValues,
          },
          allowBlank,
          displayStyle: showDropdown ? "arrow" : "plain",
          inputMessage:
            inputTitle || inputMessage
              ? { title: inputTitle, message: inputMessage }
              : undefined,
          alert:
            errorTitle || errorMessage
              ? {
                  style: errorStyle,
                  message: { title: errorTitle, message: errorMessage },
                }
              : { style: errorStyle },
        };

        spreadsheet.createDataValidationRule(rule);

        // trigger calc?
        await spreadsheet.calculatePending();

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_createDataValidation] Completed:", {
          docId,
          validationId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully created ${validationType} validation on ${range}`,
          validationId,
          range,
          validationType,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_createDataValidation] Error:", error);
      return failTool(
        "CREATE_DATA_VALIDATION_FAILED",
        error instanceof Error
          ? error.message
          : "Failed to create data validation",
      );
    }
  });
};

/**
 * The spreadsheet_createDataValidation tool for LangChain
 */
export const spreadsheetCreateDataValidationTool = tool(
  handleSpreadsheetCreateDataValidation,
  {
    name: "spreadsheet_createDataValidation",
    description: `Create data validation rules for cells.

OVERVIEW:
This tool adds input validation to cells, such as dropdown lists, number ranges, or custom formulas.

VALIDATION TYPES:

1. LIST - Dropdown with predefined values:
   validationType: "list"
   listValues: ["Option1", "Option2", "Option3"]
   OR
   listRange: "Sheet2!A1:A10"  (reference another range)

2. NUMBER - Numeric validation:
   validationType: "number" (decimals allowed) or "wholeNumber" (integers only)
   numberOperator: "between" | "greaterThan" | "lessThan" | etc.
   minValue: 0
   maxValue: 100

3. DATE - Date validation:
   validationType: "date"
   dateOperator: "between" | "after" | "before" | etc.
   minDate: "2024-01-01"
   maxDate: "2024-12-31"

4. CUSTOM - Formula-based validation:
   validationType: "custom"
   customFormula: "=A1>0"  (must return TRUE for valid values)

COMMON OPTIONS:
- allowBlank: Allow empty cells (default: true)
- showDropdown: Show dropdown arrow for lists (default: true)
- errorStyle: "stop" (reject) | "warning" | "information"
- errorTitle/errorMessage: Custom error dialog
- inputTitle/inputMessage: Help text when cell is selected

IMPORTANT: Use EXACTLY the range the user specifies. If they say "E1", use "E1" - do NOT expand to "E1:E100".

EXAMPLES:

Example 1 — Dropdown for a single cell:
  docId: "abc123"
  sheetId: 1
  range: "E1"
  validationType: "list"
  listValues: ["Option1", "Option2"]

Example 2 — Dropdown for a column range:
  docId: "abc123"
  sheetId: 1
  range: "B2:B50"
  validationType: "list"
  listValues: ["Pending", "In Progress", "Done"]

Example 3 — Number validation:
  docId: "abc123"
  sheetId: 1
  range: "C5"
  validationType: "number"
  numberOperator: "between"
  minValue: 1
  maxValue: 100`,
    schema: SpreadsheetCreateDataValidationSchema,
  },
);

/**
 * Handler for the spreadsheet_updateDataValidation tool
 */
const handleSpreadsheetUpdateDataValidation = async (
  input: SpreadsheetUpdateDataValidationInput,
): Promise<string> => {
  const { docId, sheetId, validationId } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to update data validation",
      { field: "docId" },
    );
  }

  if (!validationId) {
    return failTool(
      "MISSING_VALIDATION_ID",
      "validationId is required to update data validation",
      { field: "validationId" },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_updateDataValidation] Starting:", {
      docId,
      sheetId,
      validationId,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Find existing rule
        const dataValidations =
          (spreadsheet.dataValidations as DataValidationRuleRecord[]) || [];
        const existingRule = dataValidations.find(
          (r) => String(r.id) === validationId,
        );

        if (!existingRule) {
          return failTool(
            "VALIDATION_NOT_FOUND",
            `Data validation rule "${validationId}" not found`,
            { validationId },
          );
        }

        // Build updated rule
        const updatedRule: DataValidationRuleRecord = { ...existingRule };

        // Update range if provided
        if (input.range) {
          const selection = addressToSelection(input.range);
          if (selection?.range) {
            updatedRule.ranges = [
              {
                sheetId,
                startRowIndex: selection.range.startRowIndex,
                endRowIndex: selection.range.endRowIndex,
                startColumnIndex: selection.range.startColumnIndex,
                endColumnIndex: selection.range.endColumnIndex,
              },
            ];
          }
        }

        // Update condition if validation type changed
        if (input.validationType) {
          const conditionType = mapValidationCondition(
            input.validationType,
            input.numberOperator || input.dateOperator,
          );
          const conditionValues = buildConditionValues(input);
          updatedRule.condition = {
            type: conditionType,
            values: conditionValues,
          };
        }

        // Update other properties
        if (input.allowBlank !== undefined) {
          updatedRule.allowBlank = input.allowBlank;
        }
        if (input.showDropdown !== undefined) {
          updatedRule.displayStyle = input.showDropdown ? "arrow" : "plain";
        }
        if (
          input.inputTitle !== undefined ||
          input.inputMessage !== undefined
        ) {
          updatedRule.inputMessage = {
            title: input.inputTitle ?? existingRule.inputMessage?.title,
            message: input.inputMessage ?? existingRule.inputMessage?.message,
          };
        }
        if (
          input.errorStyle !== undefined ||
          input.errorTitle !== undefined ||
          input.errorMessage !== undefined
        ) {
          updatedRule.alert = {
            style: input.errorStyle ?? existingRule.alert?.style ?? "stop",
            message: {
              title: input.errorTitle ?? existingRule.alert?.message?.title,
              message:
                input.errorMessage ?? existingRule.alert?.message?.message,
            },
          };
        }

        spreadsheet.updateDataValidationRule(updatedRule, existingRule);

        // trigger calc?
        await spreadsheet.calculatePending();

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_updateDataValidation] Completed:", {
          docId,
          validationId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully updated data validation`,
          validationId,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_updateDataValidation] Error:", error);
      return failTool(
        "UPDATE_DATA_VALIDATION_FAILED",
        error instanceof Error
          ? error.message
          : "Failed to update data validation",
      );
    }
  });
};

/**
 * The spreadsheet_updateDataValidation tool for LangChain
 */
export const spreadsheetUpdateDataValidationTool = tool(
  handleSpreadsheetUpdateDataValidation,
  {
    name: "spreadsheet_updateDataValidation",
    description: `Update an existing data validation rule.

OVERVIEW:
This tool modifies an existing data validation rule's properties.

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (required)
- validationId: The validation rule ID to update (required)
- All other parameters from createDataValidation are optional

EXAMPLE:
  docId: "abc123"
  sheetId: 1
  validationId: "validation_xyz"
  listValues: ["New Option 1", "New Option 2"]
  errorMessage: "Updated error message"`,
    schema: SpreadsheetUpdateDataValidationSchema,
  },
);

/**
 * Handler for the spreadsheet_deleteDataValidation tool
 */
const handleSpreadsheetDeleteDataValidation = async (
  input: SpreadsheetDeleteDataValidationInput,
): Promise<string> => {
  const { docId, sheetId, validationId } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to delete data validation",
      { field: "docId" },
    );
  }

  if (!validationId) {
    return failTool(
      "MISSING_VALIDATION_ID",
      "validationId is required to delete data validation",
      { field: "validationId" },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_deleteDataValidation] Starting:", {
      docId,
      sheetId,
      validationId,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Find existing rule
        const dataValidations =
          (spreadsheet.dataValidations as DataValidationRuleRecord[]) || [];
        const existingRule = dataValidations.find(
          (r) => String(r.id) === validationId,
        );

        if (!existingRule) {
          return failTool(
            "VALIDATION_NOT_FOUND",
            `Data validation rule "${validationId}" not found`,
            { validationId },
          );
        }

        spreadsheet.deleteDataValidationRule(existingRule);

        // trigger calc?
        await spreadsheet.calculatePending();

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_deleteDataValidation] Completed:", {
          docId,
          validationId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully deleted data validation`,
          validationId,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_deleteDataValidation] Error:", error);
      return failTool(
        "DELETE_DATA_VALIDATION_FAILED",
        error instanceof Error
          ? error.message
          : "Failed to delete data validation",
      );
    }
  });
};

/**
 * The spreadsheet_deleteDataValidation tool for LangChain
 */
export const spreadsheetDeleteDataValidationTool = tool(
  handleSpreadsheetDeleteDataValidation,
  {
    name: "spreadsheet_deleteDataValidation",
    description: `Delete a data validation rule.

OVERVIEW:
This tool removes a data validation rule from the spreadsheet.

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (required)
- validationId: The validation rule ID to delete (required)

EXAMPLE:
  docId: "abc123"
  sheetId: 1
  validationId: "validation_xyz"`,
    schema: SpreadsheetDeleteDataValidationSchema,
  },
);

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

/**
 * Build CellFormat from simplified format options
 */
const buildConditionalFormat = (input: {
  backgroundColor?: string;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
}): CellFormat => {
  const format: CellFormat = {};

  if (input.backgroundColor) {
    format.backgroundColor = input.backgroundColor;
  }

  if (
    input.textColor ||
    input.bold !== undefined ||
    input.italic !== undefined
  ) {
    format.textFormat = {
      ...(input.textColor ? { color: input.textColor } : {}),
      ...(input.bold !== undefined ? { bold: input.bold } : {}),
      ...(input.italic !== undefined ? { italic: input.italic } : {}),
    };
  }

  return format;
};

/**
 * Handler for the spreadsheet_createConditionalFormat tool
 */
const handleSpreadsheetCreateConditionalFormat = async (
  input: SpreadsheetCreateConditionalFormatInput,
): Promise<string> => {
  const {
    docId,
    sheetId,
    range,
    ruleType,
    conditionType,
    conditionValues,
    customFormula,
    colorScaleType,
    minColor,
    midColor,
    maxColor,
    topBottomType,
    rank,
    isPercent,
    duplicateType,
    backgroundColor,
    textColor,
    bold,
    italic,
  } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to create conditional format",
      { field: "docId" },
    );
  }

  if (!range) {
    return failTool(
      "MISSING_RANGE",
      "range is required for conditional format",
      { field: "range" },
    );
  }

  if (!ruleType) {
    return failTool("MISSING_RULE_TYPE", "ruleType is required", {
      field: "ruleType",
    });
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_createConditionalFormat] Starting:", {
      docId,
      sheetId,
      range,
      ruleType,
    });

    try {
      const selection = addressToSelection(range);
      if (!selection?.range) {
        return failTool("INVALID_RANGE", `Invalid range: ${range}`, { range });
      }

      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool(
            "NO_CFRULE_EXISTS",
            "Conditional format rule ID does not exist",
          );
        }

        const spreadsheet = createSpreadsheetInterface(data);
        const ruleId = uuidString();

        const baseRule: ConditionalFormatRule = {
          id: ruleId,
          ranges: [
            {
              sheetId,
              startRowIndex: selection.range.startRowIndex,
              endRowIndex: selection.range.endRowIndex,
              startColumnIndex: selection.range.startColumnIndex,
              endColumnIndex: selection.range.endColumnIndex,
            },
          ],
        };

        let rule: ConditionalFormatRule;

        if (ruleType === "condition") {
          if (!conditionType) {
            return failTool(
              "MISSING_CONDITION_TYPE",
              "conditionType is required for condition rule",
              { field: "conditionType" },
            );
          }

          const format = buildConditionalFormat({
            backgroundColor,
            textColor,
            bold,
            italic,
          });

          rule = {
            ...baseRule,
            booleanRule: {
              condition: {
                type: mapConditionalFormatCondition(conditionType),
                values:
                  conditionType === "custom" && customFormula
                    ? [{ userEnteredValue: customFormula }]
                    : conditionValues?.map((v) => ({
                        userEnteredValue: String(v),
                      })),
              },
              format,
            },
          };
        } else if (ruleType === "colorScale") {
          const minPointColor = minColor || "#FF0000";
          const maxPointColor = maxColor || "#00FF00";
          const midPointColor =
            colorScaleType === "3color" ? midColor || "#FFFF00" : undefined;

          rule = {
            ...baseRule,
            gradientRule: {
              minpoint: {
                color: minPointColor,
                type: "MIN",
              },
              ...(colorScaleType === "3color" && midPointColor
                ? {
                    midpoint: {
                      color: midPointColor,
                      type: "PERCENTILE",
                      value: 50,
                    },
                  }
                : {}),
              maxpoint: {
                color: maxPointColor,
                type: "MAX",
              },
            },
          };
        } else if (ruleType === "topBottom") {
          if (!topBottomType || rank === undefined) {
            return failTool(
              "MISSING_TOP_BOTTOM_PARAMS",
              "topBottomType and rank are required for topBottom rule",
              { field: "topBottomType" },
            );
          }

          const format = buildConditionalFormat({
            backgroundColor,
            textColor,
            bold,
            italic,
          });

          rule = {
            ...baseRule,
            topBottomRule: {
              type: topBottomType === "top" ? "TOP" : "BOTTOM",
              rank,
              isPercent: isPercent ?? false,
              format,
            },
          };
        } else if (ruleType === "duplicates") {
          if (!duplicateType) {
            return failTool(
              "MISSING_DUPLICATE_TYPE",
              "duplicateType is required for duplicates rule",
              { field: "duplicateType" },
            );
          }

          const format = buildConditionalFormat({
            backgroundColor,
            textColor,
            bold,
            italic,
          });

          rule = {
            ...baseRule,
            distinctRule: {
              type: duplicateType === "duplicate" ? "DUPLICATE" : "UNIQUE",
              format,
            },
          };
        } else {
          return failTool(
            "INVALID_RULE_TYPE",
            `Unknown rule type: ${ruleType}`,
            {
              ruleType,
            },
          );
        }

        spreadsheet.createConditionalFormattingRule(rule);

        // trigger calc?
        await spreadsheet.calculatePending();

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_createConditionalFormat] Completed:", {
          docId,
          ruleId,
          ruleType,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully created ${ruleType} conditional format on ${range}`,
          ruleId,
          range,
          ruleType,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_createConditionalFormat] Error:", error);
      return failTool(
        "CREATE_CONDITIONAL_FORMAT_FAILED",
        error instanceof Error
          ? error.message
          : "Failed to create conditional format",
      );
    }
  });
};

/**
 * The spreadsheet_createConditionalFormat tool for LangChain
 */
export const spreadsheetCreateConditionalFormatTool = tool(
  handleSpreadsheetCreateConditionalFormat,
  {
    name: "spreadsheet_createConditionalFormat",
    description: `Create conditional formatting rules for cells.

OVERVIEW:
This tool applies visual formatting based on cell values or conditions.

RULE TYPES:

1. CONDITION - Format cells based on value conditions:
   ruleType: "condition"
   conditionType: "greaterThan" | "lessThan" | "between" | "equal" | "textContains" | "blank" | "custom"
   conditionValues: [50] or [10, 90] for between
   customFormula: "=A1>B1" (for custom type)
   backgroundColor: "#FFCCCC"

2. COLOR SCALE - Gradient colors based on values:
   ruleType: "colorScale"
   colorScaleType: "2color" or "3color"
   minColor: "#FF0000" (red for low)
   midColor: "#FFFF00" (yellow for mid, only for 3color)
   maxColor: "#00FF00" (green for high)

3. TOP/BOTTOM - Highlight top or bottom values:
   ruleType: "topBottom"
   topBottomType: "top" or "bottom"
   rank: 10
   isPercent: true (top 10%) or false (top 10 items)
   backgroundColor: "#90EE90"

4. DUPLICATES - Highlight duplicate or unique values:
   ruleType: "duplicates"
   duplicateType: "duplicate" or "unique"
   backgroundColor: "#FFB6C1"

FORMAT OPTIONS (for condition, topBottom, duplicates):
- backgroundColor: Hex color (e.g., "#FFCCCC")
- textColor: Hex color (e.g., "#FF0000")
- bold: true/false
- italic: true/false

IMPORTANT: Use EXACTLY the range the user specifies.

EXAMPLES:

Example 1 — Highlight cells > 100:
  docId: "abc123"
  sheetId: 1
  range: "C2:C50"
  ruleType: "condition"
  conditionType: "greaterThan"
  conditionValues: [100]
  backgroundColor: "#FFCCCC"

Example 2 — 3-color scale (red → yellow → green):
  docId: "abc123"
  sheetId: 1
  range: "D2:D50"
  ruleType: "colorScale"
  colorScaleType: "3color"
  minColor: "#FF0000"
  midColor: "#FFFF00"
  maxColor: "#00FF00"

Example 3 — Highlight top 10%:
  docId: "abc123"
  sheetId: 1
  range: "E2:E50"
  ruleType: "topBottom"
  topBottomType: "top"
  rank: 10
  isPercent: true
  backgroundColor: "#90EE90"

Example 4 — Highlight duplicates:
  docId: "abc123"
  sheetId: 1
  range: "A2:A100"
  ruleType: "duplicates"
  duplicateType: "duplicate"
  backgroundColor: "#FFB6C1"`,
    schema: SpreadsheetCreateConditionalFormatSchema,
  },
);

/**
 * Handler for the spreadsheet_updateConditionalFormat tool
 */
const handleSpreadsheetUpdateConditionalFormat = async (
  input: SpreadsheetUpdateConditionalFormatInput,
): Promise<string> => {
  const { docId, sheetId, ruleId } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to update conditional format",
      { field: "docId" },
    );
  }

  if (!ruleId) {
    return failTool(
      "MISSING_RULE_ID",
      "ruleId is required to update conditional format",
      { field: "ruleId" },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_updateConditionalFormat] Starting:", {
      docId,
      sheetId,
      ruleId,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool(
            "NO_CFRULE_EXISTS",
            "Conditional format rule ID does not exist",
          );
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Find existing rule
        const conditionalFormats =
          (spreadsheet.conditionalFormats as ConditionalFormatRule[]) || [];
        const existingRule = conditionalFormats.find(
          (r) => String(r.id) === ruleId,
        );

        if (!existingRule) {
          return failTool(
            "RULE_NOT_FOUND",
            `Conditional format rule "${ruleId}" not found`,
            { ruleId },
          );
        }

        // Build updated rule
        const updatedRule: ConditionalFormatRule = { ...existingRule };

        // Update range if provided
        if (input.range) {
          const selection = addressToSelection(input.range);
          if (selection?.range) {
            updatedRule.ranges = [
              {
                sheetId,
                startRowIndex: selection.range.startRowIndex,
                endRowIndex: selection.range.endRowIndex,
                startColumnIndex: selection.range.startColumnIndex,
                endColumnIndex: selection.range.endColumnIndex,
              },
            ];
          }
        }

        // Update enabled status
        if (input.enabled !== undefined) {
          updatedRule.enabled = input.enabled;
        }

        // Update format properties if provided
        if (
          input.backgroundColor !== undefined ||
          input.textColor !== undefined ||
          input.bold !== undefined ||
          input.italic !== undefined
        ) {
          const format = buildConditionalFormat({
            backgroundColor: input.backgroundColor,
            textColor: input.textColor,
            bold: input.bold,
            italic: input.italic,
          });

          if (updatedRule.booleanRule) {
            updatedRule.booleanRule = {
              ...updatedRule.booleanRule,
              format: format as typeof updatedRule.booleanRule.format,
            };
          } else if (updatedRule.topBottomRule) {
            updatedRule.topBottomRule = {
              ...updatedRule.topBottomRule,
              format: format as typeof updatedRule.topBottomRule.format,
            };
          } else if (updatedRule.distinctRule) {
            updatedRule.distinctRule = {
              ...updatedRule.distinctRule,
              format: format as typeof updatedRule.distinctRule.format,
            };
          }
        }

        spreadsheet.updateConditionalFormattingRule(updatedRule, existingRule);

        // trigger calc?
        await spreadsheet.calculatePending();

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_updateConditionalFormat] Completed:", {
          docId,
          ruleId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully updated conditional format`,
          ruleId,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_updateConditionalFormat] Error:", error);
      return failTool(
        "UPDATE_CONDITIONAL_FORMAT_FAILED",
        error instanceof Error
          ? error.message
          : "Failed to update conditional format",
      );
    }
  });
};

/**
 * The spreadsheet_updateConditionalFormat tool for LangChain
 */
export const spreadsheetUpdateConditionalFormatTool = tool(
  handleSpreadsheetUpdateConditionalFormat,
  {
    name: "spreadsheet_updateConditionalFormat",
    description: `Update an existing conditional formatting rule.

OVERVIEW:
This tool modifies an existing conditional formatting rule's properties.

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (required)
- ruleId: The conditional format rule ID to update (required)
- range: New range for the rule
- enabled: Enable or disable the rule
- backgroundColor/textColor/bold/italic: Update format properties

EXAMPLE:
  docId: "abc123"
  sheetId: 1
  ruleId: "rule_xyz"
  backgroundColor: "#CCFFCC"
  enabled: true`,
    schema: SpreadsheetUpdateConditionalFormatSchema,
  },
);

/**
 * Handler for the spreadsheet_deleteConditionalFormat tool
 */
const handleSpreadsheetDeleteConditionalFormat = async (
  input: SpreadsheetDeleteConditionalFormatInput,
): Promise<string> => {
  const { docId, sheetId, ruleId } = input;

  if (!docId) {
    return failTool(
      "MISSING_DOC_ID",
      "docId is required to delete conditional format",
      { field: "docId" },
    );
  }

  if (!ruleId) {
    return failTool(
      "MISSING_RULE_ID",
      "ruleId is required to delete conditional format",
      { field: "ruleId" },
    );
  }

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_deleteConditionalFormat] Starting:", {
      docId,
      sheetId,
      ruleId,
    });

    try {
      const { doc, close } = await getShareDBDocument(docId);

      try {
        const data = doc.data as ShareDBSpreadsheetDoc | null;

        if (!data) {
          return failTool("NO_DOCUMENT_DATA", "Document has no data");
        }

        const spreadsheet = createSpreadsheetInterface(data);

        // Find existing rule
        const conditionalFormats =
          (spreadsheet.conditionalFormats as ConditionalFormatRule[]) || [];
        const existingRule = conditionalFormats.find(
          (r) => String(r.id) === ruleId,
        );

        if (!existingRule) {
          return failTool(
            "RULE_NOT_FOUND",
            `Conditional format rule "${ruleId}" not found`,
            { ruleId },
          );
        }

        spreadsheet.deleteConditionalFormattingRule(existingRule);

        // trigger calc?
        await spreadsheet.calculatePending();

        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_deleteConditionalFormat] Completed:", {
          docId,
          ruleId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully deleted conditional format`,
          ruleId,
        });
      } finally {
        queueMicrotask(() => {
          close();
        });
      }
    } catch (error) {
      console.error("[spreadsheet_deleteConditionalFormat] Error:", error);
      return failTool(
        "DELETE_CONDITIONAL_FORMAT_FAILED",
        error instanceof Error
          ? error.message
          : "Failed to delete conditional format",
      );
    }
  });
};

/**
 * The spreadsheet_deleteConditionalFormat tool for LangChain
 */
export const spreadsheetDeleteConditionalFormatTool = tool(
  handleSpreadsheetDeleteConditionalFormat,
  {
    name: "spreadsheet_deleteConditionalFormat",
    description: `Delete a conditional formatting rule.

OVERVIEW:
This tool removes a conditional formatting rule from the spreadsheet.

PARAMETERS:
- docId: The document ID (required)
- sheetId: The sheet ID (required)
- ruleId: The conditional format rule ID to delete (required)

EXAMPLE:
  docId: "abc123"
  sheetId: 1
  ruleId: "rule_xyz"`,
    schema: SpreadsheetDeleteConditionalFormatSchema,
  },
);

/**
 * All available tools for the spreadsheet assistant
 */
export const spreadsheetTools = [
  spreadsheetChangeBatchTool,
  spreadsheetCreateSheetTool,
  spreadsheetUpdateSheetTool,
  spreadsheetFormatRangeTool,
  spreadsheetInsertRowsTool,
  spreadsheetInsertColumnsTool,
  spreadsheetQueryRangeTool,
  spreadsheetSetIterativeModeTool,
  spreadsheetReadDocumentTool,
  spreadsheetSetRowColDimensionsTool,
  spreadsheetDuplicateSheetTool,
  spreadsheetDeleteCellsTool,
  spreadsheetClearFormattingTool,
  spreadsheetApplyFillTool,
  spreadsheetInsertNoteTool,
  spreadsheetDeleteRowsTool,
  spreadsheetDeleteColumnsTool,
  spreadsheetCreateTableTool,
  spreadsheetUpdateTableTool,
  spreadsheetCreateChartTool,
  spreadsheetUpdateChartTool,
  spreadsheetDeleteSheetTool,
  spreadsheetDeleteChartTool,
  spreadsheetDeleteTableTool,
  spreadsheetCreateDataValidationTool,
  spreadsheetUpdateDataValidationTool,
  spreadsheetDeleteDataValidationTool,
  spreadsheetCreateConditionalFormatTool,
  spreadsheetUpdateConditionalFormatTool,
  spreadsheetDeleteConditionalFormatTool,
];
