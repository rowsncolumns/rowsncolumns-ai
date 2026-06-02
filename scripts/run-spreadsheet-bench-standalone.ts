#!/usr/bin/env tsx
/**
 * SpreadsheetBench Standalone Evaluation Runner
 * Uses Spreadsheet interface with calculatePending - NO ShareDB required.
 */

import "dotenv/config";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import {
  parseSpreadsheetBuffer,
  type ImportDocumentSnapshot,
} from "@/lib/documents/import/parsers";
import {
  createSpreadsheetInterface,
  type ShareDBSpreadsheetDoc,
} from "@/lib/chat/utils";
import { compareSpreadsheets } from "@/lib/benchmark/comparison";
import type {
  SpreadsheetBenchTask,
  SpreadsheetBenchTestCase,
  BenchmarkResult,
  BenchmarkSummary,
} from "@/lib/benchmark/types";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Spreadsheet } from "@rowsncolumns/spreadsheet-state/server";
import {
  addressToSelection,
  cellToAddress,
  getCellEffectiveValue,
  getCellFormattedValue,
  getCellUserEnteredValue,
  getExtendedValueBool,
  getExtendedValueFormula,
  getExtendedValueNumber,
  getExtendedValueString,
  isNil,
  selectionToAddress,
} from "@rowsncolumns/utils";

// Configuration
const SPREADSHEET_BENCH_PATH =
  process.env.SPREADSHEET_BENCH_PATH || "./SpreadsheetBench";
const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-4.1-mini";
const DEFAULT_PROVIDER = (process.env.CHAT_PROVIDER || "openai") as
  | "openai"
  | "anthropic";

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const config = {
  limit: getArg("limit") ? parseInt(getArg("limit")!, 10) : undefined,
  taskId: getArg("task-id"),
  model: getArg("model") || DEFAULT_MODEL,
  provider: (getArg("provider") || DEFAULT_PROVIDER) as "openai" | "anthropic",
  outputFile: getArg("output"),
  verbose: hasFlag("verbose"),
  logTools: hasFlag("log-tools"),
};

const log = (...args: unknown[]) => console.log("[benchmark]", ...args);
const logVerbose = (...args: unknown[]) => {
  if (config.verbose) console.log("[verbose]", ...args);
};
const logTool = (...args: unknown[]) => {
  if (config.verbose || config.logTools) {
    console.log("[tool]", ...args);
  }
};

// Convert 1-indexed row/col to A1 (for internal Spreadsheet sheetData format)
function indices1ToA1(row: number, col: number): string {
  let colStr = "";
  let c = col;
  while (c > 0) {
    c--;
    colStr = String.fromCharCode(65 + (c % 26)) + colStr;
    c = Math.floor(c / 26);
  }
  return `${colStr}${row}`;
}

async function loadTasks(dataPath: string): Promise<SpreadsheetBenchTask[]> {
  const content = await readFile(dataPath, "utf-8");
  const parsed = JSON.parse(content);
  return parsed.map((item: any) => ({
    id: String(item.id),
    instruction: item.instruction,
    spreadsheet_path: item.spreadsheet_path,
    instruction_type: item.instruction_type || "unknown",
    answer_position: item.answer_position,
  }));
}

async function findTestCases(
  taskId: string,
  taskDir: string,
): Promise<SpreadsheetBenchTestCase[]> {
  const files = await readdir(taskDir);
  const inputFiles = files.filter(
    (f) => f.endsWith("_input.xlsx") || f.endsWith("_input.xls"),
  );

  return inputFiles
    .map((inputFile) => {
      const match = inputFile.match(/^(\d+)_/);
      const testCaseNumber = match ? parseInt(match[1], 10) : 1;
      const answerFile = inputFile.replace("_input.", "_answer.");
      return {
        taskId,
        testCaseNumber,
        inputPath: join(taskDir, inputFile),
        answerPath: join(taskDir, answerFile),
      };
    })
    .sort((a, b) => a.testCaseNumber - b.testCaseNumber);
}

async function loadSnapshot(xlsxPath: string): Promise<ImportDocumentSnapshot> {
  const buffer = await readFile(xlsxPath);
  const filename = basename(xlsxPath);
  const extension = filename.split(".").pop()?.toLowerCase() || "xlsx";
  return parseSpreadsheetBuffer(buffer, filename, extension);
}

