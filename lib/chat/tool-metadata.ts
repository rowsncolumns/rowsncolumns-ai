export const CHAT_TOOL_DISPLAY_NAMES: Record<string, string> = {
  spreadsheet_changeBatch: "Edit Cells",
  spreadsheet_sheet: "Manage Sheets",
  spreadsheet_getSheetMetadata: "Get Sheet Metadata",
  spreadsheet_formatRange: "Format Range",
  spreadsheet_modifyRowsCols: "Modify Rows/Columns",
  spreadsheet_queryRange: "Query Range",
  spreadsheet_setIterativeMode: "Set Iterative Mode",
  spreadsheet_readDocument: "Read Workbook",
  spreadsheet_getRowColMetadata: "Get Row/Column Metadata",
  spreadsheet_setRowColMetadata: "Set Row/Column Size",
  spreadsheet_applyFill: "Fill Series",
  spreadsheet_note: "Cell Notes",
  spreadsheet_clearCells: "Clear Cells",
  spreadsheet_table: "Manage Tables",
  spreadsheet_chart: "Manage Charts",
  spreadsheet_dataValidation: "Data Validation",
  spreadsheet_conditionalFormat: "Conditional Formatting",
  spreadsheet_getAuditSnapshot: "Audit Spreadsheet",
  assistant_requestModeSwitch: "Request Mode Switch",
  assistant_askUserQuestion: "Ask User Question",
  assistant_confirmPlanExecution: "Confirm Plan Execution",
  web_search: "Web Search",
};

export const CHAT_TOOL_MENTION_EXCLUDED = new Set<string>([
  "assistant_confirmPlanExecution",
  "assistant_askUserQuestion",
  "assistant_requestModeSwitch",
]);

const formatToolDisplayNameFallback = (toolName: string): string =>
  toolName
    .replace(/^spreadsheet_/i, "")
    .replace(/^assistant_/i, "")
    .replace(/^web_/i, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const getChatToolDisplayName = (toolName: string): string =>
  CHAT_TOOL_DISPLAY_NAMES[toolName] ?? formatToolDisplayNameFallback(toolName);

