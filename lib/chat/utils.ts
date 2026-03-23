import { createRequire } from "node:module";
import ShareDBClient from "sharedb/lib/client";
import {
  applyPatchesToShareDBDoc,
  convertV3ToSheetData,
  type CellDataV3,
} from "@rowsncolumns/sharedb/helpers";

import { selectionToAddress } from "@rowsncolumns/utils";
import { Spreadsheet } from "@rowsncolumns/spreadsheet-state/server";
import { type CellData as SpreadsheetCellData } from "@rowsncolumns/spreadsheet";
import { FormulaError } from "@rowsncolumns/fast-formula-parser";
import {
  attachCalculationWorker,
  type WorkerRuntimeOptions,
} from "@rowsncolumns/calculation-worker";
import { functions } from "@rowsncolumns/functions/server";

const SHAREDB_URL = process.env.SHAREDB_URL || "ws://localhost:8080";
const SHAREDB_COLLECTION = process.env.SHAREDB_COLLECTION || "spreadsheets";
const SHAREDB_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.SHAREDB_FETCH_TIMEOUT_MS ?? "25000",
  10,
);
const SHAREDB_FETCH_MAX_RETRIES = Number.parseInt(
  process.env.SHAREDB_FETCH_MAX_RETRIES ?? "2",
  10,
);
const SHAREDB_FETCH_RETRY_BASE_DELAY_MS = Number.parseInt(
  process.env.SHAREDB_FETCH_RETRY_BASE_DELAY_MS ?? "250",
  10,
);
const nodeRequire = createRequire(import.meta.url);

// Ensure ws skips optional native addons in bundled server runtime.
if (!process.env.WS_NO_BUFFER_UTIL) {
  process.env.WS_NO_BUFFER_UTIL = "1";
}
if (!process.env.WS_NO_UTF_8_VALIDATE) {
  process.env.WS_NO_UTF_8_VALIDATE = "1";
}

let WebSocketCtor: typeof import("ws").WebSocket | null = null;

const getWebSocketCtor = () => {
  if (WebSocketCtor) {
    return WebSocketCtor;
  }

  const wsModule = nodeRequire("ws") as typeof import("ws");
  WebSocketCtor = wsModule.WebSocket;

  return WebSocketCtor;
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

const getNormalizedPositiveInt = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;

const FETCH_TIMEOUT_MS = getNormalizedPositiveInt(
  SHAREDB_FETCH_TIMEOUT_MS,
  25000,
);
const FETCH_MAX_RETRIES = Math.max(
  0,
  getNormalizedPositiveInt(SHAREDB_FETCH_MAX_RETRIES, 2),
);
const FETCH_RETRY_BASE_DELAY_MS = getNormalizedPositiveInt(
  SHAREDB_FETCH_RETRY_BASE_DELAY_MS,
  250,
);

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const computeBackoffDelayMs = (attemptIndex: number) => {
  const exponential = FETCH_RETRY_BASE_DELAY_MS * 2 ** attemptIndex;
  const capped = Math.min(exponential, 3000);
  const jitter = Math.floor(Math.random() * 200);
  return capped + jitter;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isRetryableShareDbError = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("connection terminated unexpectedly") ||
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("network") ||
    message.includes("websocket") ||
    message.includes("closed")
  );
};

const safeCloseWebSocket = (ws: import("ws").WebSocket) => {
  try {
    ws.close();
  } catch {
    // Ignore close errors.
  }
};

const getShareDBDocumentOnce = (
  docId: string,
): Promise<{
  doc: ShareDBClient.Doc;
  connection: ShareDBClient.Connection;
  close: () => void;
}> => {
  return new Promise((resolve, reject) => {
    const ws = new (getWebSocketCtor())(SHAREDB_URL);
    let settled = false;
    let doc: ShareDBClient.Doc | null = null;

    const finalizeReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (doc) {
        try {
          doc.destroy();
        } catch {
          // Ignore destroy errors.
        }
      }
      safeCloseWebSocket(ws);
      reject(error);
    };

    const finalizeResolve = (payload: {
      doc: ShareDBClient.Doc;
      connection: ShareDBClient.Connection;
      close: () => void;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(payload);
    };

    const timeoutId = setTimeout(() => {
      finalizeReject(
        new Error(`ShareDB connection/fetch timeout for doc: ${docId}`),
      );
    }, FETCH_TIMEOUT_MS);

    ws.once("open", () => {
      console.log(`[ShareDB] WebSocket open, fetching doc: ${docId}`);
      const connection = new ShareDBClient.Connection(ws as never);
      const fetchedDoc = connection.get(SHAREDB_COLLECTION, docId);
      doc = fetchedDoc;

      fetchedDoc.fetch((err) => {
        if (err) {
          console.error(`[ShareDB] Fetch error for doc ${docId}:`, err);
          finalizeReject(err instanceof Error ? err : new Error(String(err)));
          return;
        }

        console.log(
          `[ShareDB] Fetched doc: ${docId}, exists: ${fetchedDoc.type !== null}`,
        );
        finalizeResolve({
          doc: fetchedDoc,
          connection,
          close: () => {
            try {
              fetchedDoc.destroy();
            } catch {
              // Ignore destroy errors.
            }
            safeCloseWebSocket(ws);
          },
        });
      });
    });

    ws.once("error", (err) => {
      finalizeReject(err instanceof Error ? err : new Error(String(err)));
    });

    ws.once("close", (code, reason) => {
      if (settled) {
        return;
      }
      const reasonText =
        typeof reason === "string"
          ? reason
          : reason?.toString("utf8") || "unknown";
      finalizeReject(
        new Error(
          `ShareDB websocket closed before fetch completed (code=${code}, reason=${reasonText})`,
        ),
      );
    });
  });
};

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
  const totalAttempts = FETCH_MAX_RETRIES + 1;

  const run = async () => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      try {
        return await getShareDBDocumentOnce(docId);
      } catch (error) {
        lastError = error;
        const shouldRetry =
          attempt < totalAttempts - 1 && isRetryableShareDbError(error);
        if (!shouldRetry) {
          throw error;
        }

        const delayMs = computeBackoffDelayMs(attempt);
        console.warn(
          `[ShareDB] getShareDBDocument retry ${attempt + 1}/${FETCH_MAX_RETRIES} for doc ${docId} after error: ${getErrorMessage(error)}. Retrying in ${delayMs}ms.`,
        );
        await wait(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to fetch ShareDB document: ${docId}`);
  };

  return run();
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
  spreadsheet: InstanceType<typeof Spreadsheet>,
) => {
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
  spreadsheet: InstanceType<typeof Spreadsheet>,
) => {
  const patchTuples = spreadsheet.getPatchTuples();
  await persistPatchTuples(doc, patchTuples, "agent");
  return patchTuples;
};
