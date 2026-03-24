import { inspect } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  isReadOnlyTool,
  spreadsheetMcpTools,
  toolNameToTitle,
} from "./tool-catalog";
import {
  getShareDBDocument,
  type ShareDBSpreadsheetDoc,
} from "../lib/chat/utils";
import { resolveAppBaseUrl, resolveAppOrigin } from "./app-url";
import { selectionToAddress, uuidString } from "@rowsncolumns/utils";
import { buildSpreadsheetContextPayload } from "../lib/chat/context";

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const stringifySafe = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return inspect(value, { depth: 6, breakLength: 120 });
  }
};

const parseJsonRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeToolResult = (value: unknown) => {
  if (typeof value === "string") {
    const structured = parseJsonRecord(value);
    return {
      content: [{ type: "text" as const, text: value }],
      ...(structured ? { structuredContent: structured } : {}),
    };
  }

  if (isPlainRecord(value)) {
    return {
      content: [{ type: "text" as const, text: stringifySafe(value) }],
      structuredContent: value,
    };
  }

  return {
    content: [{ type: "text" as const, text: stringifySafe(value) }],
  };
};

const SPREADSHEET_APP_RESOURCE_URI =
  "ui://rowsncolumns/spreadsheet-view-v3.html";
const MCP_PUBLIC_DOC_BASE_PATH = "/mcp/doc";
const MCP_WIDGET_BUNDLE_JS_PATH = path.join(
  process.cwd(),
  "public",
  "mcp",
  "spreadsheet-widget.bundle.js",
);
const MCP_WIDGET_BUNDLE_CSS_PATH = path.join(
  process.cwd(),
  "public",
  "mcp",
  "spreadsheet-widget.bundle.css",
);

let widgetBundleCache: { js: string; css: string } | null = null;
const uiStateByDocId = new Map<
  string,
  {
    activeSheetId?: number;
    activeCell?: { rowIndex: number; columnIndex: number };
    selections?: Array<{
      startRowIndex: number;
      endRowIndex: number;
      startColumnIndex: number;
      endColumnIndex: number;
    }>;
    locale?: string;
    currency?: string;
    updatedAt: string;
  }
>();

const resolveUiDomain = () => {
  const value = process.env.MCP_UI_DOMAIN?.trim();
  if (value) {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return value;
    }
    return `https://${value}`;
  }

  const appOrigin = resolveAppOrigin();
  if (!appOrigin) {
    return null;
  }

  const host = new URL(appOrigin).hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  ) {
    return null;
  }

  return appOrigin;
};

const normalizeShareDbUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
      return parsed.toString();
    }
    if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
      return parsed.toString();
    }
    if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
      return parsed.toString();
    }
  } catch {
    // Fall through to prefix handling.
  }

  const isLocalHost =
    trimmed.startsWith("localhost") ||
    trimmed.startsWith("127.0.0.1") ||
    trimmed.startsWith("[::1]");
  const protocol = isLocalHost ? "ws" : "wss";
  return `${protocol}://${trimmed}`;
};

const resolveShareDbUrl = () =>
  normalizeShareDbUrl(
    process.env.MCP_SHAREDB_URL?.trim() ||
      process.env.NEXT_PUBLIC_SHAREDB_URL?.trim() ||
      null,
  );

const resolveShareDbPort = () =>
  process.env.MCP_SHAREDB_PORT?.trim() ||
  process.env.NEXT_PUBLIC_SHAREDB_PORT?.trim() ||
  null;

const resolveWidgetLocale = () =>
  process.env.MCP_WIDGET_LOCALE?.trim() ||
  process.env.NEXT_PUBLIC_LOCALE?.trim() ||
  "en-US";

const resolveWidgetCurrency = () =>
  process.env.MCP_WIDGET_CURRENCY?.trim() ||
  process.env.NEXT_PUBLIC_CURRENCY?.trim() ||
  "USD";

const safeOrigin = (raw: string | null) => {
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
};

