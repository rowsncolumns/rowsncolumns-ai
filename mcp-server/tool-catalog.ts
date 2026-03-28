import { spreadsheetTools } from "../lib/chat/tools";

export type LangChainLikeTool = {
  name: string;
  description: string;
  schema?: unknown;
  invoke: (input: unknown) => Promise<unknown>;
};

export const spreadsheetMcpTools = spreadsheetTools as LangChainLikeTool[];

const READ_ONLY_TOOL_NAMES = new Set([
  "spreadsheet_queryRange",
  "spreadsheet_readDocument",
  "spreadsheet_getRowColMetadata",
  "spreadsheet_getAuditSnapshot",
]);

export const isReadOnlyTool = (toolName: string) =>
  READ_ONLY_TOOL_NAMES.has(toolName);

const toTitleCase = (value: string) =>
  value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;

export const toolNameToTitle = (toolName: string) =>
  toolName
    .split("_")
    .filter((part) => part.length > 0)
    .map(toTitleCase)
    .join(" ");
