import { createRequire } from "node:module";
import ShareDBClient from "sharedb/lib/client";
import { WebSocket } from "ws";
import {
  applyPatchesToShareDBDoc,
  convertV3ToSheetData,
  type CellDataV3,
} from "@rowsncolumns/sharedb/helpers";

import { selectionToAddress } from "@rowsncolumns/utils";
import { type CellData as SpreadsheetCellData } from "@rowsncolumns/spreadsheet";
import type { WorkerRuntimeOptions } from "@rowsncolumns/calculation-worker";

const SHAREDB_URL = process.env.SHAREDB_URL || "ws://localhost:8080";
const SHAREDB_COLLECTION = process.env.SHAREDB_COLLECTION || "spreadsheets";
const nodeRequire = createRequire(import.meta.url);

type SpreadsheetDeps = {
  Spreadsheet: typeof import("@rowsncolumns/spreadsheet-state/server").Spreadsheet;
  FormulaError: typeof import("@rowsncolumns/fast-formula-parser").FormulaError;
  attachCalculationWorker: typeof import("@rowsncolumns/calculation-worker").attachCalculationWorker;
  functions: typeof import("@rowsncolumns/functions/server").functions;
};

let spreadsheetDepsCache: SpreadsheetDeps | null = null;

const getSpreadsheetDeps = (): SpreadsheetDeps => {
  if (spreadsheetDepsCache) {
    return spreadsheetDepsCache;
  }

  const { Spreadsheet } =
    nodeRequire(
      "@rowsncolumns/spreadsheet-state/server",
    ) as typeof import("@rowsncolumns/spreadsheet-state/server");
  const { FormulaError } = nodeRequire(
    "@rowsncolumns/fast-formula-parser",
  ) as typeof import("@rowsncolumns/fast-formula-parser");
  const { attachCalculationWorker } = nodeRequire(
    "@rowsncolumns/calculation-worker",
  ) as typeof import("@rowsncolumns/calculation-worker");
  const { functions } = nodeRequire(
    "@rowsncolumns/functions/server",
  ) as typeof import("@rowsncolumns/functions/server");

  spreadsheetDepsCache = {
    Spreadsheet,
    FormulaError,
    attachCalculationWorker,
    functions,
  };

  return spreadsheetDepsCache;
};

export type ShareDBSpreadsheetDoc<
  T extends SpreadsheetCellData = SpreadsheetCellData,
> = {
  sheetData?: Record<string, CellDataV3<T>>;
  sheets?: Array<{ sheetId: number; title: string }>;
  tables?: unknown[];
  charts?: unknown[];
  embeds?: unknown[];
  namedRanges?: unknown[];
  pivotTables?: unknown[];
  dataValidations?: unknown[];
  conditionalFormats?: unknown[];
  cellXfs?: Record<string, unknown>;
  sharedStrings?: Record<string, string>;
};

export type ToolCellData = {
  value?: string | number | boolean | null;
  formula?: string;
};

class InlineWorkerScope extends EventTarget {
  constructor(private readonly notifyParent: (data: any) => void) {
    super();
  }

  postMessage(data: any) {
    this.notifyParent(data);
  }
}

class InlineWorker extends EventTarget {
  private readonly scope: InlineWorkerScope;
  private readonly disposeRuntime: { dispose(): void };

  constructor(options?: WorkerRuntimeOptions) {
    super();
    const { attachCalculationWorker } = getSpreadsheetDeps();
    this.scope = new InlineWorkerScope((message) => {
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent("message", { data: message }));
      });
    });
    this.disposeRuntime = attachCalculationWorker(this.scope as any, options);
  }

  postMessage(message: any) {
    queueMicrotask(() => {
      this.scope.dispatchEvent(new MessageEvent("message", { data: message }));
    });
  }

  terminate() {
    this.disposeRuntime.dispose();
  }
}

type SpreadsheetPatchTuples = Parameters<typeof applyPatchesToShareDBDoc>[1];

/**
 * Connect to ShareDB and fetch a document once.
 */
