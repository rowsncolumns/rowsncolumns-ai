import { NamedRange, Sheet } from "@rowsncolumns/spreadsheet";
import { selectionToAddress } from "@rowsncolumns/utils";

export type TableSummary = {
  tableId: string | number;
  title: string;
  sheetId: number;
  ref: string;
  columns: string[];
};

export type ChartSummary = {
  chartId: string | number;
  sheetId?: number;
  title?: string | null;
  subtitle?: string | null;
  chartType?: string;
  dataRange?: string | null;
  domains?: string[];
  series?: string[];
};

export type NamedRangeSummary = {
  name: string;
  ref: string;
  sheetId?: number;
};

export type ViewPortProps = {
  rowStartIndex: number;
  rowStopIndex: number;
  columnStartIndex: number;
  columnStopIndex: number;
  visibleRowStartIndex: number;
  visibleRowStopIndex: number;
  visibleColumnStartIndex: number;
  visibleColumnStopIndex: number;
};

export type UserLocationContext = {
  /** ISO 3166-1 alpha-2 country code (e.g., "US", "SG", "IN") */
  countryCode?: string;
  /** IANA timezone identifier (e.g., "America/New_York", "Asia/Singapore") */
  timezone?: string;
  /** BCP 47 locale tag (e.g., "en-US", "en-SG") */
  locale?: string;
  /** ISO 4217 currency code (e.g., "USD", "SGD") */
  currency?: string;
  /** Current date/time in ISO 8601 format */
  currentTime?: string;
};

export type SpreadsheetAssistantContext = {
  documentId?: string;
  sheets?: Array<{
    title: string;
    sheetId: number;
    frozenRowCount?: number | null;
    frozenColumnCount?: number | null;
  }>;
  activeSheetId?: number;
  activeCell?: {
    rowIndex: number;
    columnIndex: number;
    a1Address?: string | null;
  };
  viewport?: ViewPortProps;
  cellXfs?: Record<string, unknown>;
  tables?: TableSummary[];
  charts?: ChartSummary[];
  namedRanges?: NamedRangeSummary[];
  theme?: {
    name?: string;
    primaryFontFamily?: string;
    themeColorKeysByIndex?: Record<string, string>;
    themeColorsByIndex?: Record<string, string | undefined>;
    darkThemeColors?: Record<string, string> | null;
  };
  /** User's location context for regional awareness */
  userLocation?: UserLocationContext;
};

const COMPACT_BORDER_SIDES = ["top", "right", "bottom", "left"] as const;

type SpreadsheetContextPayloadInput = {
  documentId: string;
  sheets?: Array<{ title: string; sheetId: number }>;
  activeSheetId?: number | null;
  activeCell?: {
    rowIndex: number;
    columnIndex: number;
    a1Address?: string | null;
  } | null;
  viewport?: ViewPortProps;
  cellXfs?: Record<string, unknown> | null;
  tables?: TableSummary[];
  charts?: ChartSummary[];
  namedRanges?: NamedRangeSummary[];
  theme?: SpreadsheetAssistantContext["theme"];
};

const instructionLine = (description: string, value: unknown) =>
  `${description}: ${typeof value === "string" ? value : JSON.stringify(value)}`;

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

const toCompactBorderToken = (
  side: string,
  value: unknown,
): string | undefined => {
  const border = asRecord(value);
  if (!border) return undefined;

  const style = asString(border.style);
  const color = asString(border.color);
  const width = asNumber(border.width);
  if (!style && !color && width === undefined) {
    return undefined;
  }

  const bits = [side];
  if (style) bits.push(style);
  if (color) bits.push(color);
  if (width !== undefined && width > 1) bits.push(String(width));
  return bits.join(":");
};

const toCompactTextFormat = (value: unknown): string | undefined => {
  const textFormat = asRecord(value);
  if (!textFormat) return undefined;

  const bits: string[] = [];
  if (textFormat.bold === true) bits.push("b");
  if (textFormat.italic === true) bits.push("i");
  if (textFormat.underline === true) bits.push("u");
  if (textFormat.strikethrough === true) bits.push("s");

  const color = asString(textFormat.color);
  if (color) bits.push(`c:${color}`);

  const fontSize = asNumber(textFormat.fontSize);
  if (fontSize !== undefined) bits.push(`fs:${fontSize}`);

  return bits.length > 0 ? bits.join("|") : undefined;
};

