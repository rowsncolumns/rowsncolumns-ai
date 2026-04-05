import { createRequire } from "node:module";
import ShareDBClient from "sharedb/lib/client";
import {
  applyPatchesToShareDBDoc,
  convertV3ToSheetData,
  collectSheetDataOps,
  collectArrayOps,
  collectMapOps,
  type CellDataV3,
  type ShareDBOp,
} from "@rowsncolumns/sharedb/helpers";

import { selectionToAddress } from "@rowsncolumns/utils";
import { Spreadsheet } from "@rowsncolumns/spreadsheet-state/server";
import { type CellData as SpreadsheetCellData } from "@rowsncolumns/spreadsheet";
import { FormulaError } from "@rowsncolumns/fast-formula-parser";
import { type Citation } from "@rowsncolumns/common-types";
import {
  attachCalculationWorker,
  type WorkerRuntimeOptions,
} from "@rowsncolumns/calculation-worker";
import { functions } from "@rowsncolumns/functions/server";
import { setAutoFreeze } from "immer";
import {
  trackedSubmitOp,
  type OperationAttribution,
  BACKEND_ATTRIBUTION,
} from "@/lib/operation-history";
import { getShareDbRuntimeContext } from "@/lib/sharedb/runtime-context";

// Re-export for tools.ts to use
export type { OperationAttribution };

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

// Spreadsheet server flows mutate state across multiple stages (changeBatch ->
// calculatePending -> patch extraction). Immer auto-freeze can make intermediate
// arrays/objects non-extensible and throw under concurrent tool execution.
setAutoFreeze(false);

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
  protectedRanges?: unknown[];
  pivotTables?: unknown[];
  dataValidations?: unknown[];
  conditionalFormats?: unknown[];
  cellXfs?: Record<string, unknown>;
  sharedStrings?: Record<string, string>;
  iterativeCalculation?: { enabled: boolean };
  recalcCells?: unknown[];
};