const columnIndexToName = (columnIndex: number) => {
  let n = columnIndex;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
};

const cellToA1 = (cell: { rowIndex: number; columnIndex: number } | null) => {
  if (!cell) return null;
  if (!Number.isFinite(cell.rowIndex) || !Number.isFinite(cell.columnIndex)) {
    return null;
  }
  if (cell.rowIndex < 1 || cell.columnIndex < 1) {
    return null;
  }
  return `${columnIndexToName(cell.columnIndex)}${cell.rowIndex}`;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  isPlainRecord(value) ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asStringRecord = (value: unknown): Record<string, string> | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") {
      next[key] = entry;
    }
  }
  return Object.keys(next).length > 0 ? next : null;
};

type GridRange = {
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
};

const readRange = (value: unknown): GridRange | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const startRowIndex = asNumber(record.startRowIndex);
  const endRowIndex = asNumber(record.endRowIndex);
  const startColumnIndex = asNumber(record.startColumnIndex);
  const endColumnIndex = asNumber(record.endColumnIndex);

  if (
    startRowIndex === null ||
    endRowIndex === null ||
    startColumnIndex === null ||
    endColumnIndex === null
  ) {
    return null;
  }

  return {
    startRowIndex,
    endRowIndex,
    startColumnIndex,
    endColumnIndex,
  };
};

const toA1Range = (
  range: GridRange | null,
  sheetName?: string,
): string | null => {
  if (!range) {
    return null;
  }

  return (
    selectionToAddress(
      {
        range,
      },
      sheetName,
    ) ?? null
  );
};

const MAX_CONTEXT_ITEMS = 200;

const limitSummaries = <T>(items: T[]) =>
  items.length > MAX_CONTEXT_ITEMS ? items.slice(0, MAX_CONTEXT_ITEMS) : items;

const buildSheetNameById = (
  sheets: Array<{ sheetId: number; title: string }>,
) => {
  const lookup = new Map<number, string>();
  for (const sheet of sheets) {
    if (typeof sheet.sheetId === "number" && typeof sheet.title === "string") {
      lookup.set(sheet.sheetId, sheet.title);
    }
  }
  return lookup;
};

const buildTableSummaries = ({
  tables,
  sheetNameById,
}: {
  tables: unknown[];
  sheetNameById: Map<number, string>;
}) =>
  limitSummaries(
    tables.flatMap((entry) => {
      const table = asRecord(entry);
      if (!table) {
        return [];
      }

      const tableId = table.id ?? table.tableId;
      const sheetId = asNumber(table.sheetId);
      if (
        (typeof tableId !== "string" && typeof tableId !== "number") ||
        sheetId === null
      ) {
        return [];
      }

      const title = asString(table.title) ?? `Table ${tableId}`;
      const range = readRange(table.range);
      const ref =
        toA1Range(range, sheetNameById.get(sheetId)) ??
        asString(table.ref) ??
        "";
      const columnsRaw = Array.isArray(table.columns) ? table.columns : [];
      const columns = columnsRaw.flatMap((columnEntry) => {
        const column = asRecord(columnEntry);
        const name = column ? asString(column.name) : null;
        return name ? [name] : [];
      });

      return [
        {
          tableId,
          title,
          sheetId,
          ref,
          columns,
        },
      ];
    }),
  );