const toCompactBackgroundColor = (value: unknown) => {
  const asFlatColor = asString(value);
  if (asFlatColor) {
    return asFlatColor;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const theme = asNumber(record.theme);
  const tint = asNumber(record.tint);
  if (theme === undefined && tint === undefined) {
    return undefined;
  }

  return {
    ...(theme !== undefined ? { theme } : {}),
    ...(tint !== undefined ? { tint } : {}),
  };
};

const HORIZONTAL_ALIGNMENT_CODES: Record<string, string> = {
  left: "l",
  center: "c",
  right: "r",
  justify: "j",
  fill: "f",
  distributed: "d",
};

const VERTICAL_ALIGNMENT_CODES: Record<string, string> = {
  top: "t",
  middle: "m",
  bottom: "b",
  justify: "j",
  distributed: "d",
};

const WRAP_STRATEGY_CODES: Record<string, string> = {
  overflow: "o",
  wrap: "w",
  clip: "c",
};

const NUMBER_FORMAT_TYPE_CODES: Record<string, string> = {
  number: "N",
  percent: "P",
  currency: "C",
  date: "D",
  time: "T",
  datetime: "DT",
  scientific: "S",
  fraction: "F",
  text: "TXT",
};

const BORDER_SIDE_CODES: Record<string, string> = {
  top: "t",
  right: "r",
  bottom: "b",
  left: "l",
};

const BORDER_STYLE_CODES: Record<string, string> = {
  solid: "s",
  solid_medium: "sm",
  solid_thick: "st",
  double: "d",
  dashed: "ds",
  dotted: "dt",
  none: "n",
  hairline: "h",
  medium: "m",
  thick: "th",
};

const toCompactToken = (
  rawValue: string | undefined,
  map: Record<string, string>,
) => {
  if (!rawValue) return undefined;
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return undefined;
  return map[normalized] ?? normalized;
};

const toCompactNumberFormatType = (rawValue: string | undefined) => {
  if (!rawValue) return undefined;
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return undefined;
  return NUMBER_FORMAT_TYPE_CODES[normalized] ?? normalized.toUpperCase();
};

const toCompactCellXf = (value: unknown): string | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;

  const segments: string[] = [];

  const numberFormat = asRecord(record.numberFormat);
  const rawNumberFormatType =
    asString(record.numberFormatType) ?? asString(numberFormat?.type);
  const numberFormatType = toCompactNumberFormatType(rawNumberFormatType);
  if (numberFormatType) {
    segments.push(`nf:${numberFormatType}`);
  }

  let compactBorders = asString(record.borders);
  if (compactBorders) {
    // Normalize any prior long-form side/style tokens into short codes.
    compactBorders = compactBorders
      .split("|")
      .map((token) => {
        const [rawSide = "", rawStyle = "", ...rest] = token.split(":");
        const side = toCompactToken(rawSide, BORDER_SIDE_CODES) ?? rawSide;
        const style = toCompactToken(rawStyle, BORDER_STYLE_CODES) ?? rawStyle;
        return [side, style, ...rest].filter(Boolean).join(":");
      })
      .join("|");
  }
  if (compactBorders) {
    segments.push(`b:${compactBorders}`);
  } else {
    const borders = asRecord(record.borders);
    if (borders) {
      const compactBorderTokens = COMPACT_BORDER_SIDES.map((side) =>
        toCompactBorderToken(side, borders[side]),
      ).filter((token): token is string => Boolean(token));
      if (compactBorderTokens.length > 0) {
        const encodedBorders = compactBorderTokens
          .map((token) => {
            const [rawSide = "", rawStyle = "", ...rest] = token.split(":");
            const compactSide =
              toCompactToken(rawSide, BORDER_SIDE_CODES) ?? rawSide;
            const compactStyle =
              toCompactToken(rawStyle, BORDER_STYLE_CODES) ?? rawStyle;
            return [compactSide, compactStyle, ...rest]
              .filter(Boolean)
              .join(":");
          })
          .join("|");
        segments.push(`b:${encodedBorders}`);
      }
    }
  }

  const compactTextFormat =
    asString(record.textFormat) ?? toCompactTextFormat(record.textFormat);
  if (compactTextFormat) {
    segments.push(`t:${compactTextFormat}`);
  }

  const backgroundColor = toCompactBackgroundColor(record.backgroundColor);
  if (backgroundColor) {
    if (typeof backgroundColor === "string") {
      segments.push(`bg:${backgroundColor}`);
    } else {
      const theme = asNumber(backgroundColor.theme);
      const tint = asNumber(backgroundColor.tint);
      if (theme !== undefined || tint !== undefined) {
        const themeToken = theme !== undefined ? `th${theme}` : "";
        const tintToken = tint !== undefined ? `ti${tint}` : "";
        segments.push(
          `bg:${[themeToken, tintToken].filter(Boolean).join(",")}`,
        );
      }
    }
  }

  const horizontalAlignment =
    asString(record.horizontalAlignment) ?? asString(record.ha);
  const compactHorizontalAlignment = toCompactToken(
    horizontalAlignment,
    HORIZONTAL_ALIGNMENT_CODES,
  );
  if (compactHorizontalAlignment) {
    segments.push(`h:${compactHorizontalAlignment}`);
  }

  const verticalAlignment =
    asString(record.verticalAlignment) ?? asString(record.va);
  const compactVerticalAlignment = toCompactToken(
    verticalAlignment,
    VERTICAL_ALIGNMENT_CODES,
  );
  if (compactVerticalAlignment) {
    segments.push(`v:${compactVerticalAlignment}`);
  }

  const wrapStrategy = asString(record.wrapStrategy) ?? asString(record.ws);
  const compactWrapStrategy = toCompactToken(wrapStrategy, WRAP_STRATEGY_CODES);
  if (compactWrapStrategy) {
    segments.push(`w:${compactWrapStrategy}`);
  }

  return segments.length > 0 ? segments.join(";") : undefined;
};

