import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSpreadsheetResources } from "./register-resources";
import {
  registerSpreadsheetTools,
  type RegisterSpreadsheetToolsOptions,
} from "./register-tools";

const defaultServerName = "rowsncolumns-spreadsheet";
const defaultServerVersion = "1.0.0";

const getServerName = () =>
  process.env.MCP_SERVER_NAME?.trim() || defaultServerName;

const getServerVersion = () =>
  process.env.MCP_SERVER_VERSION?.trim() || defaultServerVersion;

export const createSpreadsheetMcpServer = (
  options: RegisterSpreadsheetToolsOptions = {},
) => {
  const server = new McpServer(
    {
      name: getServerName(),
      version: getServerVersion(),
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerSpreadsheetTools(server, options);
  registerSpreadsheetResources(server);

  return server;
};
