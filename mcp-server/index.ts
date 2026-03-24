#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSpreadsheetMcpServer } from "./create-server";
import { loadEnvironment } from "./env";

loadEnvironment();

const main = async () => {
  const server = createSpreadsheetMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] rowsncolumns spreadsheet server is running on stdio");
};

main().catch((error) => {
  console.error("[mcp] failed to start stdio server:", error);
  process.exit(1);
});
