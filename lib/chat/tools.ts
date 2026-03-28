import { tool } from "@langchain/core/tools";
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
  type SpreadsheetCreateSheetInput,
  SpreadsheetCreateSheetSchema,
  type SpreadsheetDuplicateSheetInput,
  SpreadsheetDuplicateSheetSchema,
  type SpreadsheetFormatRangeInput,
  SpreadsheetFormatRangeSchema,
  type SpreadsheetInsertNoteInput,
  SpreadsheetInsertNoteSchema,
  type SpreadsheetModifyRowsColsInput,
  SpreadsheetModifyRowsColsSchema,
  type SpreadsheetQueryRangeInput,
  SpreadsheetQueryRangeSchema,
  type SpreadsheetSetIterativeModeInput,
  SpreadsheetSetIterativeModeSchema,
  type SpreadsheetUpdateSheetInput,
  SpreadsheetUpdateSheetSchema,
  type SpreadsheetGetSheetMetadataInput,
  SpreadsheetGetSheetMetadataSchema,
  type SpreadsheetReadDocumentInput,
  SpreadsheetReadDocumentSchema,
  type SpreadsheetGetRowColMetadataInput,
  SpreadsheetGetRowColMetadataSchema,
  type SpreadsheetSetRowColDimensionsInput,
  SpreadsheetSetRowColDimensionsSchema,
  type SpreadsheetDeleteSheetInput,
  SpreadsheetDeleteSheetSchema,
  // Consolidated schemas
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
          formula: formula as string | undefined,
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
const ENABLE_DOCUMENT_WRITE_LOCK = false;

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
  description: `Write data to a rectangular range.

RULES:
- range: A1 notation (e.g., "A1:C3"). Dimensions MUST match cells array.
- cells: 2D array of rows. Each cell: {value?, formula?, citation?} or {} to skip.
- Write values BEFORE formulas that reference them.
- Batch multiple rows per call. For sequences, use auto-fill instead.
- citation: URL with optional ?excerpt= for source tracking.
- To display formula as text: {"value": "'=SUM(4,4)"} (leading apostrophe)

EXAMPLE:
range: "A1:C3"
cells: [
  [{"value": "Item"}, {"value": "Qty"}, {"value": "Total"}],
  [{"value": "Apples"}, {"value": 10}, {"formula": "=B2*2"}],
  [{"value": "Sum"}, {}, {"formula": "=SUM(C2:C2)"}]
]`,
  schema: SpreadsheetChangeBatchSchema,
});

/**
 * Handler for the spreadsheet_createSheet tool
 */