export const compactCellXfsForAssistant = (
  value: Record<string, unknown> | null | undefined,
) => {
  if (!value) {
    return undefined;
  }

  const next: Record<string, string> = {};
  for (const [styleId, styleValue] of Object.entries(value)) {
    const compactStyle =
      typeof styleValue === "string" && styleValue.trim().length > 0
        ? styleValue.trim()
        : toCompactCellXf(styleValue);
    if (compactStyle) {
      next[styleId] = compactStyle;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

export const buildSpreadsheetContextInstructions = (
  context: SpreadsheetAssistantContext | undefined,
) => {
  if (!context) {
    return undefined;
  }

  const lines: string[] = [];

  if (context.documentId) {
    lines.push(
      instructionLine(`User is working on \nDocument ID\n`, context.documentId),
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
`,
        context.activeCell,
      ),
    );
  }

  if (context.viewport) {
    // Get frozen row/column counts for active sheet
    const activeSheet = context.sheets?.find(
      (s) => s.sheetId === context.activeSheetId,
    );
    const frozenRowCount = activeSheet?.frozenRowCount ?? 0;
    const frozenColumnCount = activeSheet?.frozenColumnCount ?? 0;

    const viewportA1 = selectionToAddress({
      range: {
        startRowIndex: context.viewport.visibleRowStartIndex,
        endRowIndex: context.viewport.visibleRowStopIndex,
        startColumnIndex: context.viewport.visibleColumnStartIndex,
        endColumnIndex: context.viewport.visibleColumnStopIndex,
      },
    });

    if (viewportA1) {
      // Build viewport description accounting for frozen rows/columns
      const visibleParts: string[] = [`scrolled area: ${viewportA1}`];

      if (frozenRowCount > 0) {
        visibleParts.push(`frozen rows: ${frozenRowCount}`);
      }
      if (frozenColumnCount > 0) {
        visibleParts.push(`frozen columns: ${frozenColumnCount}`);
      }

      const description =
        frozenRowCount > 0 || frozenColumnCount > 0
          ? `The user's current visible viewport includes frozen panes and scrolled area`
          : `The user's current visible viewport (the range of cells currently visible on screen)`;

      lines.push(
        instructionLine(
          `${description}
`,
          visibleParts.join(", "),
        ),
      );
    }
  }

  if (context.cellXfs) {
    lines.push(
      instructionLine(
        `This object is a compacted cell formatting registry for the spreadsheet.
Each cell format is identified by a "sid" in the styles.
The map key is the format ID.
Each value is a compact token string with ";" segments. Always decode these tokens before reasoning about formatting.
- Segment separator: ";"
- Unknown segments may appear; ignore unknown segments.
- Missing segment means "not specified" (do not infer default formatting from absence).

Token schema:
- nf:<type> (N/P/C/D/T/DT/S/F/TXT)
- b:<borders> where each border token is side:style:color[:width], side in t/r/b/l, styles compressed (s, sm, st, d, ds, dt, n, h, m, th), multiple borders joined by "|"
- t:<textFormat> where text tokens are joined by "|" and include b/i/u/s/c:#HEX/fs:<size>
- bg:<color> (or theme/tint encoded form)
- h:<horizontalAlignment> where l/c/r/j/f/d
- v:<verticalAlignment> where t/m/b/j/d
- w:<wrapStrategy> where o/w/c

Examples:
- "nf:P;h:r" => percent format, right-aligned.
- "b:t:s:#000000|b:d:#000000;t:b|c:#111827;bg:#F6EFE6;h:l" => top solid black border + bottom double black border, bold dark text, light background, left-aligned.
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

  if (context.charts && context.charts.length > 0) {
    lines.push(
      instructionLine(
        `The spreadsheet has the following charts. Each chart has a unique chartId that must be used when updating charts.

List of charts:
`,
        context.charts,
      ),
    );
  }

  if (context.namedRanges && context.namedRanges.length > 0) {
    lines.push(
      instructionLine(
        `The spreadsheet has the following named ranges. Named ranges can be used in formulas instead of cell references.

List of named ranges:
`,
        context.namedRanges,
      ),
    );
  }

  if (context.userLocation) {
    const locationParts: string[] = [];
    if (context.userLocation.countryCode) {
      locationParts.push(`Country: ${context.userLocation.countryCode}`);
    }
    if (context.userLocation.timezone) {
      locationParts.push(`Timezone: ${context.userLocation.timezone}`);
    }
    if (context.userLocation.locale) {
      locationParts.push(`Locale: ${context.userLocation.locale}`);
    }
    if (context.userLocation.currency) {
      locationParts.push(`Currency: ${context.userLocation.currency}`);
    }
    if (context.userLocation.currentTime) {
      locationParts.push(`Current time: ${context.userLocation.currentTime}`);
    }
    if (locationParts.length > 0) {
      lines.push(
        `User's location context (use this for regional formatting, date/time awareness, and currency defaults):
${locationParts.join("\n")}`,
      );
    }
  }

  if (lines.length === 0) {
    return undefined;
  }

  return lines.join("\n\n");
};

export const buildSpreadsheetContextPayload = (
  input: SpreadsheetContextPayloadInput,
) => {
  const compactCellXfs = compactCellXfsForAssistant(input.cellXfs);
  const assistantContext: SpreadsheetAssistantContext = {
    documentId: input.documentId,
    ...(input.sheets && input.sheets.length > 0
      ? { sheets: input.sheets }
      : {}),
    ...(typeof input.activeSheetId === "number"
      ? { activeSheetId: input.activeSheetId }
      : {}),
    ...(input.activeCell
      ? {
          activeCell: {
            rowIndex: input.activeCell.rowIndex,
            columnIndex: input.activeCell.columnIndex,
            a1Address: input.activeCell.a1Address ?? null,
          },
        }
      : {}),
    ...(input.viewport ? { viewport: input.viewport } : {}),
    ...(compactCellXfs ? { cellXfs: compactCellXfs } : {}),
    ...(input.tables && input.tables.length > 0
      ? { tables: input.tables }
      : {}),
    ...(input.charts && input.charts.length > 0
      ? { charts: input.charts }
      : {}),
    ...(input.namedRanges && input.namedRanges.length > 0
      ? { namedRanges: input.namedRanges }
      : {}),
    ...(input.theme ? { theme: input.theme } : {}),
  };

  const contextInstructions =
    buildSpreadsheetContextInstructions(assistantContext) ??
    `Context for ${input.documentId}`;

  return {
    assistantContext,
    contextInstructions,
  };
};

export const sanitizeSpreadsheetAssistantContext = (
  value: unknown,
): SpreadsheetAssistantContext | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;

  const sheetsRaw: Sheet[] = Array.isArray(record.sheets) ? record.sheets : [];
  const sheets =
    sheetsRaw?.flatMap((entry) => {
      const item = asRecord(entry) as Sheet;
      if (!item) return [];
      const title = asString(item.title);
      const sheetId = asNumber(item.sheetId);
      if (!title || sheetId === undefined) return [];
      return [{ ...item, title, sheetId }];
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

  const viewport = asRecord(record.viewport) as ViewPortProps | undefined;

  const cellXfs = compactCellXfsForAssistant(asRecord(record.cellXfs));

  const tablesRaw = Array.isArray(record.tables) ? record.tables : undefined;
  const tables =
    tablesRaw?.flatMap((entry) => {
      const item = asRecord(entry);
      if (!item) return [];
      const tableId = item.tableId;
      const title = asString(item.title);
      const sheetId = asNumber(item.sheetId);
      const ref = asString(item.ref);
      if (tableId === undefined || tableId === null) return [];
      if (!title || sheetId === undefined || !ref) return [];
      const columnsRaw = Array.isArray(item.columns) ? item.columns : [];
      const columns = columnsRaw.filter(
        (c): c is string => typeof c === "string",
      );
      return [
        {
          tableId: tableId as string | number,
          title,
          sheetId,
          ref,
          columns,
        },
      ];
    }) ?? undefined;

  const chartsRaw = Array.isArray(record.charts) ? record.charts : undefined;
  const charts =
    chartsRaw?.flatMap((entry) => {
      const item = asRecord(entry);
      if (!item) return [];
      const chartId = item.chartId;
      if (chartId === undefined || chartId === null) return [];
      return [
        {
          chartId: chartId as string | number,
          sheetId: asNumber(item.sheetId),
          title: item.title as string | null | undefined,
          subtitle: item.subtitle as string | null | undefined,
          chartType: asString(item.chartType),
          dataRange: item.dataRange as string | null | undefined,
        },
      ];
    }) ?? undefined;

  const namedRangesRaw: NamedRange[] | undefined = Array.isArray(
    record.namedRanges,
  )
    ? record.namedRanges
    : undefined;
  const namedRanges =
    namedRangesRaw?.flatMap((entry) => {
      const item = asRecord(entry);
      if (!item) return [];
      const name = asString(item.name);
      const ref = asString(item.ref);
      if (!name || !ref) return [];
      return [
        {
          name,
          ref,
          sheetId: asNumber(item.sheetId),
        },
      ];
    }) ?? undefined;

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

  const userLocationRaw = asRecord(record.userLocation);
  const userLocation: UserLocationContext | undefined = userLocationRaw
    ? {
        countryCode: asString(userLocationRaw.countryCode),
        timezone: asString(userLocationRaw.timezone),
        locale: asString(userLocationRaw.locale),
        currency: asString(userLocationRaw.currency),
        currentTime: asString(userLocationRaw.currentTime),
      }
    : undefined;
  // Only include userLocation if it has at least one defined field
  const hasUserLocation =
    userLocation &&
    (userLocation.countryCode ||
      userLocation.timezone ||
      userLocation.locale ||
      userLocation.currency ||
      userLocation.currentTime);

  const context: SpreadsheetAssistantContext = {
    documentId: asString(record.documentId),
    sheets: sheets && sheets.length > 0 ? sheets : undefined,
    activeSheetId: asNumber(record.activeSheetId),
    activeCell,
    viewport,
    cellXfs,
    tables,
    charts: charts && charts.length > 0 ? charts : undefined,
    namedRanges:
      namedRanges && namedRanges.length > 0 ? namedRanges : undefined,
    theme,
    userLocation: hasUserLocation ? userLocation : undefined,
  };

  if (
    !context.documentId &&
    !context.sheets &&
    context.activeSheetId === undefined &&
    !context.activeCell &&
    !context.viewport &&
    !context.cellXfs &&
    !context.tables &&
    !context.charts &&
    !context.namedRanges &&
    !context.theme &&
    !context.userLocation
  ) {
    return undefined;
  }

  return context;
};
