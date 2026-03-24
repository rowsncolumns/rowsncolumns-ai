export type SpreadsheetAssistantContext = {
  documentId?: string;
  sheets?: Array<{ title: string; sheetId: number }>;
  activeSheetId?: number;
  activeCell?: {
    rowIndex: number;
    columnIndex: number;
    a1Address?: string | null;
  };
  cellXfs?: Record<string, unknown>;
  tables?: unknown[];
  theme?: {
    name?: string;
    primaryFontFamily?: string;
    themeColorKeysByIndex?: Record<string, string>;
    themeColorsByIndex?: Record<string, string | undefined>;
    darkThemeColors?: Record<string, string> | null;
  };
};

const instructionLine = (description: string, value: unknown) =>
  `${description}: ${typeof value === "string" ? value : JSON.stringify(value)}`;

export const buildSpreadsheetContextInstructions = (
  context: SpreadsheetAssistantContext | undefined,
) => {
  if (!context) {
    return undefined;
  }

  const lines: string[] = [];

  if (context.documentId) {
    lines.push(
      instructionLine(
        `You are helping the user edit a spreadsheet. \nDocument ID\n`,
        context.documentId,
      ),
    );
  }

  if (context.sheets) {
    lines.push(
      instructionLine(
        `Available sheets in the current workbook\n`,
        context.sheets,
      ),
    );
  }

  if (typeof context.activeSheetId === "number") {
    lines.push(
      instructionLine(
        "The user is focused on sheetId: ",
        context.activeSheetId,
      ),
    );
  }

  if (context.activeCell) {
    lines.push(
      instructionLine(
        `The user's currently focussed / active cell in the spreadsheet.
IMPORTANT INDEXING RULE:
- rowIndex and columnIndex are 1-based (NOT zero-based)
- A1 is rowIndex=1, columnIndex=1
- Never interpret rowIndex=1,columnIndex=1 as B2
`,
        context.activeCell,
      ),
    );
  }

  if (context.cellXfs) {
    lines.push(
      instructionLine(
        `This object represents the cell formatting applied in the spreadsheet.
Each cell format is identified by a "sid" in the styles.
The formats are stored in a cellXfs registry map, where the key is the format ID and the value describes the formatting details
`,
        context.cellXfs,
      ),
    );
  }

  if (context.tables) {
    lines.push(
      instructionLine(
        `The Spreadsheet has the following tables. Tables have a title and and array of columns. Tables ranges do not overlap. Tables are always referenced using table name and ID. User cannot change the ID, but they can change the columns, table name and range.

List of tables:
`,
        context.tables,
      ),
    );
  }

  if (context.theme) {
    lines.push(
      instructionLine(
        `The current active theme of the spreadsheet has the following colors. Theme colors are mapped by this dictionary.
`,
        context.theme,
      ),
    );
  }

  if (lines.length === 0) {
    return undefined;
  }

  return lines.join("\n\n");
};

const asRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const asStringRecord = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") {
      next[key] = entry;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

export const sanitizeSpreadsheetAssistantContext = (
  value: unknown,
): SpreadsheetAssistantContext | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;

  const sheetsRaw = Array.isArray(record.sheets) ? record.sheets : undefined;
  const sheets =
    sheetsRaw?.flatMap((entry) => {
      const item = asRecord(entry);
      if (!item) return [];
      const title = asString(item.title);
      const sheetId = asNumber(item.sheetId);
      if (!title || sheetId === undefined) return [];
      return [{ title, sheetId }];
    }) ?? undefined;

  const activeCellRaw = asRecord(record.activeCell);
  const activeCell =
    activeCellRaw &&
    asNumber(activeCellRaw.rowIndex) !== undefined &&
    asNumber(activeCellRaw.columnIndex) !== undefined
      ? {
          rowIndex: asNumber(activeCellRaw.rowIndex)!,
          columnIndex: asNumber(activeCellRaw.columnIndex)!,
          a1Address: asString(activeCellRaw.a1Address) ?? null,
        }
      : undefined;

  const cellXfs = asRecord(record.cellXfs) ?? undefined;
  const tables = Array.isArray(record.tables) ? record.tables : undefined;

  const themeRaw = asRecord(record.theme);
  const theme = themeRaw
    ? {
        name: asString(themeRaw.name),
        primaryFontFamily: asString(themeRaw.primaryFontFamily),
        themeColorKeysByIndex: asStringRecord(themeRaw.themeColorKeysByIndex),
        themeColorsByIndex: asStringRecord(themeRaw.themeColorsByIndex),
        darkThemeColors: asStringRecord(themeRaw.darkThemeColors) ?? null,
      }
    : undefined;

  const context: SpreadsheetAssistantContext = {
    documentId: asString(record.documentId),
    sheets: sheets && sheets.length > 0 ? sheets : undefined,
    activeSheetId: asNumber(record.activeSheetId),
    activeCell,
    cellXfs,
    tables,
    theme,
  };

  if (
    !context.documentId &&
    !context.sheets &&
    context.activeSheetId === undefined &&
    !context.activeCell &&
    !context.cellXfs &&
    !context.tables &&
    !context.theme
  ) {
    return undefined;
  }

  return context;
};