const handleSpreadsheetCreateSheet = async (
  input: SpreadsheetCreateSheetInput,
): Promise<string> => {
  const {
    docId,
    activeSheetId,
    title,
    sheetId: inputSheetId,
    hidden,
    merges,
    hideRows,
    showRows,
    hideCols,
    showCols,
    frozenRowCount,
    frozenColumnCount,
    showGridLines,
    tabColor,
  } = input;

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
      title,
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

        const spreadsheet = createSpreadsheetInterface(data, false);

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
        if (hidden !== undefined) {
          spec.hidden = hidden;
        }
        // Convert A1 notation merges to GridRange format
        if (merges && merges.length > 0) {
          spec.merges = merges
            .map((a1Range: string) => {
              const selection = addressToSelection(a1Range);
              if (!selection?.range) {
                return null;
              }
              return selection.range;
            })
            .filter(Boolean);
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
        // Convert hideCols/showCols to columnMetadata (column letters like "A", "B", "AA")
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
          // tabColor can be a hex string or { theme, tint } object
          spec.tabColor = tabColor;
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
  description: `Create a new sheet (tab).

PARAMS:
- title: sheet name
- frozenRowCount, frozenColumnCount: freeze panes
- tabColor: "#4285F4" or {theme: 4, tint: 0.4}
- merges: ["A1:C1"] for merged cells
- hideRows: [2,3], hideCols: ["A","B"]

EXAMPLE: title: "Sales Report", frozenRowCount: 1`,
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
  const {
    docId,
    sheetId,
    unsetFields,
    title,
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
  } = input;

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
      title,
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

        const spreadsheet = createSpreadsheetInterface(data, false);

        // Build sheet spec for updateSheet
        const spec: Partial<Sheet> = {};

        if (title !== undefined) {
          spec.title = title;
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
            const rangesToRemove = removeMerges
              .map((a1Range: string) => {
                const selection = addressToSelection(a1Range);
                return selection?.range ?? null;
              })
              .filter((s) => !isNil(s));

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

          // Add new merges (skip if they intersect with remaining merges)
          if (merges?.length) {
            const newMerges = merges
              .map((a1Range: string) => {
                const selection = addressToSelection(a1Range);
                if (!selection?.range) {
                  return null;
                }
                return selection.range;
              })
              .filter((s) => !isNil(s))
              .filter((newMerge) => {
                const intersectsExisting = currentMerges.some((existing) =>
                  areaIntersects(existing, newMerge),
                );
                if (intersectsExisting) {
                  console.warn(
                    `[spreadsheet_updateSheet] Skipping merge that intersects existing merge`,
                  );
                }
                return !intersectsExisting;
              });
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
            (spec as Record<string, unknown>)[field] = null;
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
  description: `Update existing sheet properties.

PARAMS:
- title: rename sheet
- tabColor: "#4285F4" or null to remove
- frozenRowCount, frozenColumnCount
- merges: ["A1:C1"], removeMerges: ["A1:C1"]
- hideRows: [2,3], showRows: [2,3]
- hideCols: ["A"], showCols: ["A"]
- hidden: true/false

EXAMPLE: sheetId: 1, title: "Q1 Sales", frozenRowCount: 1`,
  schema: SpreadsheetUpdateSheetSchema,
});

/**
 * Handler for the spreadsheet_getSheetMetadata tool
 */
const handleSpreadsheetGetSheetMetadata = async (
  input: SpreadsheetGetSheetMetadataInput,
): Promise<string> => {
  const { docId, sheetId: inputSheetId } = input;

  if (!docId) {
    return JSON.stringify({
      success: false,
      error: "docId is required to get sheet metadata",
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

      const spreadsheet = createSpreadsheetInterface(data, false);
      const sheetId = inputSheetId ?? 1;
      const sheet = spreadsheet.sheets.find((s) => s.sheetId === sheetId);

      if (!sheet) {
        return JSON.stringify({
          success: false,
          error: `Sheet with ID ${sheetId} not found`,
        });
      }

      // Convert merges to A1 notation
      const mergesA1 = (sheet.merges ?? []).map((merge) => {
        return selectionToAddress({ range: merge });
      });

      // Build metadata response (excluding row/column metadata)
      const metadata = {
        sheetId: sheet.sheetId,
        title: sheet.title,
        hidden: sheet.hidden ?? false,
        frozenRowCount: sheet.frozenRowCount ?? 0,
        frozenColumnCount: sheet.frozenColumnCount ?? 0,
        showGridLines: sheet.showGridLines ?? true,
        tabColor: sheet.tabColor ?? null,
        merges: mergesA1,
        index: sheet.index,
      };

      console.log("[spreadsheet_getSheetMetadata] Completed:", {
        docId,
        sheetId,
      });

      return JSON.stringify({
        success: true,
        ...metadata,
      });
    } finally {
      close();
    }
  } catch (error) {
    console.error("[spreadsheet_getSheetMetadata] Error:", error);

    return JSON.stringify({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get sheet metadata",
    });
  }
};

/**
 * The spreadsheet_getSheetMetadata tool for LangChain
 */
export const spreadsheetGetSheetMetadataTool = tool(
  handleSpreadsheetGetSheetMetadata,
  {
    name: "spreadsheet_getSheetMetadata",
    description: `Get sheet properties (title, frozen rows/cols, tab color, merges, visibility). Does not include row/column sizes.

RETURNS: {sheetId, title, hidden, frozenRowCount, frozenColumnCount, showGridLines, tabColor, merges: ["A1:C1"], index}`,
    schema: SpreadsheetGetSheetMetadataSchema,
  },
);

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
  description: `Apply visual formatting to a range.

STRUCTURE: cells is 2D array. Each cell MUST use "cellStyles" wrapper:
  [[{"cellStyles": {"textFormat": {"bold": true}}}]]
  Use {} for no changes. Single cell auto-expands to fill range.

CELLSTYLES:
- textFormat: {bold, italic, underline, fontFamily, fontSize, color}
- backgroundColor: "#FF0000" or {theme: 4, tint: 0.2}
- borders: {top,right,bottom,left}: {style: "thin"|"medium"|"thick"|"double", color}
- numberFormat: {type: "NUMBER"|"CURRENCY"|"PERCENT"|"DATE", pattern}
- horizontalAlignment: "left"|"center"|"right"
- verticalAlignment: "top"|"middle"|"bottom"

EXAMPLE:
range: "A1:D1"
cells: [[{"cellStyles": {"textFormat": {"bold": true}, "borders": {"bottom": {"style": "medium"}}}}]]`,
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
    description: `Insert or delete rows/columns.

PARAMS:
- action: "insert" | "delete"
- dimension: "row" | "column"
- insert: index (1-based position), count (default 1)
- delete rows: indexes: [1, 3, 5]
- delete columns: columns: ["A", "C"]

EXAMPLES:
Insert 3 rows at row 5: {action: "insert", dimension: "row", index: 5, count: 3}
Delete rows 1,3,5: {action: "delete", dimension: "row", indexes: [1, 3, 5]}`,
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
  description: `Query cell data from specific ranges. Use for reading before edits or validating changes.

PARAMS:
- items: [{sheetId?, range, layer: "values"|"formatting"}]
- Use sheetId OR include sheet name in range: "'Sheet 1'!A1:D10"

RETURNS:
- values: {"cells": {"A1": value}} or {"A1": [formatted, effective, formula?]}
- formatting: {"styles": {"A1": CellFormat}}

EXAMPLE:
items: [{"sheetId": 1, "range": "A1:C10", "layer": "values"}]`,
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
    description: `Enable or disable iterative calculation mode. Required for intentional circular references (LBO models, goal-seek).

PARAMS: enabled: true/false`,
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
  description: `Read spreadsheet content. Use for initial exploration; for targeted reads use query range instead.

PARAMS:
- docId (required)
- sheetId or sheetName (optional): read specific sheet
- range (optional): A1 notation, only with sheetId/sheetName

RETURNS:
- metadata: all sheets with {title, sheetId, rowCount, columnCount}
- workbook.sheets[]: {sheetName, sheetId, dimension, cells: {"A1": value|[formatted,effective,formula?]}}`,
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
    description: `Get row heights or column widths. Read-only inspection before resizing.

Defaults: row height 21px, column width 100px. Returns dimensions array with size, visibility flags.
Range formats: '1:5' (rows), 'A:G' (columns), 'A1:H1'. Use dimensionType to disambiguate if needed.`,
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
    description: `Set column widths or row heights. Supports 'autofit' or fixed 'pixels'.

Defaults: row 21px, column 100px.

CRITICAL: Size columns for DATA values, not headers. Long header + short values = narrow column (80-100px). Use text wrapping for long headers instead.

Width guidelines: short values 80-100px, medium 120-150px, long text 200-300px.

Use width for columns (range: 'A:G'), height for rows (range: '1:5').`,
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

        const spreadsheet = createSpreadsheetInterface(data, false);

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
    description: `Duplicate an existing sheet (copies all data, formatting, structure).

PARAMS: sheetId (source, default 1), newSheetId (optional)`,
    schema: SpreadsheetDuplicateSheetSchema,
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
  description: `Extend data patterns (sequences, formulas, values) across a range. Prefer this over writing many values.

CRITICAL: fillRange must NOT overlap sourceRange!
- Fill DOWN: fillRange starts at row AFTER source ends
- Fill RIGHT: fillRange starts at column AFTER source ends

PARAMS:
- sourceRange: pattern source (e.g., "A1:A2" with values 1,2)
- fillRange: destination ONLY (e.g., "A3:A10" - NOT "A1:A10"!)
- activeCell: top-left of source

For >50 rows: split into multiple calls of ≤50 rows each.

EXAMPLE (1,2 → 3,4,5...):
sourceRange: "A1:A2", fillRange: "A3:A10", activeCell: "A1"`,
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

  const defaultSheetId = inputSheetId ?? 1;

  return withDocumentWriteLock(docId, async () => {
    console.log("[spreadsheet_insertNote] Starting:", {
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
  description: `Add, update, or remove a cell note (visible on hover).

PARAMS: cell (A1 notation), note (text, omit to remove)

EXAMPLE: cell: "A1", note: "This is the header row"`,
  schema: SpreadsheetInsertNoteSchema,
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
        if (spreadsheet.sheets.length === 1) {
          return failTool(
            "CANNOT_DELETE_LAST_SHEET",
            "Cannot delete the last sheet in a workbook",
          );
        }

        spreadsheet.deleteSheet(sheetId);
        const patchTuples = await persistSpreadsheetPatches(doc, spreadsheet);

        console.log("[spreadsheet_deleteSheet] Completed:", {
          docId,
          sheetId,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully deleted sheet ${sheetId}`,
          sheetId,
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

export const spreadsheetDeleteSheetTool = tool(handleSpreadsheetDeleteSheet, {
  name: "spreadsheet_deleteSheet",
  description: `Delete a sheet permanently. Cannot delete the last sheet in a workbook.

PARAMS: sheetId (required)`,
  schema: SpreadsheetDeleteSheetSchema,
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
  const { docId, sheetId: inputSheetId, ranges, clear } = input;

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
      clear,
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

            if (clear === "values" || clear === "all") {
              spreadsheet.deleteCells(rangeSheetId, activeCell, selections);
              modifiedSheetIds.add(rangeSheetId);
            }
            if (clear === "formatting" || clear === "all") {
              spreadsheet.clearFormatting(rangeSheetId, activeCell, selections);
            }

            processedRanges.push(rangeStr);
          } catch (itemError) {
            errors.push({
              range: rangeStr,
              error: itemError instanceof Error ? itemError.message : "Failed",
            });
          }
        }

        // Evaluate formulas for all modified sheets if values were cleared
        let formulaResults;
        if (
          (clear === "values" || clear === "all") &&
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
          clear,
          processedCount: processedRanges.length,
          patchCount: patchTuples.length,
        });

        return JSON.stringify({
          success: true,
          message: `Successfully cleared ${clear} from ${processedRanges.length} range(s)`,
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
  description: `Clear cell values, formatting, or both (without deleting rows/columns).

PARAMS:
- ranges: ["A1:B5", "D3:F10"]
- clear: "values" | "formatting" | "all"

EXAMPLE: sheetId: 1, ranges: ["A1:C10"], clear: "values"`,
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
  description: `Create, update, or delete tables. Tables add headers, filtering, and support structured references (TableName[Column]).

ACTIONS:
- create: sheetId, range, title (unique), columns [{name, formula?, filterButton?}]
- update: sheetId, tableId or tableName, plus properties to change
- delete: sheetId, tableId

PARAMS:
- range: A1 notation (first row = headers)
- title: unique table name
- columns: [{name, formula?}] - formula uses structured refs like "=[Price]*[Qty]"
- theme: "none"|"light"|"medium"|"dark"
- showRowStripes: true (requires bandedRange)

EXAMPLE:
action: "create", sheetId: 1, range: "A1:D10", title: "Sales", columns: [{name: "Item"}, {name: "Price"}, {name: "Qty"}, {name: "Total", formula: "=[Price]*[Qty]"}]`,
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
          const seriesParsed = rest.series!.map((seriesRange: string) => {
            const parsed = parseRangeWithSheetName(
              seriesRange,
              spreadsheet,
              sheetId,
            );
            if (!parsed.selection?.range)
              throw new Error(
                parsed.error || `Invalid series range: ${seriesRange}`,
              );
            return { range: parsed.selection.range, sheetId: parsed.sheetId };
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
            series: seriesParsed.map((s) => ({
              sources: [
                {
                  sheetId: s.sheetId,
                  ...s.range,
                },
              ],
            })),
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

          if (rest.domain) {
            const defaultDomainSheetId = (chart.spec as Record<string, unknown>)
              .domain
              ? ((
                  (chart.spec as Record<string, unknown>).domain as Record<
                    string,
                    unknown
                  >
                ).sheetId as number)
              : (sheetId ?? 1);
            const domainParsed = parseRangeWithSheetName(
              rest.domain,
              spreadsheet,
              defaultDomainSheetId,
            );
            if (domainParsed.selection?.range) {
              specUpdates.domain = {
                sheetId: domainParsed.sheetId,
                startRowIndex: domainParsed.selection.range.startRowIndex,
                endRowIndex: domainParsed.selection.range.endRowIndex,
                startColumnIndex: domainParsed.selection.range.startColumnIndex,
                endColumnIndex: domainParsed.selection.range.endColumnIndex,
              };
            }
          }

          if (rest.series) {
            const defaultSeriesSheetId = (chart.spec as Record<string, unknown>)
              .domain
              ? ((
                  (chart.spec as Record<string, unknown>).domain as Record<
                    string,
                    unknown
                  >
                ).sheetId as number)
              : (sheetId ?? 1);
            specUpdates.series = rest.series.map((seriesRange: string) => {
              const parsed = parseRangeWithSheetName(
                seriesRange,
                spreadsheet,
                defaultSeriesSheetId,
              );
              if (!parsed.selection?.range)
                throw new Error(
                  parsed.error || `Invalid series range: ${seriesRange}`,
                );
              return {
                sheetId: parsed.sheetId,
                startRowIndex: parsed.selection.range.startRowIndex,
                endRowIndex: parsed.selection.range.endRowIndex,
                startColumnIndex: parsed.selection.range.startColumnIndex,
                endColumnIndex: parsed.selection.range.endColumnIndex,
              };
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
  description: `Create, update, or delete charts.

ACTIONS:
- create: sheetId, domain, series, chartType required
- update: chartId required, plus properties to change
- delete: chartId required

CRITICAL: domain and series ranges must EXCLUDE header rows!
- domain: X-axis categories (e.g., "A2:A10" - NOT "A1:A10")
- series: Y-axis data arrays (e.g., ["B2:B10", "C2:C10"])

CHART TYPES: "bar"|"column"|"line"|"pie"|"area"|"scatter"

PARAMS:
- anchorCell: chart position (e.g., "F1")
- width/height: pixels (default 400x300)
- stackedType: "stacked"|"percentStacked"|"unstacked"
- title, subtitle, xAxisTitle, yAxisTitle

EXAMPLE:
action: "create", sheetId: 1, domain: "A2:A5", series: ["B2:B5", "C2:C5"], chartType: "column", title: "Sales"`,
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

          const validationRule = {
            id: newValidationId,
            sheetId: resolvedSheetId,
            ranges: [
              {
                sheetId: resolvedSheetId,
                startRowIndex: rangeParsed.selection.range.startRowIndex,
                endRowIndex: rangeParsed.selection.range.endRowIndex,
                startColumnIndex: rangeParsed.selection.range.startColumnIndex,
                endColumnIndex: rangeParsed.selection.range.endColumnIndex,
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
                  startRowIndex: rangeParsed.selection.range.startRowIndex,
                  endRowIndex: rangeParsed.selection.range.endRowIndex,
                  startColumnIndex:
                    rangeParsed.selection.range.startColumnIndex,
                  endColumnIndex: rangeParsed.selection.range.endColumnIndex,
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
    description: `Create, update, delete, or query data validation (dropdowns, number/date constraints).

ACTIONS:
- create: sheetId, range, validationType required
- update: sheetId, validationId, plus properties to change
- delete: sheetId, validationId
- query: optional sheetId/range filters

VALIDATION TYPES:
- list: listValues: ["A","B","C"] OR listRange: "Sheet2!A1:A10"
- number/wholeNumber: numberOperator + minValue/maxValue
- date: dateOperator + minDate/maxDate
- custom: customFormula (must return TRUE)

Operators: "between"|"equal"|"greaterThan"|"lessThan"|etc.

OPTIONS: allowBlank, showDropdown, errorStyle ("stop"|"warning"|"information")

IMPORTANT: Use exact range specified. Don't expand "E1" to "E1:E100".

EXAMPLE:
action: "create", sheetId: 1, range: "B2:B50", validationType: "list", listValues: ["Pending", "Done"]`,
    schema: SpreadsheetDataValidationSchema,
  },
);

/**
 * Consolidated handler for conditional format operations (create/update/delete/query)
 */
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
            booleanRule: r.booleanRule,
            gradientRule: r.gradientRule,
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
    if (!rest.ruleType) {
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
                startRowIndex: rangeParsed.selection.range.startRowIndex,
                endRowIndex: rangeParsed.selection.range.endRowIndex,
                startColumnIndex: rangeParsed.selection.range.startColumnIndex,
                endColumnIndex: rangeParsed.selection.range.endColumnIndex,
              },
            ],
            enabled: true,
          } as ConditionalFormatRule;

          // Build the rule based on type
          if (rest.ruleType === "colorScale") {
            rule.gradientRule = {
              minpoint: {
                type: "MIN",
                color: rest.minColor || "#FF0000",
              },
              maxpoint: {
                type: "MAX",
                color: rest.maxColor || "#00FF00",
              },
              ...(rest.colorScaleType === "3color" && rest.midColor
                ? {
                    midpoint: {
                      type: "PERCENTILE",
                      value: "50",
                      color: rest.midColor,
                    },
                  }
                : {}),
            };
          } else {
            // Build format
            const format: CellFormat = {};
            if (rest.backgroundColor)
              format.backgroundColor = rest.backgroundColor;
            if (rest.textColor) format.textFormat = { color: rest.textColor };
            if (rest.bold)
              format.textFormat = { ...format.textFormat, bold: true };
            if (rest.italic)
              format.textFormat = { ...format.textFormat, italic: true };

            // Build condition based on ruleType - using string type to handle all condition types
            let condition: {
              type: string;
              values?: Array<{ userEnteredValue: string }>;
            };

            if (rest.ruleType === "condition") {
              const conditionType = mapConditionalFormatCondition(
                rest.conditionType || "greaterThan",
              );
              condition = {
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
            } else if (rest.ruleType === "topBottom") {
              condition = {
                type:
                  rest.topBottomType === "bottom"
                    ? rest.isPercent
                      ? "BOTTOM_PERCENT"
                      : "BOTTOM"
                    : rest.isPercent
                      ? "TOP_PERCENT"
                      : "TOP",
                values: rest.rank
                  ? [{ userEnteredValue: String(rest.rank) }]
                  : undefined,
              };
            } else if (rest.ruleType === "duplicates") {
              condition = {
                type: rest.duplicateType === "unique" ? "UNIQUE" : "DUPLICATE",
              };
            } else {
              condition = { type: "CUSTOM_FORMULA" };
            }

            (rule as Record<string, unknown>).booleanRule = {
              condition,
              format,
            };
          }

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
                  startRowIndex: rangeParsed.selection.range.startRowIndex,
                  endRowIndex: rangeParsed.selection.range.endRowIndex,
                  startColumnIndex:
                    rangeParsed.selection.range.startColumnIndex,
                  endColumnIndex: rangeParsed.selection.range.endColumnIndex,
                },
              ];
            }
          }

          if (rest.enabled !== undefined) updates.enabled = rest.enabled;

          // Handle format updates for boolean rules
          if (
            rest.backgroundColor ||
            rest.textColor ||
            rest.bold !== undefined ||
            rest.italic !== undefined
          ) {
            const format: CellFormat = {
              ...(existingRule.booleanRule?.format || {}),
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
              format.textFormat = { ...format.textFormat, italic: rest.italic };

            updates.booleanRule = {
              ...existingRule.booleanRule,
              format,
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

ACTIONS:
- create: sheetId, range, ruleType required
- update: sheetId, ruleId, plus properties to change
- delete: sheetId, ruleId
- query: optional sheetId/range filters

RULE TYPES:
1. condition: conditionType + conditionValues + backgroundColor/textColor/bold/italic
   conditionTypes: "greaterThan"|"lessThan"|"equal"|"between"|"textContains"|"blank"|"custom"
   customFormula: "=A1>B1" (for custom only)

2. colorScale: colorScaleType ("2color"|"3color") + minColor/midColor/maxColor

3. topBottom: topBottomType ("top"|"bottom") + rank + isPercent + format

4. duplicates: duplicateType ("duplicate"|"unique") + format

EXAMPLES:
Highlight >100: action:"create", sheetId:1, range:"C2:C50", ruleType:"condition", conditionType:"greaterThan", conditionValues:[100], backgroundColor:"#FFCCCC"
Color scale: ruleType:"colorScale", colorScaleType:"3color", minColor:"#FF0000", midColor:"#FFFF00", maxColor:"#00FF00"`,
    schema: SpreadsheetConditionalFormatSchema,
  },
);

/**
 * All available tools for the spreadsheet assistant
 */
export const spreadsheetTools = [
  spreadsheetChangeBatchTool,
  spreadsheetCreateSheetTool,
  spreadsheetUpdateSheetTool,
  spreadsheetGetSheetMetadataTool,
  spreadsheetFormatRangeTool,
  spreadsheetModifyRowsColsTool,
  spreadsheetQueryRangeTool,
  spreadsheetSetIterativeModeTool,
  spreadsheetReadDocumentTool,
  spreadsheetGetRowColMetadataTool,
  spreadsheetSetRowColDimensionsTool,
  spreadsheetDuplicateSheetTool,
  spreadsheetApplyFillTool,
  spreadsheetInsertNoteTool,
  spreadsheetDeleteSheetTool,
  // Consolidated tools
  spreadsheetClearCellsTool,
  spreadsheetTableTool,
  spreadsheetChartTool,
  spreadsheetDataValidationTool,
  spreadsheetConditionalFormatTool,
];
