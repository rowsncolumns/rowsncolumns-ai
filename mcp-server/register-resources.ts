import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getShareDBDocument,
  type ShareDBSpreadsheetDoc,
} from "../lib/chat/utils";

const DEFAULT_RESOURCE_MAX_BYTES = 1024 * 1024;

const getResourceMaxBytes = () => {
  const value = Number.parseInt(process.env.MCP_RESOURCE_MAX_BYTES ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RESOURCE_MAX_BYTES;
};

const RESOURCE_MAX_BYTES = getResourceMaxBytes();

const stringifyResourcePayload = (payload: unknown) => {
  const raw = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(raw, "utf8") <= RESOURCE_MAX_BYTES) {
    return raw;
  }

  return JSON.stringify(
    {
      truncated: true,
      maxBytes: RESOURCE_MAX_BYTES,
      message:
        "Resource payload exceeded MCP_RESOURCE_MAX_BYTES. Increase the limit or query a smaller resource.",
      preview: raw.slice(0, RESOURCE_MAX_BYTES),
    },
    null,
    2,
  );
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

const toSheetId = (rawSheetId: string) => {
  const parsed = Number.parseInt(rawSheetId, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const readTemplateVariable = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
};

export const registerSpreadsheetResources = (server: McpServer) => {
  server.registerResource(
    "spreadsheet_document",
    new ResourceTemplate("spreadsheet://{docId}", {
      list: undefined,
    }),
    {
      title: "Spreadsheet Document",
      description:
        "Full ShareDB spreadsheet document snapshot for a given document ID.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const docId = readTemplateVariable(variables.docId);
      const data = await readSpreadsheetDocument(docId);
      const payload = data
        ? {
            docId,
            exists: true,
            sheets: data.sheets ?? [],
            data,
          }
        : {
            docId,
            exists: false,
            error: `Document ${docId} was not found.`,
          };

      return {
        contents: [
          {
            uri: `spreadsheet://${docId}`,
            mimeType: "application/json",
            text: stringifyResourcePayload(payload),
          },
        ],
      };
    },
  );

  server.registerResource(
    "spreadsheet_sheet",
    new ResourceTemplate("spreadsheet://{docId}/sheet/{sheetId}", {
      list: undefined,
    }),
    {
      title: "Spreadsheet Sheet",
      description: "Single sheet snapshot from a ShareDB spreadsheet document.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const docId = readTemplateVariable(variables.docId);
      const rawSheetId = readTemplateVariable(variables.sheetId);
      const parsedSheetId = toSheetId(rawSheetId);
      const data = await readSpreadsheetDocument(docId);

      const payload =
        parsedSheetId === null
          ? {
              docId,
              exists: false,
              error: `Invalid sheetId: ${rawSheetId}`,
            }
          : data
            ? {
                docId,
                sheetId: parsedSheetId,
                exists: true,
                sheet:
                  data.sheets?.find((sheet) => sheet.sheetId === parsedSheetId) ??
                  null,
                sheetData: data.sheetData?.[String(parsedSheetId)] ?? null,
              }
            : {
                docId,
                sheetId: parsedSheetId,
                exists: false,
                error: `Document ${docId} was not found.`,
              };

      return {
        contents: [
          {
            uri: `spreadsheet://${docId}/sheet/${rawSheetId}`,
            mimeType: "application/json",
            text: stringifyResourcePayload(payload),
          },
        ],
      };
    },
  );
};
