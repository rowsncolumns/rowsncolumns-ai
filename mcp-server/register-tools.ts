import { inspect } from "node:util";
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

const SPREADSHEET_APP_RESOURCE_URI = "ui://rowsncolumns/spreadsheet-view.html";
const MCP_PUBLIC_DOC_BASE_PATH = "/mcp/doc";

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

const buildSpreadsheetAppHtml = (appBaseUrl: string) =>
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RowsnColumns Spreadsheet</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0f1115;
      --panel: #171a21;
      --text: #f3f6fb;
      --muted: #a9b1c3;
      --accent: #0ea5e9;
    }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 120px;
    }
    .shell {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      background: var(--panel);
      margin: 8px;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      flex: 1;
    }
    a {
      color: white;
      background: var(--accent);
      text-decoration: none;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div id="meta" class="meta">Run <b>open_spreadsheet</b> to open a document.</div>
    <a id="openLink" href="${appBaseUrl}" target="_blank" rel="noopener noreferrer">Open In New Tab</a>
  </div>
  <script>
    (() => {
      const appBaseUrl = ${JSON.stringify(appBaseUrl)};
      const publicDocBasePath = ${JSON.stringify(MCP_PUBLIC_DOC_BASE_PATH)};
      const state = { docId: null, sheetId: null, url: null };
      const protocolVersion = "2026-01-26";
      const appInfo = { name: "rowsncolumns-spreadsheet-app", version: "1.0.0" };
      const appCapabilities = { tools: {}, availableDisplayModes: ["inline", "fullscreen"] };
      const meta = document.getElementById("meta");
      const openLink = document.getElementById("openLink");
      const pendingRequests = new Map();
      let requestId = 0;
      let hostInitialized = false;

      const readString = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
      const readInt = (value) => Number.isFinite(value) ? Math.trunc(value) : null;

      const sendNotification = (method, params = {}) => {
        window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
      };

      const sendRequest = (method, params = {}) => {
        const id = ++requestId;
        return new Promise((resolve, reject) => {
          pendingRequests.set(id, { resolve, reject });
          window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
          window.setTimeout(() => {
            if (!pendingRequests.has(id)) return;
            pendingRequests.delete(id);
            reject(new Error(method + " timed out"));
          }, 4000);
        });
      };

      const notifySize = () => {
        const root = document.documentElement;
        const body = document.body;
        const width = Math.ceil(Math.max(root.scrollWidth, body.scrollWidth, root.clientWidth, 320));
        const height = Math.ceil(Math.max(root.scrollHeight, body.scrollHeight, 120));
        sendNotification("ui/notifications/size-changed", { width, height });
      };

      const parseToolPayload = (value) => {
        if (!value || typeof value !== "object") return null;
        const docId = readString(value.docId);
        const sheetId = value.sheetId === undefined ? null : readInt(value.sheetId);
        const url = readString(value.url);
        return { docId, sheetId, url };
      };

      const buildUrl = (docId, sheetId, url) => {
        if (url) return url;
        if (!docId) return null;
        const next = new URL(publicDocBasePath + "/" + encodeURIComponent(docId), appBaseUrl);
        if (sheetId !== null && sheetId !== undefined) {
          next.searchParams.set("sheetId", String(sheetId));
        }
        return next.toString();
      };

      const navigateToSpreadsheet = (url) => {
        if (!url) return;
        openLink.href = url;
        meta.textContent = "Opening spreadsheet…";
        notifySize();
        window.location.assign(url);
      };

      const applyPayload = (payload) => {
        if (!payload) return;
        if (payload.docId) state.docId = payload.docId;
        if (payload.sheetId !== null && payload.sheetId !== undefined) state.sheetId = payload.sheetId;
        if (payload.url) state.url = payload.url;
        const finalUrl = buildUrl(state.docId, state.sheetId, state.url);
        if (finalUrl) {
          navigateToSpreadsheet(finalUrl);
          return;
        }
        meta.textContent = "Run open_spreadsheet to open a document.";
        notifySize();
      };

      const initializeHost = async () => {
        if (hostInitialized) return;
        try {
          await sendRequest("ui/initialize", {
            appInfo,
            appCapabilities,
            protocolVersion,
          });
          hostInitialized = true;
          sendNotification("ui/notifications/initialized", {});
        } catch (_error) {
          // keep going; non-MCP hosts still can use the fallback link
        } finally {
          notifySize();
        }
      };

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;

        if (message.id !== undefined && pendingRequests.has(message.id)) {
          const pending = pendingRequests.get(message.id);
          pendingRequests.delete(message.id);
          if (!pending) return;
          if (Object.prototype.hasOwnProperty.call(message, "error")) {
            pending.reject(message.error);
          } else {
            pending.resolve(message.result);
          }
          return;
        }

        if (typeof message.method !== "string") return;

        if (
          message.method === "ui/notifications/tool-input" ||
          message.method === "ui/notifications/tool-input-partial"
        ) {
          applyPayload(parseToolPayload(message.params && message.params.arguments));
          return;
        }

        if (message.method === "ui/notifications/tool-result") {
          applyPayload(
            parseToolPayload(message.params && message.params.structuredContent),
          );
        }
      });

      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => notifySize());
        ro.observe(document.documentElement);
        ro.observe(document.body);
      } else {
        window.addEventListener("resize", () => notifySize());
      }

      initializeHost();
    })();
  </script>
</body>
</html>`;

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
          ...(appOrigin
            ? {
                csp: {
                  frameDomains: [appOrigin],
                  connectDomains: [appOrigin],
                  resourceDomains: [appOrigin],
                },
              }
            : {}),
          ...(uiDomain ? { domain: uiDomain } : {}),
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: SPREADSHEET_APP_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildSpreadsheetAppHtml(appBaseUrl),
          _meta: {
            ui: {
              prefersBorder: false,
              ...(appOrigin
                ? {
                    csp: {
                      frameDomains: [appOrigin],
                      connectDomains: [appOrigin],
                      resourceDomains: [appOrigin],
                    },
                  }
                : {}),
              ...(uiDomain ? { domain: uiDomain } : {}),
            },
          },
        },
      ],
    }),
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
        })
        .parse(args);

      const url = new URL(
        `${MCP_PUBLIC_DOC_BASE_PATH}/${encodeURIComponent(parsed.docId)}`,
        appBaseUrl,
      );
      if (parsed.sheetId !== undefined) {
        url.searchParams.set("sheetId", String(parsed.sheetId));
      }

      return {
        content: [{ type: "text", text: `Opening spreadsheet: ${url.toString()}` }],
        structuredContent: {
          docId: parsed.docId,
          ...(parsed.sheetId !== undefined ? { sheetId: parsed.sheetId } : {}),
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