export const getShareDBDocument = (
  docId: string,
): Promise<{
  doc: ShareDBClient.Doc;
  connection: ShareDBClient.Connection;
  close: () => void;
}> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SHAREDB_URL);
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        ws.close();
      }
    };

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error(`ShareDB connection/fetch timeout for doc: ${docId}`));
      }
    }, 10000);

    ws.on("open", () => {
      console.log(`[ShareDB] WebSocket open, fetching doc: ${docId}`);
      const connection = new ShareDBClient.Connection(ws as never);
      const doc = connection.get(SHAREDB_COLLECTION, docId);

      doc.fetch((err) => {
        clearTimeout(timeoutId);
        if (resolved) return;

        if (err) {
          console.error(`[ShareDB] Fetch error for doc ${docId}:`, err);
          cleanup();
          reject(err);
          return;
        }

        console.log(
          `[ShareDB] Fetched doc: ${docId}, exists: ${doc.type !== null}`,
        );
        resolved = true;
        resolve({
          doc,
          connection,
          close: () => {
            doc.destroy();
            ws.close();
          },
        });
      });
    });

    ws.on("error", (err) => {
      clearTimeout(timeoutId);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
};

/**
 * Convert tool cell input into changeBatch values.
 */
export const cellsToValues = (
  cells: ToolCellData[][],
): (string | number | boolean | undefined | null)[][] => {
  return cells.map((row) =>
    row.map((cell) => {
      if (cell.formula) {
        return cell.formula;
      }
      return cell.value;
    }),
  );
};

/**
 * Create and hydrate a Spreadsheet instance from ShareDB document data.
 */
export const createSpreadsheetInterface = (
  data: ShareDBSpreadsheetDoc<SpreadsheetCellData>,
) => {
  const { Spreadsheet, functions } = getSpreadsheetDeps();
  const spreadsheet = new Spreadsheet({
    createCalculationWorker: () =>
      new InlineWorker({
        functions,
      }) as any,
  });

  spreadsheet.sheetData = convertV3ToSheetData(data.sheetData ?? {});
  spreadsheet.sheets = data.sheets ?? [{ sheetId: 1, title: "Sheet1" }];
  spreadsheet.tables = (data.tables as any[]) ?? [];
  spreadsheet.charts = (data.charts as any[]) ?? [];
  spreadsheet.embeds = (data.embeds as any[]) ?? [];
  spreadsheet.namedRanges = (data.namedRanges as any[]) ?? [];
  spreadsheet.pivotTables = (data.pivotTables as any[]) ?? [];
  spreadsheet.dataValidations = (data.dataValidations as any[]) ?? [];
  spreadsheet.conditionalFormats = (data.conditionalFormats as any[]) ?? [];
  spreadsheet.cellXfs = new Map<string, any>(
    Object.entries(data.cellXfs ?? {}) as Array<[string, any]>,
  );
  spreadsheet.sharedStrings = new Map<string, string>(
    Object.entries(data.sharedStrings ?? {}) as Array<[string, string]>,
  );

  // Rebuild graph
  spreadsheet.rebuildGraph();

  return spreadsheet;
};

/**
 * Evaluate pending formulas and return address->value map.
 */
export const evaluateFormulas = async (
  sheetId: number,
  spreadsheet: ReturnType<typeof createSpreadsheetInterface>,
) => {
  const { FormulaError } = getSpreadsheetDeps();
  const results = await spreadsheet.calculatePending();
  const formulaResults: Record<string, any> = {};

  for (const [position, result] of results) {
    const sheetName =
      position.sheetId === sheetId
        ? undefined
        : spreadsheet.sheets.find((sheet) => sheet.sheetId === position.sheetId)
            ?.title;
    const address = selectionToAddress(
      {
        range: {
          startRowIndex: position.rowIndex,
          endRowIndex: position.rowIndex,
          startColumnIndex: position.columnIndex,
          endColumnIndex: position.columnIndex,
        },
      },
      sheetName,
    );

    if (address) {
      formulaResults[address] =
        result instanceof FormulaError ? String(result) : result;
    }
  }

  return formulaResults;
};

/**
 * Persist already-generated patch tuples to ShareDB and wait until write queue drains.
 */
export const persistPatchTuples = async (
  doc: ShareDBClient.Doc,
  patchTuples: SpreadsheetPatchTuples,
  source: "agent" | "user" | "backend" = "agent",
) => {
  await applyPatchesToShareDBDoc(doc, patchTuples, source);
  return patchTuples;
};

/**
 * Persist spreadsheet patches back to ShareDB.
 */
export const persistSpreadsheetPatches = async (
  doc: ShareDBClient.Doc,
  spreadsheet: ReturnType<typeof createSpreadsheetInterface>,
) => {
  const patchTuples = spreadsheet.getPatchTuples();
  await persistPatchTuples(doc, patchTuples, "agent");
  return patchTuples;
};
