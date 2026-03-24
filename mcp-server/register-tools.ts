import { inspect } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  isReadOnlyTool,
  spreadsheetMcpTools,
  toolNameToTitle,
} from "./tool-catalog";

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

const resolveAppBaseUrl = () =>
  process.env.MCP_APP_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "http://localhost:3000";

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
    "open_spreadsheet",
    {
      title: "Open Spreadsheet",
      description:
        "Returns a direct URL to open a spreadsheet document in the rowsncolumns web app.",
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
    },
    async (args: unknown) => {
      const parsed = z
        .object({
          docId: z.string().min(1),
          sheetId: z.number().int().positive().optional(),
        })
        .parse(args);

      const url = new URL(
        `/doc/${encodeURIComponent(parsed.docId)}`,
        resolveAppBaseUrl(),
      );
      if (parsed.sheetId !== undefined) {
        url.searchParams.set("sheetId", String(parsed.sheetId));
      }

      return {
        content: [{ type: "text", text: `Open spreadsheet: ${url.toString()}` }],
        structuredContent: {
          docId: parsed.docId,
          ...(parsed.sheetId !== undefined ? { sheetId: parsed.sheetId } : {}),
          url: url.toString(),
        },
      };
    },
  );
};
