export const CHAT_TOOL_DISPLAY_NAMES: Record<string, string> = {
  spreadsheet_createDocument: "Create Workbook",
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
  assistant_getSkill: "Get Skill",
  web_search: "Web Search",
};

export const CHAT_TOOL_DESCRIPTIONS: Record<string, string> = {
  spreadsheet_createDocument:
    "Create a new spreadsheet workbook and return its document ID.",
  spreadsheet_changeBatch: "Write values or formulas to selected cells.",
  spreadsheet_sheet: "Create, update, delete, or duplicate sheet tabs.",
  spreadsheet_getSheetMetadata:
    "Read structural sheet metadata and properties.",
  spreadsheet_formatRange: "Apply visual formatting to a range.",
  spreadsheet_modifyRowsCols: "Insert or delete rows and columns.",
  spreadsheet_queryRange: "Read targeted values or formatting from ranges.",
  spreadsheet_setIterativeMode:
    "Enable or disable iterative calculation behavior.",
  spreadsheet_readDocument: "Read workbook values or metadata.",
  spreadsheet_getRowColMetadata: "Inspect row heights and column widths.",
  spreadsheet_setRowColMetadata: "Set row heights or column widths.",
  spreadsheet_applyFill: "Extend patterns, values, or formulas across ranges.",
  spreadsheet_note: "Add or remove notes on cells.",
  spreadsheet_clearCells: "Clear values, formatting, or both in ranges.",
  spreadsheet_table: "Create, update, or remove structured tables.",
  spreadsheet_chart: "Create, update, or remove charts.",
  spreadsheet_dataValidation: "Manage input validation rules.",
  spreadsheet_conditionalFormat: "Manage conditional formatting rules.",
  spreadsheet_getAuditSnapshot: "Collect workbook audit details.",
  assistant_requestModeSwitch: "Request a mode change from the user.",
  assistant_askUserQuestion:
    "Ask the user structured multiple-choice questions.",
  assistant_confirmPlanExecution:
    "Show a plan and request user approval before execution.",
  assistant_getSkill: "Retrieve a skill's details by its ID.",
  web_search: "Search the web and return sourced results.",
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

export const getChatToolDescription = (toolName: string): string =>
  CHAT_TOOL_DESCRIPTIONS[toolName] ??
  `${getChatToolDisplayName(toolName)} tool.`;