export type ToolCellData = {
  value?: string | number | boolean | null;
  formula?: string;
  citation?: string;
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

const appendQueryParam = (
  baseUrl: string,
  key: string,
  value: string,
): string => {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
};

const getShareDBDocumentOnce = async (
  docId: string,
): Promise<{
  doc: ShareDBClient.Doc;
  connection: ShareDBClient.Connection;
  close: () => void;
}> => {
  const runtimeContext = getShareDbRuntimeContext();
  let resolvedShareDbUrl = SHAREDB_URL;
  if (runtimeContext?.mcpTokenFactory) {
    const token = await runtimeContext
      .mcpTokenFactory({ docId, permission: "edit" })
      .catch(() => null);
    if (token) {
      resolvedShareDbUrl = appendQueryParam(SHAREDB_URL, "mcpToken", token);
    }
  }

  return new Promise((resolve, reject) => {
    const wsHeaders = runtimeContext?.wsHeaders;
    const wsOptions: import("ws").ClientOptions | undefined =
      wsHeaders && Object.keys(wsHeaders).length > 0
        ? { headers: wsHeaders }
        : undefined;
    const ws = wsOptions
      ? new (getWebSocketCtor())(resolvedShareDbUrl, wsOptions)
      : new (getWebSocketCtor())(resolvedShareDbUrl);
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
 * Extract citations from tool cell input into a 2D array of citation strings.
 * Returns undefined if no citations are present.
 */
export const cellsToCitationStrings = (
  cells: ToolCellData[][],
): (string | undefined)[][] | undefined => {
  let hasCitations = false;

  const citations = cells.map((row) =>
    row.map((cell) => {
      if (cell.citation) {
        hasCitations = true;
        return cell.citation;
      }
      return undefined;
    }),
  );

  return hasCitations ? citations : undefined;
};

/**
 * Extract citations from tool cell input and create full citation objects.
 * Returns an object with:
 * - citationStrings: 2D array for changeBatch (or undefined if no citations)
 * - citationObjects: Array of CitationData objects for createBatchCitations
 */
export const cellsToCitations = (
  cells: ToolCellData[][],
  options: {
    sheetId: number;
    startRowIndex: number;
    startColumnIndex: number;
    userId?: string;
    generateId: () => string;
  },
): {
  citationStrings: (string | undefined)[][] | undefined;
  citationObjects: Citation[];
} => {
  const citationObjects: Citation[] = [];
  let hasCitations = false;

  const citationStrings = cells.map((row, rowOffset) =>
    row.map((cell, colOffset) => {
      if (cell.citation) {
        hasCitations = true;

        const cellRow = options.startRowIndex + rowOffset;
        const cellCol = options.startColumnIndex + colOffset;
        const citationId = options.generateId();

        citationObjects.push({
          id: citationId,
          range: {
            sheetId: options.sheetId,
            startRowIndex: cellRow,
            endRowIndex: cellRow,
            startColumnIndex: cellCol,
            endColumnIndex: cellCol,
          },
          citation_string: cell.citation,
          active: true,
          created_at: new Date().toISOString(),
          created_by: options.userId,
        });

        return citationId;
      }
      return undefined;
    }),
  );

  return {
    citationStrings: hasCitations ? citationStrings : undefined,
    citationObjects,
  };
};

/**
 * Create and hydrate a Spreadsheet instance from ShareDB document data.
 */
export const createSpreadsheetInterface = (
  data: ShareDBSpreadsheetDoc<SpreadsheetCellData>,
  rebuildGraph = true,
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
  if (rebuildGraph) {
    try {
      spreadsheet.rebuildGraph();
    } catch (err) {
      console.log("Rebuild Graph: Error when rebuilding graph", err);
    }
  }

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
        result instanceof FormulaError
          ? `${result.error}: ${result.message}`
          : result;
    }
  }

  return formulaResults;
};

/**
 * Ensure the ShareDB document has the required structure for spreadsheet operations.
 * This must be called before applying patches to a potentially empty/new document.
 */
export const ensureDocumentStructure = async (
  doc: ShareDBClient.Doc,
  attribution?: OperationAttribution,
): Promise<void> => {
  const data = doc.data as ShareDBSpreadsheetDoc | null;

  if (!data) {
    return;
  }

  const ops: Array<Record<string, unknown>> = [];

  // Ensure sheetData exists
  if (data.sheetData === undefined) {
    ops.push({ p: ["sheetData"], oi: {} });
  }

  // Ensure sheets array exists with at least one sheet
  if (data.sheets === undefined) {
    ops.push({ p: ["sheets"], oi: [{ sheetId: 1, title: "Sheet1" }] });
  }

  // Ensure other required arrays/objects exist
  if (data.tables === undefined) {
    ops.push({ p: ["tables"], oi: [] });
  }
  if (data.charts === undefined) {
    ops.push({ p: ["charts"], oi: [] });
  }
  if (data.embeds === undefined) {
    ops.push({ p: ["embeds"], oi: [] });
  }
  if (data.namedRanges === undefined) {
    ops.push({ p: ["namedRanges"], oi: [] });
  }
  if (data.protectedRanges === undefined) {
    ops.push({ p: ["protectedRanges"], oi: [] });
  }
  if (data.pivotTables === undefined) {
    ops.push({ p: ["pivotTables"], oi: [] });
  }
  if (data.dataValidations === undefined) {
    ops.push({ p: ["dataValidations"], oi: [] });
  }
  if (data.conditionalFormats === undefined) {
    ops.push({ p: ["conditionalFormats"], oi: [] });
  }
  if (data.cellXfs === undefined) {
    ops.push({ p: ["cellXfs"], oi: {} });
  }
  if (data.sharedStrings === undefined) {
    ops.push({ p: ["sharedStrings"], oi: {} });
  }
  if (data.iterativeCalculation === undefined) {
    ops.push({ p: ["iterativeCalculation"], oi: { enabled: false } });
  }
  if (data.recalcCells === undefined) {
    ops.push({ p: ["recalcCells"], oi: [] });
  }

  if (ops.length === 0) {
    return;
  }

  // Use tracked submit when attribution is provided or tracking is enabled
  const effectiveAttribution = attribution ?? BACKEND_ATTRIBUTION;
  await trackedSubmitOp(doc, ops, effectiveAttribution);
};

/**
 * Collect json0 ops from patch tuples (mirrors applyPatchesToShareDBDoc logic).
 * This allows us to capture the actual ops for undo support.
 */
const collectOpsFromPatchTuples = (
  doc: ShareDBClient.Doc,
  patches: SpreadsheetPatchTuples,
  source: "agent" | "user" | "backend" = "agent",
): ShareDBOp[] => {
  const allOps: ShareDBOp[] = [];
  const recalcUserId = source ?? "agent";
  const recalcCellPatches: Array<{
    op: string;
    path: (string | number)[];
    value: unknown;
  }> = [];
  let recalcCellsLength = Array.isArray(doc.data?.recalcCells)
    ? doc.data.recalcCells.length
    : 0;

  // Helper to get sheetData from doc
  const getSheetData = () => doc.data?.sheetData;

  for (const [patch, tupleType = "redo"] of patches) {
    const type = tupleType ?? "redo";
    const patchKey = type === "redo" ? "patches" : "inversePatches";

    if (patch.sheetData) {
      const sheetDataPatches = patch.sheetData[patchKey];
      const ops = collectSheetDataOps(doc, sheetDataPatches, getSheetData);
      allOps.push(...ops);
    }

    if (patch.sheets) {
      const sheetsPatches = patch.sheets[patchKey];
      const ops = collectArrayOps(doc, "sheets", sheetsPatches);
      allOps.push(...ops);
    }

    if (patch.tables) {
      const tablesPatches = patch.tables[patchKey];
      const ops = collectArrayOps(doc, "tables", tablesPatches);
      allOps.push(...ops);
    }

    if (patch.embeds) {
      const embedsPatches = patch.embeds[patchKey];
      const ops = collectArrayOps(doc, "embeds", embedsPatches);
      allOps.push(...ops);
    }

    if (patch.charts) {
      const chartsPatches = patch.charts[patchKey];
      const ops = collectArrayOps(doc, "charts", chartsPatches);
      allOps.push(...ops);
    }

    if (patch.conditionalFormats) {
      const conditionalFormatsPatches = patch.conditionalFormats[patchKey];
      const ops = collectArrayOps(
        doc,
        "conditionalFormats",
        conditionalFormatsPatches,
      );
      allOps.push(...ops);
    }

    if (patch.dataValidations) {
      const dataValidationsPatches = patch.dataValidations[patchKey];
      const ops = collectArrayOps(
        doc,
        "dataValidations",
        dataValidationsPatches,
      );
      allOps.push(...ops);
    }

    if (patch.namedRanges) {
      const namedRangesPatches = patch.namedRanges[patchKey];
      const ops = collectArrayOps(doc, "namedRanges", namedRangesPatches);
      allOps.push(...ops);
    }

    if (patch.sharedStrings) {
      const sharedStringsPatches = patch.sharedStrings[patchKey];
      const ops = collectMapOps(doc, "sharedStrings", sharedStringsPatches);
      allOps.push(...ops);
    }

    if (patch.protectedRanges) {
      const protectedRangesPatches = patch.protectedRanges[patchKey];
      const ops = collectArrayOps(
        doc,
        "protectedRanges",
        protectedRangesPatches,
      );
      allOps.push(...ops);
    }

    if (patch.cellXfs) {
      const cellXfsPatches = patch.cellXfs[patchKey];
      const ops = collectMapOps(doc, "cellXfs", cellXfsPatches);
      allOps.push(...ops);
    }

    if (patch.pivotTables) {
      // Initialize pivotTables array if it doesn't exist (backward compatibility)
      if (!doc.data?.pivotTables) {
        allOps.push({ p: ["pivotTables"], oi: [] });
      }
      const pivotTablesPatches = patch.pivotTables[patchKey];
      const ops = collectArrayOps(doc, "pivotTables", pivotTablesPatches);
      allOps.push(...ops);
    }

    if (patch.slicers) {
      // Initialize slicers array if it doesn't exist (backward compatibility)
      if (!doc.data?.slicers) {
        allOps.push({ p: ["slicers"], oi: [] });
      }
      const slicersPatches = patch.slicers[patchKey];
      const ops = collectArrayOps(doc, "slicers", slicersPatches);
      allOps.push(...ops);
    }

    if (patch.citations) {
      // Initialize citations array if it doesn't exist (backward compatibility)
      if (!doc.data?.citations) {
        allOps.push({ p: ["citations"], oi: [] });
      }
      const citationsPatches = patch.citations[patchKey];
      const ops = collectArrayOps(doc, "citations", citationsPatches);
      allOps.push(...ops);
    }

    if (patch.recalcCells?.[type]) {
      recalcCellPatches.push({
        op: "add",
        path: [recalcCellsLength],
        value: {
          userId: recalcUserId,
          patches: Array.from(patch.recalcCells[type]).map(
            (value: [unknown, unknown]) => [
              value[0],
              value[1],
              source ?? "agent",
            ],
          ),
        },
      });
      recalcCellsLength += 1;
    }
  }

  if (recalcCellPatches.length > 0) {
    // Backward compatibility: older docs may not have recalcCells initialized.
    if (!Array.isArray(doc.data?.recalcCells)) {
      allOps.push({ p: ["recalcCells"], oi: [] });
    }
    allOps.push(
      ...collectArrayOps(
        doc,
        "recalcCells",
        recalcCellPatches as unknown as import("immer").Patch[],
      ),
    );
  }

  return allOps;
};

/**
 * Persist already-generated patch tuples to ShareDB and wait until write queue drains.
 * Tracks operations with actual json0 ops for proper undo capability.
 */
export const persistPatchTuples = async (
  doc: ShareDBClient.Doc,
  patchTuples: SpreadsheetPatchTuples,
  source: "agent" | "user" | "backend" = "agent",
  attribution?: OperationAttribution,
) => {
  // Auto-generate attribution if not provided
  const effectiveAttribution: OperationAttribution = attribution ?? {
    source,
    actorType:
      source === "agent" ? "assistant" : source === "user" ? "user" : "system",
    actorId:
      source === "agent"
        ? "spreadsheet-agent"
        : source === "user"
          ? "unknown-user"
          : "system",
  };

  // Collect the json0 ops from patch tuples (same logic as applyPatchesToShareDBDoc)
  const ops = collectOpsFromPatchTuples(doc, patchTuples, source);

  if (ops.length === 0) {
    return patchTuples;
  }

  // Always submit via tracked wrapper. It handles enabled/disabled tracking via flags.
  await trackedSubmitOp(doc, ops, effectiveAttribution, { source });

  return patchTuples;
};

/**
 * Persist spreadsheet patches back to ShareDB.
 * Automatically ensures document structure exists before applying patches.
 * Optionally tracks the operation for undo capability when attribution is provided.
 */
export const persistSpreadsheetPatches = async (
  doc: ShareDBClient.Doc,
  spreadsheet: InstanceType<typeof Spreadsheet>,
  attribution?: OperationAttribution,
) => {
  // Ensure document has required structure before applying patches
  await ensureDocumentStructure(doc, attribution);

  const patchTuples = spreadsheet.getPatchTuples();
  await persistPatchTuples(doc, patchTuples, "agent", attribution);
  return patchTuples;
};
