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
import { uuidString } from "@rowsncolumns/utils";
import {
  isReadOnlyTool,
  spreadsheetMcpTools,
  toolNameToTitle,
} from "./tool-catalog";
import { getShareDBDocument } from "../lib/chat/utils";
import { resolveAppBaseUrl, resolveAppOrigin } from "./app-url";

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

const resolveUiDomain = () => {
  const value = process.env.MCP_UI_DOMAIN?.trim();
  if (!value) {
    return null;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `https://${value}`;
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

const createShareDBDocument = async (docId: string) => {
  const { doc, close } = await getShareDBDocument(docId);

  try {
    if (doc.type !== null && doc.data) {
      return { created: false, reason: "already_exists" as const };
    }

    const initialDoc = {
      sheetData: {},
      sheets: [
        { sheetId: 1, title: "Sheet1" },
        { sheetId: 2, title: "Sheet2" },
      ],
      tables: [],
      charts: [],
      embeds: [],
      namedRanges: [],
      protectedRanges: [],
      conditionalFormats: [],
      dataValidations: [],
      pivotTables: [],
      cellXfs: {},
      sharedStrings: {},
      iterativeCalculation: { enabled: false },
      recalcCells: [],
    };

    await new Promise<void>((resolve, reject) => {
      doc.create(initialDoc, (error?: { message?: string } | null) => {
        if (!error) {
          resolve();
          return;
        }

        if (error.message?.includes("already created")) {
          resolve();
          return;
        }

        reject(error);
      });
    });

    return { created: true, reason: "created" as const };
  } finally {
    close();
  }
};

const createSpreadsheetDocumentInputSchema = {
  docId: z
    .string()
    .min(1)
    .optional()
    .describe("Optional document ID. If omitted, a UUID is generated."),
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

const createSpreadsheetDocumentHandler = async (args: unknown) => {
  const parsed = z.object(createSpreadsheetDocumentInputSchema).parse(args);

  const docId = parsed.docId ?? uuidString();
  const result = await createShareDBDocument(docId);
  const url = new URL(
    `${MCP_PUBLIC_DOC_BASE_PATH}/${encodeURIComponent(docId)}`,
    resolveAppBaseUrl(),
  );

  return {
    content: [
      {
        type: "text" as const,
        text:
          result.reason === "created"
            ? `Created spreadsheet document ${docId}. Open: ${url.toString()}`
            : `Document ${docId} already exists. Open: ${url.toString()}`,
      },
    ],
    structuredContent: {
      docId,
      url: url.toString(),
      created: result.created,
    },
  };
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

  const createDocumentConfig = {
    title: "Create Spreadsheet Document",
    description:
      "Creates a new spreadsheet document in ShareDB and returns its document ID and URL.",
    inputSchema: createSpreadsheetDocumentInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
  };

  registerTool(
    "spreadsheet_createDocument",
    createDocumentConfig,
    createSpreadsheetDocumentHandler,
  );
};
