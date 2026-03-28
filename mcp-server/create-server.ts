import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSpreadsheetResources } from "./register-resources";
import {
  registerSpreadsheetTools,
  type RegisterSpreadsheetToolsOptions,
} from "./register-tools";
import { resolveAppBaseUrl } from "./app-url";

const defaultServerName = "rowsncolumns-spreadsheet";
const defaultServerVersion = "1.0.0";

const getServerName = () =>
  process.env.MCP_SERVER_NAME?.trim() || defaultServerName;

const getServerVersion = () =>
  process.env.MCP_SERVER_VERSION?.trim() || defaultServerVersion;

const getServerIcons = () => {
  const baseUrl = resolveAppBaseUrl();
  const iconPath = process.env.MCP_SERVER_ICON_PATH?.trim() || "/android-chrome-512x512.png";
  try {
    const iconUrl = new URL(iconPath, baseUrl).toString();
    return [
      {
        src: iconUrl,
        mimeType: "image/png",
        sizes: ["512x512"],
      },
    ];
  } catch {
    return undefined;
  }
};

export const createSpreadsheetMcpServer = (
  options: RegisterSpreadsheetToolsOptions = {},
) => {
  const icons = getServerIcons();
  const server = new McpServer(
    {
      name: getServerName(),
      version: getServerVersion(),
      ...(icons ? { icons } : {}),
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