const buildChartSummaries = ({
  charts,
  sheetNameById,
}: {
  charts: unknown[];
  sheetNameById: Map<number, string>;
}) =>
  limitSummaries(
    charts.flatMap((entry) => {
      const chart = asRecord(entry);
      if (!chart) {
        return [];
      }

      const chartId = chart.chartId ?? chart.id;
      if (typeof chartId !== "string" && typeof chartId !== "number") {
        return [];
      }

      const spec = asRecord(chart.spec);
      const position = asRecord(chart.position);
      const sheetId = asNumber(position?.sheetId ?? chart.sheetId) ?? undefined;
      const title = asString(spec?.title ?? chart.title);
      const subtitle = asString(spec?.subtitle ?? chart.subtitle);
      const chartType =
        asString(spec?.chartType ?? chart.chartType) ?? undefined;

      const directDataRange = readRange(spec?.dataRange);
      const domains = Array.isArray(spec?.domains) ? spec.domains : [];
      const firstDomain = asRecord(domains[0]);
      const sources = Array.isArray(firstDomain?.sources)
        ? firstDomain.sources
        : [];
      const firstSource = asRecord(sources[0]);
      const sourceRange = readRange(firstSource);
      const sourceSheetId = asNumber(firstSource?.sheetId) ?? sheetId;
      const dataRange =
        toA1Range(
          directDataRange ?? sourceRange,
          sourceSheetId ? sheetNameById.get(sourceSheetId) : undefined,
        ) ??
        asString(spec?.dataRange) ??
        null;

      return [
        {
          chartId,
          ...(sheetId ? { sheetId } : {}),
          ...(title ? { title } : {}),
          ...(subtitle ? { subtitle } : {}),
          ...(chartType ? { chartType } : {}),
          ...(dataRange ? { dataRange } : {}),
        },
      ];
    }),
  );

const buildThemeSummary = (value: unknown) => {
  const theme = asRecord(value);
  if (!theme) {
    return undefined;
  }

  const summary = {
    ...(asString(theme.name) ? { name: asString(theme.name)! } : {}),
    ...(asString(theme.primaryFontFamily)
      ? { primaryFontFamily: asString(theme.primaryFontFamily)! }
      : {}),
    ...(asStringRecord(theme.themeColorKeysByIndex)
      ? { themeColorKeysByIndex: asStringRecord(theme.themeColorKeysByIndex)! }
      : {}),
    ...(asStringRecord(theme.themeColorsByIndex)
      ? { themeColorsByIndex: asStringRecord(theme.themeColorsByIndex)! }
      : {}),
    ...(asStringRecord(theme.darkThemeColors)
      ? { darkThemeColors: asStringRecord(theme.darkThemeColors)! }
      : {}),
  };

  return Object.keys(summary).length > 0 ? summary : undefined;
};

const readWidgetBundle = async () => {
  if (widgetBundleCache !== null) {
    return widgetBundleCache;
  }

  const jsFallback = `console.error("RowsnColumns MCP widget bundle not found. Run: npm run mcp:build-widget");`;
  const cssFallback = "";

  try {
    const js = await readFile(MCP_WIDGET_BUNDLE_JS_PATH, "utf8");
    const css = await readFile(MCP_WIDGET_BUNDLE_CSS_PATH, "utf8").catch(
      () => cssFallback,
    );
    widgetBundleCache = { js, css };
    return widgetBundleCache;
  } catch {
    widgetBundleCache = { js: jsFallback, css: cssFallback };
    return widgetBundleCache;
  }
};

const readSpreadsheetDocument = async (
  docId: string,
): Promise<ShareDBSpreadsheetDoc | null> => {
  const { doc, close } = await getShareDBDocument(docId);
  try {
    if (doc.type === null || !doc.data) {
      return null;
    }
    return doc.data as ShareDBSpreadsheetDoc;
  } finally {
    close();
  }
};