// Convert spreadsheet.sheetData to V3 format for comparison
function spreadsheetToV3SheetData(
  spreadsheet: InstanceType<typeof Spreadsheet>,
): Record<string, any> {
  const v3Data: Record<string, any> = {};
  const sheetDataObj = spreadsheet.sheetData as unknown as Record<number, any>;

  for (const sheet of spreadsheet.sheets) {
    const sheetData = sheetDataObj[sheet.sheetId];
    if (!sheetData) continue;

    for (const rowIndexStr of Object.keys(sheetData)) {
      const rowIndex = parseInt(rowIndexStr, 10);
      if (isNaN(rowIndex)) continue;

      const rowData = sheetData[rowIndex];
      if (!rowData?.values) continue;

      for (const colIndexStr of Object.keys(rowData.values)) {
        const colIndex = parseInt(colIndexStr, 10);
        if (isNaN(colIndex)) continue;

        const cell = rowData.values[colIndex];
        if (!cell) continue;

        // V3 key format: "sheetId!ColRow" (e.g., "1!A1")
        const addr = indices1ToA1(rowIndex, colIndex);
        const key = `${sheet.sheetId}!${addr}`;
        v3Data[key] = {
          value: cell,
          sId: sheet.sheetId,
          r: rowIndex,
          c: colIndex,
        };
      }
    }
  }

  return v3Data;
}

type StandaloneCellData = {
  value?: string | number | boolean | null;
  formula?: string;
  citation?: string;
};

