#!/usr/bin/env node

import {
  createMcpExpressApp,
  type CreateMcpExpressAppOptions,
} from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSpreadsheetMcpServer } from "./create-server";
import { loadEnvironment } from "./env";

loadEnvironment();

const DEFAULT_MCP_PORT = 8787;
const DEFAULT_MCP_PATH = "/mcp";
const DEFAULT_MCP_HOST = "127.0.0.1";

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const splitCsv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const MCP_PORT = parsePositiveInt(process.env.MCP_PORT, DEFAULT_MCP_PORT);
const MCP_PATH = process.env.MCP_PATH?.trim() || DEFAULT_MCP_PATH;
const MCP_HOST = process.env.MCP_HOST?.trim() || DEFAULT_MCP_HOST;
const MCP_ALLOWED_HOSTS = splitCsv(process.env.MCP_ALLOWED_HOSTS);

const mcpAppOptions: CreateMcpExpressAppOptions = {
  host: MCP_HOST,
  ...(MCP_ALLOWED_HOSTS.length > 0 ? { allowedHosts: MCP_ALLOWED_HOSTS } : {}),
};

const app = createMcpExpressApp(mcpAppOptions);

app.get("/health", (_req: any, res: any) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    transport: "streamable-http",
    mcpPath: MCP_PATH,
  });
});

app.post(MCP_PATH, async (req: any, res: any) => {
  const server = createSpreadsheetMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[mcp] request handling error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});

const methodNotAllowed = (_req: any, res: any) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
};

app.get(MCP_PATH, methodNotAllowed);
app.delete(MCP_PATH, methodNotAllowed);

app.listen(MCP_PORT, MCP_HOST, () => {
  console.error(
    `[mcp] rowsncolumns spreadsheet server listening on http://${MCP_HOST}:${MCP_PORT}${MCP_PATH}`,
  );
});