const createSpreadsheetDocument = async ({
  docId,
  sheetTitle,
}: {
  docId: string;
  sheetTitle?: string;
}): Promise<{ created: boolean; exists: boolean }> => {
  const normalizedSheetTitle =
    typeof sheetTitle === "string" && sheetTitle.trim().length > 0
      ? sheetTitle.trim()
      : "Sheet1";

  const { doc, close } = await getShareDBDocument(docId);
  try {
    if (doc.type !== null) {
      return { created: false, exists: true };
    }

    const initialDoc: ShareDBSpreadsheetDoc = {
      sheets: [{ sheetId: 1, title: normalizedSheetTitle }],
      sheetData: {},
      tables: [],
      charts: [],
      embeds: [],
      namedRanges: [],
      pivotTables: [],
      dataValidations: [],
      conditionalFormats: [],
      cellXfs: {},
      sharedStrings: {},
    };

    await new Promise<void>((resolve, reject) => {
      (
        doc as {
          create: (
            data: ShareDBSpreadsheetDoc,
            type: string,
            callback?: (error?: unknown) => void,
          ) => void;
        }
      ).create(initialDoc, "json0", (error?: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    return { created: true, exists: false };
  } finally {
    close();
  }
};

const buildSpreadsheetAppHtml = async ({
  appBaseUrl,
  shareDbUrl,
  shareDbPort,
  locale,
  currency,
}: {
  appBaseUrl: string;
  shareDbUrl: string | null;
  shareDbPort: string | null;
  locale: string;
  currency: string;
}) => {
  const bundle = await readWidgetBundle();
  const safeBundle = bundle.js.replace(/<\/script/gi, "<\\/script");
  const safeBundleCss = bundle.css.replace(/<\/style/gi, "<\\/style");
  const configJson = JSON.stringify({
    appBaseUrl,
    shareDbUrl,
    shareDbPort,
    locale,
    currency,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RowsnColumns Spreadsheet</title>
  <style>${safeBundleCss}</style>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: #0f1115;
      color: #f3f6fb;
    }
    #app {
      min-height: 100dvh;
      height: 100dvh;
      display: flex;
      flex-direction: column;
    }
    .rnc-widget-sheet {
      min-height: 680px;
      display: flex;
      flex-direction: column;
    }
    .rnc-canvas-wrapper {
      min-height: 0;
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .rnc-widget-placeholder {
      margin: 8px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: #171a21;
      border-radius: 10px;
      padding: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .rnc-widget-meta {
      color: #a9b1c3;
      font-size: 12px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>window.__RNC_MCP_WIDGET_CONFIG__ = ${configJson};</script>
  <script>${safeBundle}</script>
</body>
</html>`;
};

export const registerSpreadsheetTools = (server: McpServer) => {
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: unknown;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
    },
    cb: (args: unknown) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      structuredContent?: Record<string, unknown>;
    }>,
  ) => void;

  for (const spreadsheetTool of spreadsheetMcpTools) {
    const readOnlyHint = isReadOnlyTool(spreadsheetTool.name);

    registerTool(
      spreadsheetTool.name,
      {
        title: toolNameToTitle(spreadsheetTool.name),
        description: spreadsheetTool.description,
        inputSchema: spreadsheetTool.schema,
        annotations: {
          readOnlyHint,
          destructiveHint: !readOnlyHint,
        },
      },
      async (args: unknown) => {
        const result = await spreadsheetTool.invoke(args);
        return normalizeToolResult(result);
      },
    );
  }

  registerTool(
    "spreadsheet_getContext",
    {
      title: "Get Spreadsheet Context",
      description:
        "Returns spreadsheet context instructions for the model. Use verbose=true to include full metadata JSON.",
      inputSchema: {
        docId: z.string().min(1).describe("Spreadsheet document ID"),
        verbose: z
          .boolean()
          .optional()
          .describe("When true, include full context metadata in structuredContent"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async (args: unknown) => {
      const parsed = z
        .object({
          docId: z.string().min(1),
          verbose: z.boolean().optional(),
        })
        .parse(args);
      const data = await readSpreadsheetDocument(parsed.docId);
      const uiState = uiStateByDocId.get(parsed.docId) ?? null;

      if (!data) {
        return {
          content: [
            {
              type: "text",
              text: `Document ${parsed.docId} was not found.`,
            },
          ],
          structuredContent: {
            docId: parsed.docId,
            exists: false,
          },
        };
      }

      const sheetsRaw = Array.isArray(data.sheets) ? data.sheets : [];
      const sheets = sheetsRaw.flatMap((entry) => {
        const sheet = asRecord(entry);
        const sheetId = asNumber(sheet?.sheetId);
        const title = asString(sheet?.title);
        if (sheetId === null || !title) {
          return [];
        }
        return [{ sheetId, title }];
      });
      const sheetNameById = buildSheetNameById(sheets);
      const tables = Array.isArray(data.tables)
        ? buildTableSummaries({
            tables: data.tables,
            sheetNameById,
          })
        : [];
      const charts = Array.isArray(data.charts)
        ? buildChartSummaries({
            charts: data.charts,
            sheetNameById,
          })
        : [];
      const activeSheetId =
        uiState?.activeSheetId ??
        (sheets[0] && typeof sheets[0].sheetId === "number"
          ? sheets[0].sheetId
          : null);
      const activeSheetTitle =
        sheets.find((sheet) => sheet.sheetId === activeSheetId)?.title ?? null;
      const localeForContext = uiState?.locale ?? resolveWidgetLocale();
      const currencyForContext = uiState?.currency ?? resolveWidgetCurrency();
      const activeCell = uiState?.activeCell ?? null;
      const activeCellA1 = cellToA1(activeCell);
      const themeSummary = buildThemeSummary(
        (data as Record<string, unknown>).theme,
      );
      const cellXfsRecord = asRecord(data.cellXfs) ?? null;
      const { assistantContext, contextInstructions } =
        buildSpreadsheetContextPayload({
          documentId: parsed.docId,
          sheets,
          activeSheetId,
          activeCell: activeCell
            ? {
                rowIndex: activeCell.rowIndex,
                columnIndex: activeCell.columnIndex,
                a1Address: activeCellA1,
              }
            : null,
          cellXfs: cellXfsRecord,
          tables,
          charts,
          theme: themeSummary,
        });
      const context = {
        docId: parsed.docId,
        exists: true,
        locale: localeForContext,
        currency: currencyForContext,
        sheetCount: sheets.length,
        sheets,
        activeSheetId,
        activeSheetTitle,
        activeCell: activeCell
          ? {
              rowIndex: activeCell.rowIndex,
              columnIndex: activeCell.columnIndex,
              a1Address: activeCellA1,
            }
          : null,
        selections: uiState?.selections ?? [],
        cellXfs: cellXfsRecord ?? undefined,
        tables,
        charts,
        theme: themeSummary,
        tablesCount: Array.isArray(data.tables) ? data.tables.length : 0,
        chartsCount: Array.isArray(data.charts) ? data.charts.length : 0,
        namedRangesCount: Array.isArray(data.namedRanges)
          ? data.namedRanges.length
          : 0,
        pivotTablesCount: Array.isArray(data.pivotTables)
          ? data.pivotTables.length
          : 0,
        dataValidationsCount: Array.isArray(data.dataValidations)
          ? data.dataValidations.length
          : 0,
        conditionalFormatsCount: Array.isArray(data.conditionalFormats)
          ? data.conditionalFormats.length
          : 0,
        updatedAt: uiState?.updatedAt ?? null,
        assistantContext,
        contextInstructions,
      };

      const minimalContext = {
        docId: parsed.docId,
        exists: true,
        assistantContext,
        contextInstructions,
      };

      return {
        content: [
          {
            type: "text",
            text: contextInstructions,
          },
        ],
        structuredContent: parsed.verbose ? context : minimalContext,
      };
    },
  );

  registerAppTool(
    server,
    "spreadsheet_syncUiState",
    {
      title: "Sync Spreadsheet UI State",
      description:
        "App-only tool: syncs active sheet/cell/selections from the interactive spreadsheet UI.",
      inputSchema: {
        docId: z.string().min(1),
        activeSheetId: z.number().int().positive().optional(),
        activeCell: z
          .object({
            rowIndex: z.number().int().nonnegative(),
            columnIndex: z.number().int().nonnegative(),
          })
          .optional(),
        selections: z
          .array(
            z.object({
              startRowIndex: z.number().int().nonnegative(),
              endRowIndex: z.number().int().nonnegative(),
              startColumnIndex: z.number().int().nonnegative(),
              endColumnIndex: z.number().int().nonnegative(),
            }),
          )
          .optional(),
        locale: z.string().min(2).optional(),
        currency: z.string().min(3).max(3).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async (args: unknown) => {
      const parsed = z
        .object({
          docId: z.string().min(1),
          activeSheetId: z.number().int().positive().optional(),
          activeCell: z
            .object({
              rowIndex: z.number().int().nonnegative(),
              columnIndex: z.number().int().nonnegative(),
            })
            .optional(),
          selections: z
            .array(
              z.object({
                startRowIndex: z.number().int().nonnegative(),
                endRowIndex: z.number().int().nonnegative(),
                startColumnIndex: z.number().int().nonnegative(),
                endColumnIndex: z.number().int().nonnegative(),
              }),
            )
            .optional(),
          locale: z.string().min(2).optional(),
          currency: z.string().min(3).max(3).optional(),
        })
        .parse(args);

      uiStateByDocId.set(parsed.docId, {
        ...(parsed.activeSheetId !== undefined
          ? { activeSheetId: parsed.activeSheetId }
          : {}),
        ...(parsed.activeCell ? { activeCell: parsed.activeCell } : {}),
        ...(parsed.selections ? { selections: parsed.selections } : {}),
        ...(parsed.locale ? { locale: parsed.locale } : {}),
        ...(parsed.currency ? { currency: parsed.currency.toUpperCase() } : {}),
        updatedAt: new Date().toISOString(),
      });

      return {
        content: [{ type: "text", text: "UI state synced." }],
        structuredContent: {
          docId: parsed.docId,
          synced: true,
        },
      };
    },
  );

  const appBaseUrl = resolveAppBaseUrl();
  const appOrigin = resolveAppOrigin();
  const uiDomain = resolveUiDomain();
  const shareDbUrl = resolveShareDbUrl();
  const shareDbPort = resolveShareDbPort();
  const locale = resolveWidgetLocale();
  const currency = resolveWidgetCurrency();
  const shareDbOrigin = safeOrigin(shareDbUrl);
  const connectDomains = [appOrigin, shareDbOrigin].filter(
    (value): value is string => Boolean(value),
  );
  const resourceDomains = [appOrigin].filter((value): value is string =>
    Boolean(value),
  );

  const buildSpreadsheetResourceResult = async () => ({
    contents: [
      {
        uri: SPREADSHEET_APP_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await buildSpreadsheetAppHtml({
          appBaseUrl,
          shareDbUrl,
          shareDbPort,
          locale,
          currency,
        }),
        _meta: {
          ui: {
            prefersBorder: false,
            ...(connectDomains.length > 0 || resourceDomains.length > 0
              ? {
                  csp: {
                    ...(connectDomains.length > 0 ? { connectDomains } : {}),
                    ...(resourceDomains.length > 0 ? { resourceDomains } : {}),
                  },
                }
              : {}),
            ...(uiDomain ? { domain: uiDomain } : {}),
          },
        },
      },
    ],
  });

  registerAppResource(
    server,
    "RowsnColumns Spreadsheet View",
    SPREADSHEET_APP_RESOURCE_URI,
    {
      title: "RowsnColumns Spreadsheet View",
      description: "Interactive spreadsheet UI rendered inline in MCP clients.",
      _meta: {
        ui: {
          prefersBorder: false,
          ...(connectDomains.length > 0 || resourceDomains.length > 0
            ? {
                csp: {
                  ...(connectDomains.length > 0 ? { connectDomains } : {}),
                  ...(resourceDomains.length > 0 ? { resourceDomains } : {}),
                },
              }
            : {}),
          ...(uiDomain ? { domain: uiDomain } : {}),
        },
      },
    },
    buildSpreadsheetResourceResult,
  );

  registerAppTool(
    server,
    "spreadsheet_createDocument",
    {
      title: "Create Spreadsheet Document",
      description:
        "Creates a new spreadsheet document and opens it in the inline MCP spreadsheet app.",
      inputSchema: {
        sheetTitle: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe("Optional first-sheet title"),
        locale: z
          .string()
          .min(2)
          .optional()
          .describe("Optional locale (e.g. en-US)"),
        currency: z
          .string()
          .min(3)
          .max(3)
          .optional()
          .describe("Optional ISO currency code (e.g. USD)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          resourceUri: SPREADSHEET_APP_RESOURCE_URI,
        },
      },
    },
    async (args: unknown) => {
      const parsed = z
        .object({
          sheetTitle: z.string().min(1).max(80).optional(),
          locale: z.string().min(2).optional(),
          currency: z.string().min(3).max(3).optional(),
        })
        .parse(args ?? {});

      let docId = uuidString();
      let created = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await createSpreadsheetDocument({
          docId,
          sheetTitle: parsed.sheetTitle,
        });
        if (result.created) {
          created = true;
          break;
        }
        docId = uuidString();
      }

      if (!created) {
        return {
          content: [
            {
              type: "text",
              text: "Failed to create a new spreadsheet document. Please try again.",
            },
          ],
          structuredContent: {
            success: false,
          },
        };
      }

      const resolvedLocale = parsed.locale ?? locale;
      const resolvedCurrency = (parsed.currency ?? currency).toUpperCase();
      const url = new URL(
        `${MCP_PUBLIC_DOC_BASE_PATH}/${encodeURIComponent(docId)}`,
        appBaseUrl,
      );
      url.searchParams.set("locale", resolvedLocale);
      url.searchParams.set("currency", resolvedCurrency);

      return {
        content: [
          {
            type: "text",
            text: `Created spreadsheet document ${docId}.`,
          },
        ],
        structuredContent: {
          success: true,
          docId,
          locale: resolvedLocale,
          currency: resolvedCurrency,
          url: url.toString(),
        },
      };
    },
  );

  registerAppTool(
    server,
    "open_spreadsheet",
    {
      title: "Open Spreadsheet",
      description:
        "Opens a spreadsheet document and renders an interactive inline view in MCP-compatible clients.",
      inputSchema: {
        docId: z.string().min(1).describe("Spreadsheet document ID"),
        sheetId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional sheet ID to focus on"),
        locale: z
          .string()
          .min(2)
          .optional()
          .describe("Optional locale (e.g. en-US)"),
        currency: z
          .string()
          .min(3)
          .max(3)
          .optional()
          .describe("Optional ISO currency code (e.g. USD)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          resourceUri: SPREADSHEET_APP_RESOURCE_URI,
        },
      },
    },
    async (args: unknown) => {
      const parsed = z
        .object({
          docId: z.string().min(1),
          sheetId: z.number().int().positive().optional(),
          locale: z.string().min(2).optional(),
          currency: z.string().min(3).max(3).optional(),
        })
        .parse(args);

      const url = new URL(
        `${MCP_PUBLIC_DOC_BASE_PATH}/${encodeURIComponent(parsed.docId)}`,
        appBaseUrl,
      );
      if (parsed.sheetId !== undefined) {
        url.searchParams.set("sheetId", String(parsed.sheetId));
      }
      const resolvedLocale = parsed.locale ?? locale;
      const resolvedCurrency = (parsed.currency ?? currency).toUpperCase();
      url.searchParams.set("locale", resolvedLocale);
      url.searchParams.set("currency", resolvedCurrency);

      return {
        content: [
          { type: "text", text: `Opening spreadsheet: ${url.toString()}` },
        ],
        structuredContent: {
          docId: parsed.docId,
          ...(parsed.sheetId !== undefined ? { sheetId: parsed.sheetId } : {}),
          locale: resolvedLocale,
          currency: resolvedCurrency,
          url: url.toString(),
        },
      };
    },
  );
};