const parseCells = (input: unknown): StandaloneCellData[][] => {
  let parsed = input;
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

  const result: StandaloneCellData[][] = [];
  for (let rowIdx = 0; rowIdx < parsed.length; rowIdx++) {
    const row = parsed[rowIdx];
    if (!Array.isArray(row)) {
      throw new Error(`Row ${rowIdx} must be an array, got ${typeof row}`);
    }

    const rowCells: StandaloneCellData[] = [];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cell = row[colIdx];
      if (cell === null || cell === undefined) {
        rowCells.push({});
        continue;
      }

      if (typeof cell !== "object" || Array.isArray(cell)) {
        throw new Error(
          `Cell at row ${rowIdx}, col ${colIdx} must be an object, got ${typeof cell}`,
        );
      }

      const { value, formula, citation, ...rest } = cell as Record<
        string,
        unknown
      >;
      const extraKeys = Object.keys(rest);
      if (extraKeys.length > 0) {
        throw new Error(
          `Cell at row ${rowIdx}, col ${colIdx} has unexpected properties: ${extraKeys.join(", ")}. Allowed keys: value, formula, citation.`,
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

      let normalizedFormula = formula as string | undefined;
      if (
        normalizedFormula !== undefined &&
        normalizedFormula.length > 0 &&
        !normalizedFormula.startsWith("=")
      ) {
        normalizedFormula = `=${normalizedFormula}`;
      }

      rowCells.push({
        value:
          value === undefined
            ? undefined
            : (value as string | number | boolean | null),
        formula: normalizedFormula,
        citation: citation as string | undefined,
      });
    }

    result.push(rowCells);
  }

  return result;
};

const getUsedRangeBounds = (sheetData: Record<number, any> | undefined) => {
  let maxRow = 0;
  let maxCol = 0;
  if (!sheetData) return { maxRow, maxCol };

  for (const rowIndexStr of Object.keys(sheetData)) {
    const rowIndex = Number.parseInt(rowIndexStr, 10);
    if (Number.isNaN(rowIndex)) continue;
    const rowData = sheetData[rowIndex];
    if (!rowData?.values) continue;

    for (const colIndexStr of Object.keys(rowData.values)) {
      const colIndex = Number.parseInt(colIndexStr, 10);
      if (Number.isNaN(colIndex)) continue;
      if (rowData.values[colIndex]) {
        maxRow = Math.max(maxRow, rowIndex);
        maxCol = Math.max(maxCol, colIndex);
      }
    }
  }

  return { maxRow, maxCol };
};

const parseRangeWithOptionalSheet = (
  range: string,
  spreadsheet: InstanceType<typeof Spreadsheet>,
  defaultSheetId: number,
): {
  sheetId: number;
  selection: ReturnType<typeof addressToSelection> | null;
  error?: string;
} => {
  const trimmedRange = range.trim();
  const sheetRangeMatch = trimmedRange.match(
    /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/,
  );

  if (sheetRangeMatch) {
    const rawSheetName = (sheetRangeMatch[1] ?? sheetRangeMatch[2] ?? "")
      .replace(/''/g, "'")
      .trim();
    const localRange = sheetRangeMatch[3].trim();
    const targetSheet = spreadsheet.sheets.find((sheet) => {
      const title = (sheet as { title?: string }).title;
      const name = (sheet as { name?: string }).name;
      return title === rawSheetName || name === rawSheetName;
    });

    if (!targetSheet) {
      return {
        sheetId: defaultSheetId,
        selection: null,
        error: `Sheet "${rawSheetName}" not found`,
      };
    }

    return {
      sheetId: targetSheet.sheetId,
      selection: addressToSelection(localRange),
    };
  }

  return {
    sheetId: defaultSheetId,
    selection: addressToSelection(trimmedRange),
  };
};

const stripSheetPrefix = (range: string): string => {
  const trimmedRange = range.trim();
  const sheetRangeMatch = trimmedRange.match(
    /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/,
  );
  if (!sheetRangeMatch) {
    return trimmedRange;
  }
  return sheetRangeMatch[3].trim();
};

const rangeSelectionToAddress = (
  rowIndex: number,
  columnIndex: number,
  sheetName?: string,
) =>
  selectionToAddress(
    {
      range: {
        startRowIndex: rowIndex,
        endRowIndex: rowIndex,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex,
      },
    },
    sheetName,
  );

// Create tools that use Spreadsheet interface
function createTools(spreadsheet: InstanceType<typeof Spreadsheet>) {
  const readSchema = z.object({
    docId: z.string().optional(),
    sheetId: z.number().int().optional(),
    range: z.string().optional(),
    layer: z.enum(["values", "metadata"]).optional(),
    explanation: z.string().optional(),
  });

  const changeBatchCellSchema = z
    .object({
      value: z
        .union([z.string(), z.number(), z.boolean(), z.null()])
        .optional(),
      formula: z.string().optional(),
      citation: z.string().optional(),
    })
    .strict();

  const changeBatchSchema = z.object({
    docId: z.string().optional(),
    sheetId: z.number().int().optional(),
    range: z.string(),
    cells: z.union([
      z.array(z.array(changeBatchCellSchema)),
      z.string().describe("JSON string representation of 2D cell array"),
    ]),
    explanation: z.string().optional(),
  });

  const queryItemSchema = z.object({
    sheetId: z.number().int().optional(),
    sheetName: z.string().optional(),
    range: z.string(),
    layer: z.enum(["values"]).default("values"),
  });
  const queryRangeSchema = z.object({
    docId: z.string().optional(),
    items: z.array(queryItemSchema).optional(),
    // Compatibility short-form: allow a single top-level query item.
    sheetId: z.number().int().optional(),
    sheetName: z.string().optional(),
    range: z.string().optional(),
    layer: z.enum(["values"]).optional(),
    explanation: z.string().optional(),
  });

  const readTool = tool(
    async (input) => {
      const {
        sheetId: inputSheetId,
        range: rangeStr,
        layer = "values",
      } = input;

      const allSheets = spreadsheet.sheets.map((sheet) => ({
        sheetId: sheet.sheetId,
        title:
          (sheet as { title?: string }).title ||
          (sheet as { name?: string }).name ||
          `Sheet${sheet.sheetId}`,
      }));

      let sheetsToRead = allSheets;
      if (!isNil(inputSheetId)) {
        const targetSheet = allSheets.find(
          (sheet) => sheet.sheetId === inputSheetId,
        );
        if (!targetSheet) {
          return JSON.stringify({
            success: false,
            error: `Sheet with ID ${inputSheetId} not found`,
          });
        }
        sheetsToRead = [targetSheet];
      }

      const sheetDataObj = spreadsheet.sheetData as unknown as Record<
        number,
        any
      >;

      if (layer === "metadata") {
        const sheetsMetadata = sheetsToRead.map((sheetInfo) => {
          const sheet = spreadsheet.sheets.find(
            (s) => s.sheetId === sheetInfo.sheetId,
          ) as
            | {
                index?: number;
                hidden?: boolean;
                frozenRowCount?: number;
                frozenColumnCount?: number;
                showGridLines?: boolean;
                tabColor?: string | null;
                merges?: Array<Record<string, number>>;
              }
            | undefined;
          const sheetData = sheetDataObj[sheetInfo.sheetId];
          const { maxRow: rowCount, maxCol: columnCount } =
            getUsedRangeBounds(sheetData);

          return {
            sheetId: sheetInfo.sheetId,
            title: sheetInfo.title,
            index: sheet?.index,
            hidden: sheet?.hidden ?? false,
            frozenRowCount: sheet?.frozenRowCount ?? 0,
            frozenColumnCount: sheet?.frozenColumnCount ?? 0,
            showGridLines: sheet?.showGridLines ?? true,
            tabColor: sheet?.tabColor ?? null,
            merges: (sheet?.merges ?? []).map((merge) =>
              selectionToAddress({ range: merge as any }),
            ),
            rowCount,
            columnCount,
          };
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
        const sheetData = sheetDataObj[sheetInfo.sheetId];

        let startRowIndex = 1;
        let endRowIndex = 1;
        let startColumnIndex = 1;
        let endColumnIndex = 1;

        if (rangeStr) {
          const rangeParsed = parseRangeWithOptionalSheet(
            rangeStr,
            spreadsheet,
            sheetInfo.sheetId,
          );
          if (rangeParsed.error) {
            return JSON.stringify({
              success: false,
              error: rangeParsed.error,
            });
          }
          if (rangeParsed.sheetId !== sheetInfo.sheetId) {
            continue;
          }
          if (!rangeParsed.selection?.range) {
            return JSON.stringify({
              success: false,
              error: `Invalid range: ${rangeStr}`,
            });
          }
          startRowIndex = rangeParsed.selection.range.startRowIndex;
          endRowIndex = rangeParsed.selection.range.endRowIndex;
          startColumnIndex = rangeParsed.selection.range.startColumnIndex;
          endColumnIndex = rangeParsed.selection.range.endColumnIndex;
        } else {
          const { maxRow, maxCol } = getUsedRangeBounds(sheetData);
          if (maxRow > 0 && maxCol > 0) {
            startRowIndex = 1;
            endRowIndex = maxRow;
            startColumnIndex = 1;
            endColumnIndex = maxCol;
          }
        }

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
            const address = cellToAddress({ rowIndex, columnIndex });
            if (!address) continue;

            const cellData = sheetData?.[rowIndex]?.values?.[columnIndex];
            if (!cellData) continue;

            const effectiveValue = getCellEffectiveValue(cellData);
            const ss = cellData.ss;
            const ev =
              getExtendedValueBool(effectiveValue) ??
              getExtendedValueNumber(effectiveValue) ??
              getExtendedValueString(effectiveValue);
            const fv = isNil(ss)
              ? getCellFormattedValue(cellData)
              : spreadsheet.sharedStrings.get(String(ss));
            const ue = getCellUserEnteredValue(cellData);
            const formula = getExtendedValueFormula(ue);

            if (formula) {
              cells[address] = [fv ?? ev ?? null, ev ?? null, formula];
            } else if (
              !isNil(fv) &&
              !isNil(ev) &&
              fv !== ev &&
              fv !== String(ev)
            ) {
              cells[address] = [fv, ev];
            } else {
              const value = ev ?? fv;
              if (value === undefined || value === null) continue;
              cells[address] = value;
            }
          }
        }

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
          styles: {},
        });
      }

      const metadata = {
        totalSheets: spreadsheet.sheets.length,
        sheets: allSheets.map((sheet) => {
          const sheetData = sheetDataObj[sheet.sheetId];
          const { maxRow: rowCount, maxCol: columnCount } =
            getUsedRangeBounds(sheetData);
          return {
            title: sheet.title,
            sheetId: sheet.sheetId,
            rowCount,
            columnCount,
          };
        }),
      };

      return JSON.stringify({
        success: true,
        metadata,
        workbook: {
          sheets: resultSheets,
        },
      });
    },
    {
      name: "spreadsheet_readDocument",
      description:
        "Read content from a spreadsheet and return values or metadata in a workbook format.",
      schema: readSchema,
    },
  );

  const writeTool = tool(
    async (input) => {
      const { sheetId: inputSheetId, range, cells: rawCells } = input;

      let cells: StandaloneCellData[][];
      try {
        cells = parseCells(rawCells);
      } catch (e) {
        return JSON.stringify({
          success: false,
          error: e instanceof Error ? e.message : "Invalid cells format",
        });
      }

      const defaultSheetId = inputSheetId ?? 1;
      const parsedRange = parseRangeWithOptionalSheet(
        range,
        spreadsheet,
        defaultSheetId,
      );
      if (parsedRange.error) {
        return JSON.stringify({
          success: false,
          error: parsedRange.error,
        });
      }
      if (!parsedRange.selection?.range) {
        return JSON.stringify({
          success: false,
          error: `Invalid range: ${range}`,
        });
      }

      const values = cells.map((row) =>
        row.map((cell) => (cell.formula ? cell.formula : cell.value)),
      );
      const sheetId = parsedRange.sheetId;

      try {
        logVerbose("changeBatch input:", {
          sheetId,
          range: parsedRange.selection.range,
          values,
        });

        spreadsheet.changeBatch(sheetId, parsedRange.selection.range, values);

        const calcResults = await spreadsheet.calculatePending();
        const formulaResults: Record<string, unknown> = {};
        for (const [position, result] of calcResults) {
          const sheetName =
            position.sheetId === sheetId
              ? undefined
              : ((
                  spreadsheet.sheets.find(
                    (s) => s.sheetId === position.sheetId,
                  ) as { title?: string; name?: string } | undefined
                )?.title ??
                (
                  spreadsheet.sheets.find(
                    (s) => s.sheetId === position.sheetId,
                  ) as { title?: string; name?: string } | undefined
                )?.name);
          const address = rangeSelectionToAddress(
            position.rowIndex,
            position.columnIndex,
            sheetName,
          );
          if (!address) continue;

          if (result && typeof result === "object" && "error" in result) {
            formulaResults[address] =
              `${String((result as any).error)}: ${String(
                (result as any).message ?? "",
              )}`.trim();
          } else {
            formulaResults[address] = result;
          }
        }

        const patches = spreadsheet.getPatchTuples();
        logVerbose("Patches generated:", patches.length);
        if (patches.length > 0 && config.verbose) {
          for (const [patchObj] of patches.slice(0, 2)) {
            // Look for the actual cell value in the patches
            const sheetDataPatches = (patchObj as any)?.sheetData?.patches;
            if (sheetDataPatches?.length) {
              for (const p of sheetDataPatches.slice(0, 2)) {
                logVerbose(
                  "Cell patch path:",
                  p.path,
                  "value.ev:",
                  p.value?.ev,
                );
              }
            }
          }
        }

        return JSON.stringify({
          success: true,
          message: `Successfully updated ${cells.flat().length} cell(s) in range ${range}`,
          range,
          formulaResults,
        });
      } catch (e) {
        logVerbose("changeBatch error:", e);
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
    {
      name: "spreadsheet_changeBatch",
      description:
        "Write data into a rectangular region of a spreadsheet using A1 range and a 2D cells array.",
      schema: changeBatchSchema,
    },
  );

  const queryRangeTool = tool(
    async (input) => {
      const items =
        input.items && input.items.length > 0
          ? input.items
          : input.range
            ? [
                {
                  sheetId: input.sheetId,
                  sheetName: input.sheetName,
                  range: input.range,
                  layer: input.layer ?? "values",
                },
              ]
            : [];

      if (items.length === 0) {
        return JSON.stringify({
          success: false,
          error: "At least one query item is required",
        });
      }

      const results: Array<{
        range: string;
        layer: string;
        cells?: Record<string, unknown>;
        error?: string;
      }> = [];

      for (const item of items) {
        try {
          let resolvedSheetId: number | undefined;

          if (!isNil(item.sheetId)) {
            const exists = spreadsheet.sheets.some((s) => s.sheetId === item.sheetId);
            if (!exists) {
              results.push({
                range: item.range,
                layer: item.layer,
                error: `Sheet with ID ${item.sheetId} not found`,
              });
              continue;
            }
            resolvedSheetId = item.sheetId;
          } else if (!isNil(item.sheetName)) {
            const targetSheet = spreadsheet.sheets.find((s) => {
              const title = (s as { title?: string }).title;
              const name = (s as { name?: string }).name;
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
            resolvedSheetId = targetSheet.sheetId;
          } else {
            resolvedSheetId = spreadsheet.activeSheetId ?? 1;
          }

          const localRange =
            !isNil(item.sheetId) || !isNil(item.sheetName)
              ? stripSheetPrefix(item.range)
              : item.range;
          const rangeParsed = parseRangeWithOptionalSheet(
            localRange,
            spreadsheet,
            resolvedSheetId,
          );
          if (rangeParsed.error) {
            results.push({
              range: item.range,
              layer: item.layer,
              error: rangeParsed.error,
            });
            continue;
          }
          if (!rangeParsed.selection?.range) {
            results.push({
              range: item.range,
              layer: item.layer,
              error: `Invalid range: ${item.range}`,
            });
            continue;
          }

          const sheetId = resolvedSheetId;
          const {
            startRowIndex,
            endRowIndex,
            startColumnIndex,
            endColumnIndex,
          } = rangeParsed.selection.range;
          const sheetData = (spreadsheet.sheetData as unknown as Record<number, any>)[
            sheetId
          ];
          const cells: Record<string, unknown> = {};

          for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
            for (
              let columnIndex = startColumnIndex;
              columnIndex <= endColumnIndex;
              columnIndex++
            ) {
              const address = cellToAddress({ rowIndex, columnIndex });
              if (!address) continue;
              const cellData = sheetData?.[rowIndex]?.values?.[columnIndex];
              if (!cellData) continue;

              const effectiveValue = getCellEffectiveValue(cellData);
              const ss = cellData.ss;
              const ev =
                getExtendedValueBool(effectiveValue) ??
                getExtendedValueNumber(effectiveValue) ??
                getExtendedValueString(effectiveValue);
              const fv = isNil(ss)
                ? getCellFormattedValue(cellData)
                : spreadsheet.sharedStrings.get(String(ss));
              const ue = getCellUserEnteredValue(cellData);
              const formula = getExtendedValueFormula(ue);

              if (formula) {
                cells[address] = [fv ?? ev ?? null, ev ?? null, formula];
              } else if (
                !isNil(fv) &&
                !isNil(ev) &&
                fv !== ev &&
                fv !== String(ev)
              ) {
                cells[address] = [fv, ev];
              } else {
                const value = ev ?? fv;
                if (value === undefined || value === null) continue;
                cells[address] = value;
              }
            }
          }

          results.push({
            range: item.range,
            layer: item.layer,
            cells,
          });
        } catch (e) {
          results.push({
            range: item.range,
            layer: item.layer,
            error: e instanceof Error ? e.message : "Failed to query range",
          });
        }
      }

      return JSON.stringify({
        success: true,
        results,
      });
    },
    {
      name: "spreadsheet_queryRange",
      description:
        "Query targeted ranges from a sheet (values layer) to inspect specific cells before/after edits.",
      schema: queryRangeSchema,
    },
  );

  return [readTool, queryRangeTool, writeTool];
}

async function runAgent(
  spreadsheet: InstanceType<typeof Spreadsheet>,
  instruction: string,
  answerPosition?: string,
): Promise<{ success: boolean; error?: string; toolCalls: number }> {
  const tools = createTools(spreadsheet);
  let toolCalls = 0;

  try {
    const model =
      config.provider === "anthropic"
        ? new ChatAnthropic({ model: config.model, maxTokens: 4096 })
        : new ChatOpenAI({ model: config.model });

    const modelWithTools = model.bindTools(tools);

    const systemPrompt = `You are a spreadsheet assistant being evaluated on SpreadsheetBench.
CRITICAL: You MUST use tools to complete the task. Do NOT just explain what to do.

Execution order:
1. Call spreadsheet_readDocument(layer="metadata") to map sheet names and sheet IDs.
2. Call spreadsheet_queryRange(items=[...]) to inspect source/target ranges.
3. Call spreadsheet_changeBatch to write FINAL output to required ranges.

Tool contract (strict):
- spreadsheet_readDocument args: { docId?, sheetId?, range?, layer: "values" | "metadata" }
- spreadsheet_queryRange args: { items: [{ sheetId?|sheetName?, range, layer: "values" }] }
- spreadsheet_changeBatch args: { docId?, sheetId?, range, cells }
- spreadsheet_changeBatch.cells MUST be a 2D array of cell objects:
  [[{value: ...}]] or [[{formula: ...}]]
- Never send 1D cells arrays. Range and cells dimensions must match.

Engine compatibility (strict):
- AVOID modern Excel functions that may be unsupported here:
  LET, TAKE, DROP, CHOOSECOLS, CHOOSEROWS, VSTACK, HSTACK, MAP, REDUCE, SCAN, BYROW, BYCOL, XLOOKUP, XMATCH, SORTBY, UNIQUE.
- Prefer robust core operations.
- If function support is uncertain, compute from queried values and write literal values.
- For benchmark stability, prefer writing explicit final values over dynamic spill formulas.
- Do NOT rely on a single spill formula to populate large target ranges.

Value writing rules:
- When queryRange returns [formatted, effective], use the effective value for writes.
- When queryRange returns [formatted, effective, formula], use effective for copied output values.
- Preserve raw numeric date serials (do not convert to formatted date strings).
- Preserve blanks/spaces exactly when task requires them.

STRICT OUTPUT RULES:
- Write final answer directly into required output ranges only.
- Do NOT leave the answer only in helper columns.
- If multiple target sheets exist, update each required sheet.
- The final answer in required ranges should be concrete cell values unless the task explicitly requires formulas.

Required answer range for this task: ${answerPosition ?? "N/A"}.
You will be graded on whether spreadsheet state matches expected output.`;

    const messages: any[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage(instruction),
    ];

    // Enable Anthropic ephemeral prompt caching so the stable prefix
    // (tools + system prompt + prior turns) is read from cache across the
    // agent loop instead of being reprocessed each iteration. OpenAI ignores it.
    const invokeOptions =
      config.provider === "anthropic"
        ? { cache_control: { type: "ephemeral" as const } }
        : undefined;

    for (let i = 0; i < 10; i++) {
      const response = await modelWithTools.invoke(messages, invokeOptions);
      messages.push(response);

      const calls = response.tool_calls || [];
      if (calls.length === 0) {
        logVerbose(
          "Agent finished. Content:",
          (response as any).content?.slice(0, 300),
        );
        break;
      }

      toolCalls += calls.length;

      for (const call of calls) {
        const t = tools.find((x) => x.name === call.name);
        if (!t) {
          logTool("Unknown tool requested:", {
            id: call.id,
            name: call.name,
            args: call.args,
          });
          continue;
        }

        logTool("Call:", {
          id: call.id,
          name: call.name,
          args: call.args,
        });

        try {
          const result = await (t as any).invoke(call.args);
          const toolContent =
            typeof result === "string" ? result : JSON.stringify(result);
          logTool("Result:", {
            id: call.id,
            name: call.name,
            contentPreview:
              toolContent.length > 1000
                ? `${toolContent.slice(0, 1000)}...`
                : toolContent,
          });
          messages.push(
            new ToolMessage({
              content: toolContent,
              tool_call_id: call.id!,
            }),
          );
        } catch (e) {
          const errorMessage = String(e);
          logTool("Error:", {
            id: call.id,
            name: call.name,
            error: errorMessage,
          });
          messages.push(
            new ToolMessage({
              content: JSON.stringify({ error: errorMessage }),
              tool_call_id: call.id!,
            }),
          );
        }
      }
    }

    return { success: true, toolCalls };
  } catch (e) {
    return { success: false, error: String(e), toolCalls };
  }
}

async function runTestCase(
  task: SpreadsheetBenchTask,
  testCase: SpreadsheetBenchTestCase,
): Promise<BenchmarkResult> {
  log(`Task ${task.id} #${testCase.testCaseNumber}...`);
  const startTime = Date.now();

  try {
    // Load input xlsx into snapshot
    const inputSnapshot = await loadSnapshot(testCase.inputPath);

    // Create Spreadsheet interface from snapshot
    const spreadsheet = createSpreadsheetInterface(
      inputSnapshot as unknown as ShareDBSpreadsheetDoc,
    );

    // Run agent (modifies spreadsheet in place)
    const result = await runAgent(
      spreadsheet,
      task.instruction,
      task.answer_position,
    );

    if (!result.success) {
      return {
        taskId: task.id,
        testCaseNumber: testCase.testCaseNumber,
        passed: false,
        instruction: task.instruction,
        errorMessage: result.error,
        executionTimeMs: Date.now() - startTime,
        toolCalls: result.toolCalls,
      };
    }

    // Convert spreadsheet state to V3 format for comparison
    const actualSheetData = spreadsheetToV3SheetData(spreadsheet);
    logVerbose(
      "Actual sheetData keys (sample):",
      Object.keys(actualSheetData).slice(0, 20),
    );
    logVerbose("H4 cell:", JSON.stringify(actualSheetData["1!H4"]));

    // Debug: check raw cell data in spreadsheet
    // Note: sheetData uses 1-indexed row/col
    // H4 = row 4, col 8 (H=8)
    const sheetDataObj = spreadsheet.sheetData as unknown as Record<
      number,
      any
    >;
    const rawCellH4 = sheetDataObj?.[1]?.[4]?.values?.[8];
    logVerbose("Raw H4 (row 4, col 8):", JSON.stringify(rawCellH4));

    // Check row 3 (G3 = col 7) and row 4 to see what's happening with data cells
    const row3 = sheetDataObj?.[1]?.[3]?.values;
    const row4 = sheetDataObj?.[1]?.[4]?.values;
    if (row3) {
      logVerbose("Row 3 (should have G3=2):");
      for (const col of [4, 5, 6, 7, 8]) {
        const addr = indices1ToA1(3, col);
        const cell = row3[col];
        if (cell) {
          const evVal = cell?.ev?.nv ?? cell?.ev?.sv ?? "no-ev";
          const ueVal = cell?.ue?.nv ?? cell?.ue?.sv ?? cell?.ue?.fv ?? "no-ue";
          logVerbose(`  ${addr}: ev=${evVal}, ue=${ueVal}`);
        }
      }
    }
    if (row4) {
      logVerbose("Row 4 (should have G4=1, H4=formula result):");
      for (const col of [4, 5, 6, 7, 8]) {
        const addr = indices1ToA1(4, col);
        const cell = row4[col];
        if (cell) {
          const evVal = cell?.ev?.nv ?? cell?.ev?.sv ?? "no-ev";
          const ueVal = cell?.ue?.nv ?? cell?.ue?.sv ?? cell?.ue?.fv ?? "no-ue";
          logVerbose(`  ${addr}: ev=${evVal}, ue=${ueVal}`);
        }
      }
    }
    const actualDoc: ShareDBSpreadsheetDoc = {
      sheets: spreadsheet.sheets,
      sheetData: actualSheetData,
      sharedStrings: Object.fromEntries(spreadsheet.sharedStrings),
    };

    // Load expected answer
    const expectedSnapshot = await loadSnapshot(testCase.answerPath);

    // Compare
    const comparison = compareSpreadsheets(
      expectedSnapshot as unknown as ShareDBSpreadsheetDoc,
      actualDoc,
      task.answer_position,
    );

    if (!comparison.match && config.verbose) {
      for (const sheet of comparison.sheetResults) {
        for (const cell of sheet.cellResults.slice(0, 3)) {
          log(
            `  ${cell.cellAddress}: expected "${cell.expected}", got "${cell.actual}"`,
          );
        }
      }
    }

    return {
      taskId: task.id,
      testCaseNumber: testCase.testCaseNumber,
      passed: comparison.match,
      instruction: task.instruction,
      errorMessage: comparison.match ? undefined : "Mismatch",
      executionTimeMs: Date.now() - startTime,
      toolCalls: result.toolCalls,
    };
  } catch (e) {
    return {
      taskId: task.id,
      testCaseNumber: testCase.testCaseNumber,
      passed: false,
      instruction: task.instruction,
      errorMessage: String(e).slice(0, 100),
      executionTimeMs: Date.now() - startTime,
      toolCalls: 0,
    };
  }
}

async function runBenchmark(): Promise<BenchmarkSummary> {
  const startTime = new Date().toISOString();
  log("SpreadsheetBench STANDALONE (Spreadsheet interface + calculatePending)");
  log(`Model: ${config.model}, Provider: ${config.provider}`);

  const tasksPath = join(
    SPREADSHEET_BENCH_PATH,
    "data/sample_data_200/dataset.json",
  );
  let tasks = await loadTasks(tasksPath);
  log(`Loaded ${tasks.length} tasks`);

  if (config.taskId) tasks = tasks.filter((t) => t.id === config.taskId);
  if (config.limit) tasks = tasks.slice(0, config.limit);

  log(`Running ${tasks.length} tasks...`);

  const results: BenchmarkResult[] = [];
  const dataDir = join(SPREADSHEET_BENCH_PATH, "data/sample_data_200");

  for (const task of tasks) {
    const taskDir = join(dataDir, task.spreadsheet_path);
    const testCases = await findTestCases(task.id, taskDir);

    for (const tc of testCases) {
      const r = await runTestCase(task, tc);
      results.push(r);
      const passed = results.filter((x) => x.passed).length;
      log(
        `Progress: ${results.length} done, ${passed} passed (${((passed / results.length) * 100).toFixed(1)}%)`,
      );
    }
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    totalTasks: tasks.length,
    totalTestCases: results.length,
    passedTestCases: passed,
    failedTestCases: results.length - passed,
    accuracy: results.length > 0 ? passed / results.length : 0,
    averageExecutionTimeMs:
      results.length > 0
        ? results.reduce((s, r) => s + r.executionTimeMs, 0) / results.length
        : 0,
    totalToolCalls: results.reduce((s, r) => s + r.toolCalls, 0),
    results,
    startTime,
    endTime: new Date().toISOString(),
    model: config.model,
    provider: config.provider,
  };
}

function printSummary(s: BenchmarkSummary) {
  console.log("\n" + "=".repeat(50));
  console.log("SPREADSHEETBENCH STANDALONE RESULTS");
  console.log("=".repeat(50));
  console.log(`Model: ${s.model} | Provider: ${s.provider}`);
  console.log(`Tasks: ${s.totalTasks} | Test Cases: ${s.totalTestCases}`);
  console.log(`Passed: ${s.passedTestCases} | Failed: ${s.failedTestCases}`);
  console.log(`ACCURACY: ${(s.accuracy * 100).toFixed(2)}%`);
  console.log(`Avg Time: ${s.averageExecutionTimeMs.toFixed(0)}ms`);
  console.log("=".repeat(50));

  if (s.failedTestCases > 0) {
    console.log("\nFailed:");
    for (const r of s.results.filter((x) => !x.passed).slice(0, 5)) {
      console.log(`  ${r.taskId}#${r.testCaseNumber}: ${r.errorMessage}`);
    }
  }
}

(async () => {
  try {
    const summary = await runBenchmark();
    printSummary(summary);
    if (config.outputFile) {
      await writeFile(config.outputFile, JSON.stringify(summary, null, 2));
    }
    process.exit(summary.accuracy >= 0.5 ? 0 : 1);
  } catch (e) {
    console.error("Failed:", e);
    process.exit(1);
  }
})();
