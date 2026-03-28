import { z } from "zod";

export type CellFormatType = Record<string, unknown>;

export interface CellStyleData {
  cellStyles?: CellFormatType;
}

const ToolExplanationSchemaShape = {
  explanation: z
    .string()
    .optional()
    .describe(
      "Optional explanation of what this update does (for documentation/logging purposes)",
    ),
} as const;

// CellData schema for changeBatch
const CellDataSchema = z
  .object({
    value: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .optional()
      .describe(
        "The cell's value (string, number, or boolean). Use this for static values.",
      ),
    formula: z
      .string()
      .optional()
      .describe(
        "The cell's formula (e.g., '=SUM(A1:A5)'). Use this for computed values.",
      ),
    citation: z
      .string()
      .optional()
      .describe(
        "Optional citation URL for this cell's data. Use this to track the source of the value.\n" +
          "IMPORTANT: A citation MUST be accompanied by a 'value' or 'formula' - citations alone will result in empty cells.\n\n" +
          "Citation URL format:\n" +
          "- Internal assets: NONE Exists for now" +
          "- External URLs: https://example.com/source?excerpt=[EXCERPT]\n\n" +
          "The 'excerpt' parameter enables scroll-to-text: clicking the citation scrolls to and highlights that text.",
      ),
  })
  .strict()
  .describe("A single cell's data with optional value, formula, and citation");

export type CellData = z.infer<typeof CellDataSchema>;

// Spreadsheet ChangeBatch
export const SpreadsheetChangeBatchSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  range: z.string().describe("The A1 notation range (e.g., 'A1:C3')"),
  cells: z
    .union([
      z.array(z.array(CellDataSchema)),
      z.string().describe("JSON string representation of 2D cell array"),
    ])
    .describe(
      "2D array of CellData objects. Each cell can have 'value' (string/number/boolean) and/or 'formula' (string starting with =)",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetChangeBatchInput = z.infer<
  typeof SpreadsheetChangeBatchSchema
>;

// GridRange schema for merges and other range references
const GridRangeSchema = z.object({
  startRowIndex: z
    .number()
    .int()
    .describe(
      "Start row index (1-based, INCLUSIVE). First row of the range. For A1 this would be 1, for A5 this would be 5.",
    ),
  endRowIndex: z
    .number()
    .int()
    .describe(
      "End row index (1-based, INCLUSIVE). Last row of the range. For range A1:A5, this would be 5. For single cells, equals startRowIndex.",
    ),
  startColumnIndex: z
    .number()
    .int()
    .describe(
      "Start column index (1-based, INCLUSIVE). First column of the range. A=1, B=2, C=3, etc. For range A1:C5, this would be 1.",
    ),
  endColumnIndex: z
    .number()
    .int()
    .describe(
      "End column index (1-based, INCLUSIVE). Last column of the range. For range A1:C5, this would be 3. For single columns, equals startColumnIndex.",
    ),
});

// DimensionProperties schema for row/column metadata
const DimensionPropertiesSchema = z
  .object({
    size: z
      .number()
      .int()
      .optional()
      .describe(
        "Size in pixels. For columns, this is the width. For rows, this is the height. Default: 100px for columns, 21px for rows.",
      ),
    resizedByUser: z
      .boolean()
      .optional()
      .describe(
        "True if the user manually resized this dimension. Must be set to True whenever you set the 'size' field.",
      ),
    hiddenByUser: z
      .boolean()
      .optional()
      .describe(
        "True if the user explicitly hid this row/column. Set to False to unhide.",
      ),
    hiddenByFilter: z
      .boolean()
      .optional()
      .describe(
        "True if this row/column is hidden due to a filter. Do not modify directly - managed by filter operations.",
      ),
  })
  .nullable();

// ThemeColor schema
const ThemeColorSchema = z.object({
  theme: z.number().int().min(0).max(10).describe("Theme color index (0-10)"),
  tint: z.number().nullable().optional().describe("Tint adjustment"),
});

// Color schema - hex string or theme reference
const ColorSchema = z.union([
  z.string().describe("Hex color string (e.g., '#FF0000')"),
  ThemeColorSchema,
]);

// Spreadsheet CreateSheet
const SheetSpecSchema = z
  .object({
    title: z.string().optional().describe("Name of the sheet"),
    sheetId: z
      .number()
      .int()
      .optional()
      .describe("Sheet ID. If not provided, one will be auto-generated."),
    index: z.number().int().optional().describe("The order of the sheet"),
    frozenRowCount: z
      .number()
      .int()
      .optional()
      .describe("Number of frozen rows"),
    frozenColumnCount: z
      .number()
      .int()
      .optional()
      .describe("Number of frozen columns"),
    tabColor: ColorSchema.nullable()
      .optional()
      .describe(
        "Tab color as hex string (e.g., '#FF0000'), theme reference ({theme: 0-10, tint?: number}), or null to remove the color.",
      ),
    showGridLines: z
      .boolean()
      .optional()
      .describe("Whether to show grid lines"),
    hidden: z.boolean().optional().describe("Whether the sheet is hidden"),
    merges: z
      .array(z.string())
      .optional()
      .describe(
        "List of A1 notation ranges to merge (e.g., ['A1:B2', 'D1:D3']). Each range will be merged into a single cell.",
      ),
    removeMerges: z
      .array(z.string())
      .optional()
      .describe(
        "List of A1 notation ranges to unmerge (e.g., ['A1:B2']). Removes existing merges that match these ranges.",
      ),
    hideRows: z
      .array(z.number().int())
      .optional()
      .describe(
        "List of row numbers to hide (1-indexed). Example: [1, 2, 5] hides rows 1, 2, and 5.",
      ),
    showRows: z
      .array(z.number().int())
      .optional()
      .describe(
        "List of row numbers to unhide/show (1-indexed). Example: [1, 2] shows previously hidden rows 1 and 2.",
      ),
    hideCols: z
      .array(z.string())
      .optional()
      .describe(
        "List of column letters to hide (e.g., ['A', 'B', 'C'] or ['AA', 'AB']).",
      ),
    showCols: z
      .array(z.string())
      .optional()
      .describe(
        "List of column letters to unhide/show (e.g., ['A', 'B'] shows previously hidden columns A and B).",
      ),
  })
  .loose();

export const SpreadsheetCreateSheetSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  activeSheetId: z
    .number()
    .int()
    .optional()
    .describe("The active sheet ID to use as context"),
  ...SheetSpecSchema.shape,
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetCreateSheetInput = z.infer<
  typeof SpreadsheetCreateSheetSchema
>;

// Spreadsheet UpdateSheet
export const SpreadsheetUpdateSheetSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  ...SheetSpecSchema.omit({ sheetId: true }).partial().shape,
  sheetId: z.number().int().describe("The sheet ID to update"),
  unsetFields: z
    .array(z.string())
    .optional()
    .describe("Fields to unset/remove"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetUpdateSheetInput = z.infer<
  typeof SpreadsheetUpdateSheetSchema
>;

// Spreadsheet GetSheetMetadata
export const SpreadsheetGetSheetMetadataSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().optional().describe("The sheet ID (default: 1)"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetGetSheetMetadataInput = z.infer<
  typeof SpreadsheetGetSheetMetadataSchema
>;

// Border style enum
const BorderStyleSchema = z.enum([
  "dotted",
  "dashed",
  "solid",
  "solid_medium",
  "solid_thick",
  "double",
]);

// Single border schema
const BorderSchema = z
  .object({
    style: BorderStyleSchema.describe("Border style"),
    width: z.number().int().describe("Border width in pixels"),
    color: ColorSchema.optional().describe(
      "Border color as hex string (e.g., '#FF0000') or theme reference",
    ),
  })
  .optional();

// Borders schema with detailed description
const BordersSchema = z
  .object({
    top: BorderSchema.describe("Top border of the cell"),
    right: BorderSchema.describe("Right border of the cell"),
    bottom: BorderSchema.describe("Bottom border of the cell"),
    left: BorderSchema.describe("Left border of the cell"),
  })
  .optional()
  .describe(
    "Border configuration for cells. Common patterns: All borders (grid), outer only (box), inner only, horizontal/vertical lines, single side (underline effect).",
  );

// Text format schema
const TextFormatSchema = z
  .object({
    color: ColorSchema.optional().describe(
      "Text color as hex string (e.g., '#FF0000') or theme reference",
    ),
    fontFamily: z.string().optional().describe("Font family name"),
    fontSize: z.number().int().optional().describe("Font size in points"),
    bold: z.boolean().optional().describe("Bold text"),
    italic: z.boolean().optional().describe("Italic text"),
    strikethrough: z.boolean().optional().describe("Strikethrough text"),
    underline: z.boolean().optional().describe("Underlined text"),
  })
  .optional();

// Number format type enum
const NumberFormatTypeSchema = z.enum([
  "GENERAL",
  "NUMBER",
  "CURRENCY",
  "ACCOUNTING",
  "DATE",
  "TIME",
  "DATE_TIME",
  "PERCENT",
  "FRACTION",
  "SCIENTIFIC",
  "TEXT",
  "SPECIAL",
]);

// Number format schema
const NumberFormatSchema = z
  .object({
    type: NumberFormatTypeSchema.describe(
      "Target number format category (NUMBER, CURRENCY, DATE, etc.)",
    ),
    pattern: z
      .string()
      .describe(
        "Excel-compatible format string. If omitted, server picks a default based on type (e.g., NUMBER → '#,##0', CURRENCY → '$#,##0.00').",
      ),
  })
  .optional();

// CellFormat schema
const CellFormatSchema = z
  .object({
    backgroundColor: ColorSchema.optional().describe(
      "Background color as hex string (e.g., '#FF0000') or theme reference",
    ),
    borders: BordersSchema.describe("Cell borders"),
    textFormat: TextFormatSchema.describe("Text formatting"),
    numberFormat: NumberFormatSchema.describe("Number format"),
    horizontalAlignment: z
      .enum(["left", "center", "right"])
      .optional()
      .describe("Horizontal alignment"),
    verticalAlignment: z
      .enum(["top", "middle", "bottom"])
      .optional()
      .describe("Vertical alignment"),
    wrapStrategy: z
      .enum(["overflow", "wrap", "clip"])
      .optional()
      .describe("Text wrap strategy"),
    indent: z.number().int().optional().describe("Text indent level"),
    textRotation: z
      .union([z.number().int(), z.literal("vertical")])
      .optional()
      .describe("Text rotation in degrees or 'vertical'"),
    // Shorthand properties (converted to textFormat)
    fontWeight: z
      .string()
      .optional()
      .describe("Shorthand: 'bold' -> textFormat.bold"),
    fontStyle: z
      .string()
      .optional()
      .describe("Shorthand: 'italic' -> textFormat.italic"),
    textDecoration: z
      .string()
      .optional()
      .describe("Shorthand: 'underline'/'line-through' -> textFormat"),
  })
  .loose();

// CellStyleData schema for formatRange
const CellStyleDataSchema = z
  .object({
    cellStyles: CellFormatSchema.optional().describe(
      'Formatting properties. Example: {"textFormat": {"bold": true}, "backgroundColor": "#FF0000"}',
    ),
  })
  .describe(
    'Cell with formatting. MUST use cellStyles wrapper: {"cellStyles": {"textFormat": {"bold": true}}}',
  );

// Spreadsheet FormatRange
export const SpreadsheetFormatRangeSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().optional().describe("The sheet ID (default: 1)"),
  range: z.string().describe("The A1 notation range (e.g., 'A1:C3')"),
  cells: z
    .union([
      z.array(z.array(CellStyleDataSchema)),
      z.string().describe("JSON string representation of 2D cell style array"),
    ])
    .describe(
      '2D array where each cell MUST have cellStyles wrapper. ' +
        'Structure: [[{"cellStyles": {...}}, {"cellStyles": {...}}], ...]. ' +
        'Example for bold A1:B1: [[{"cellStyles": {"textFormat": {"bold": true}}}, {"cellStyles": {"textFormat": {"bold": true}}}]]. ' +
        'Use {} for cells with no formatting.',
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetFormatRangeInput = z.infer<
  typeof SpreadsheetFormatRangeSchema
>;

// Spreadsheet InsertRows
export const SpreadsheetInsertRowsSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  referenceRowIndex: z
    .number()
    .int()
    .describe("The 1-based row index where rows will be inserted"),
  numRows: z
    .number()
    .int()
    .optional()
    .default(1)
    .describe("Number of rows to insert (default: 1)"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetInsertRowsInput = z.infer<
  typeof SpreadsheetInsertRowsSchema
>;

// Spreadsheet InsertColumns
export const SpreadsheetInsertColumnsSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  referenceColumnIndex: z
    .number()
    .int()
    .describe("The 1-based column index where columns will be inserted"),
  numColumns: z
    .number()
    .int()
    .optional()
    .default(1)
    .describe("Number of columns to insert (default: 1)"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetInsertColumnsInput = z.infer<
  typeof SpreadsheetInsertColumnsSchema
>;

// Spreadsheet QueryRange
const QueryItemSchema = z.object({
  sheetId: z
    .number()
    .int()
    .optional()
    .describe("The sheet ID to query (use this OR sheetName, not both)"),
  sheetName: z
    .string()
    .optional()
    .describe("The sheet name to query (use this OR sheetId, not both)"),
  range: z
    .string()
    .describe(
      "A1 notation range WITH sheet name prefix (e.g., \"'Sheet 1'!A1:D10\")",
    ),
  layer: z
    .enum(["values", "formatting"])
    .describe("What to query: values or formatting"),
});

export const SpreadsheetQueryRangeSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  items: z.array(QueryItemSchema).describe("List of range queries"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetQueryRangeInput = z.infer<
  typeof SpreadsheetQueryRangeSchema
>;

// Spreadsheet SetIterativeMode
export const SpreadsheetSetIterativeModeSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  enabled: z.boolean().describe("Whether iterative mode is enabled"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetSetIterativeModeInput = z.infer<
  typeof SpreadsheetSetIterativeModeSchema
>;

// Spreadsheet ReadDocument
export const SpreadsheetReadDocumentSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z
    .number()
    .int()
    .optional()
    .describe("Optional sheet ID to read from."),
  range: z
    .string()
    .optional()
    .describe(
      "Optional A1 notation range (e.g., 'A1:B10') within the selected sheet.",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetReadDocumentInput = z.infer<
  typeof SpreadsheetReadDocumentSchema
>;

// DimensionSpec schema for row height or column width
const DimensionSpecSchema = z.object({
  type: z
    .enum(["autofit", "pixels"])
    .describe(
      "Type of dimension setting: 'autofit' to automatically adjust to content, 'pixels' to set a fixed size in pixels",
    ),
  value: z
    .number()
    .optional()
    .describe("The size in pixels (required when type is 'pixels')"),
});

// Spreadsheet SetRowColDimensions
const SpreadsheetSetRowColDimensionsBaseSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  range: z
    .string()
    .describe(
      "A1 notation for columns (e.g., 'A:G', 'B:B') or rows (e.g., '1:5', '3:3')",
    ),
  width: DimensionSpecSchema.optional().describe(
    "Width specification for columns. Required when range specifies columns.",
  ),
  height: DimensionSpecSchema.optional().describe(
    "Height specification for rows. Required when range specifies rows.",
  ),
  ...ToolExplanationSchemaShape,
});

export const SpreadsheetSetRowColDimensionsSchema =
  SpreadsheetSetRowColDimensionsBaseSchema;

export type SpreadsheetSetRowColDimensionsInput = z.infer<
  typeof SpreadsheetSetRowColDimensionsSchema
>;

// Spreadsheet GetRowColMetadata
export const SpreadsheetGetRowColMetadataSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().optional().describe("The sheet ID (default: 1)"),
  range: z
    .string()
    .describe(
      "A1 notation for columns (e.g., 'A:G') or rows (e.g., '1:5'). Also supports A1 ranges like 'A1:H1' or 'B2:B20'.",
    ),
  dimensionType: z
    .enum(["row", "column"])
    .optional()
    .describe(
      "Optional hint to resolve ambiguous ranges. Use 'column' for width queries and 'row' for height queries.",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetGetRowColMetadataInput = z.infer<
  typeof SpreadsheetGetRowColMetadataSchema
>;

// Spreadsheet DuplicateSheet
export const SpreadsheetDuplicateSheetSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z
    .number()
    .int()
    .describe("The sheet ID (1-based) of the sheet to duplicate"),
  newSheetId: z
    .number()
    .int()
    .optional()
    .describe(
      "Optional sheet ID for the new duplicated sheet. If not provided, one will be auto-generated.",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDuplicateSheetInput = z.infer<
  typeof SpreadsheetDuplicateSheetSchema
>;

// Spreadsheet DeleteCells
export const SpreadsheetDeleteCellsSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID (1-based)"),
  ranges: z
    .array(z.string())
    .describe(
      "List of A1 notation ranges to delete (e.g., ['A1:B5', 'D3:F10']). Cell contents will be cleared.",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDeleteCellsInput = z.infer<
  typeof SpreadsheetDeleteCellsSchema
>;

// Spreadsheet ClearFormatting
export const SpreadsheetClearFormattingSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID (1-based)"),
  ranges: z
    .array(z.string())
    .describe(
      "List of A1 notation ranges to clear formatting from (e.g., ['A1:B5', 'D3:F10']). Values will be preserved.",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetClearFormattingInput = z.infer<
  typeof SpreadsheetClearFormattingSchema
>;

// Spreadsheet ApplyFill
export const SpreadsheetApplyFillSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID (1-based)"),
  activeCell: z
    .string()
    .describe(
      "The active cell in A1 notation (e.g., 'A1'). This is the anchor point, typically the top-left cell of the source selection.",
    ),
  sourceRange: z
    .string()
    .describe(
      "The source range in A1 notation containing the pattern to extend (e.g., 'A1:A2' for a two-cell pattern).",
    ),
  fillRange: z
    .string()
    .describe(
      "The target fill range in A1 notation (INCLUSIVE of source range). This defines the entire area to fill (e.g., 'A1:A10' to fill A3:A10 from pattern in A1:A2).",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetApplyFillInput = z.infer<
  typeof SpreadsheetApplyFillSchema
>;

// Spreadsheet InsertNote
export const SpreadsheetInsertNoteSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID (1-based)"),
  cell: z
    .string()
    .describe(
      "The cell in A1 notation where to insert/update the note (e.g., 'A1', 'B5').",
    ),
  note: z
    .string()
    .optional()
    .describe(
      "The note text to insert. If omitted or empty, the existing note will be removed.",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetInsertNoteInput = z.infer<
  typeof SpreadsheetInsertNoteSchema
>;

// Spreadsheet DeleteRows
export const SpreadsheetDeleteRowsSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID (1-based)"),
  rowIndexes: z
    .array(z.number().int())
    .describe(
      "List of 1-based row indexes to delete (e.g., [1, 3, 5] deletes rows 1, 3, and 5).",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDeleteRowsInput = z.infer<
  typeof SpreadsheetDeleteRowsSchema
>;

// Spreadsheet DeleteColumns
export const SpreadsheetDeleteColumnsSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID (1-based)"),
  columnIndexes: z
    .array(z.number().int())
    .describe(
      "List of 1-based column indexes to delete (e.g., [1, 3] deletes columns A and C). A=1, B=2, C=3, etc.",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDeleteColumnsInput = z.infer<
  typeof SpreadsheetDeleteColumnsSchema
>;

// Spreadsheet ModifyRowsCols - consolidated insert/delete rows/columns
export const SpreadsheetModifyRowsColsSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  action: z
    .enum(["insert", "delete"])
    .describe(
      "Action to perform: 'insert' to add rows/columns, 'delete' to remove them",
    ),
  dimension: z
    .enum(["row", "column"])
    .describe("Whether to modify rows or columns"),
  // For insert
  index: z
    .number()
    .int()
    .optional()
    .describe(
      "For insert: the 1-based index where rows/columns will be inserted. Required when action is 'insert'.",
    ),
  count: z
    .number()
    .int()
    .optional()
    .default(1)
    .describe("For insert: number of rows/columns to insert (default: 1)"),
  // For delete rows
  indexes: z
    .array(z.number().int())
    .optional()
    .describe(
      "For delete rows: list of 1-based row indexes to delete (e.g., [1, 3, 5])",
    ),
  // For delete columns
  columns: z
    .array(z.string())
    .optional()
    .describe(
      "For delete columns: list of column letters to delete (e.g., ['A', 'C', 'AA'])",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetModifyRowsColsInput = z.infer<
  typeof SpreadsheetModifyRowsColsSchema
>;

// Table theme - simplified for LLM
const TableThemeSchema = z
  .enum(["none", "light", "medium", "dark"])
  .optional()
  .describe(
    "Table style theme. 'light' = subtle styling, 'medium' = balanced (default), 'dark' = bold styling.",
  );

// Column definition for tables
const TableColumnSchema = z.object({
  name: z.string().describe("Column header name"),
  formula: z
    .string()
    .optional()
    .describe(
      "Optional formula for calculated columns (e.g., '=[Price]*[Quantity]'). Uses structured references.",
    ),
  filterButton: z
    .boolean()
    .optional()
    .describe("Whether to show filter button on this column. Default: true."),
});

export type TableColumn = z.infer<typeof TableColumnSchema>;

// Banding properties for alternating row/column colors
const BandingPropertiesSchema = z.object({
  headerColor: ColorSchema.optional().describe(
    "Header band color as hex string (e.g., '#4472C4') or theme reference",
  ),
  footerColor: ColorSchema.optional().describe(
    "Footer band color as hex string or theme reference",
  ),
  firstBandColor: ColorSchema.optional().describe(
    "First (odd) alternating band color as hex string (e.g., '#D6DCE5') or theme reference",
  ),
  secondBandColor: ColorSchema.optional().describe(
    "Second (even) alternating band color as hex string (e.g., '#FFFFFF') or theme reference",
  ),
  headerBorder: BordersSchema.describe("Header row border"),
  footerBorder: BordersSchema.describe("Footer row border"),
  firstBandBorder: BordersSchema.describe("First (odd) band border"),
  secondBandBorder: BordersSchema.describe("Second (even) band border"),
});

const BandedRangeSchema = z
  .object({
    rowProperties: BandingPropertiesSchema.optional().describe(
      "Banding colors for alternating rows",
    ),
    columnProperties: BandingPropertiesSchema.optional().describe(
      "Banding colors for alternating columns",
    ),
  })
  .describe("REQUIRED when showRowStripes or showColumnStripes is true.");

// Spreadsheet CreateTable
export const SpreadsheetCreateTableSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  range: z
    .string()
    .describe(
      "The A1 notation range for the table (e.g., 'A1:D10'). First row becomes headers.",
    ),
  title: z
    .string()
    .min(1)
    .describe(
      "REQUIRED: Table name (must be unique per workbook). Used for structured references like TableName[Column].",
    ),
  columns: z
    .array(TableColumnSchema)
    .describe(
      "Column definitions. Simple: [{ name: 'Price' }]. Calculated: [{ name: 'Total', formula: '=[Price]*[Qty]' }]",
    ),
  theme: TableThemeSchema,
  headerRow: z
    .boolean()
    .optional()
    .describe("Whether the table displays a header row. Default: true."),
  showRowStripes: z
    .boolean()
    .optional()
    .describe(
      "Whether to show alternating row colors. When true, you MUST also provide bandedRange.",
    ),
  showColumnStripes: z
    .boolean()
    .optional()
    .describe("Whether to show alternating column colors."),
  showFirstColumn: z
    .boolean()
    .optional()
    .describe("Whether to highlight the first column."),
  showLastColumn: z
    .boolean()
    .optional()
    .describe("Whether to highlight the last column."),
  filterButton: z
    .boolean()
    .optional()
    .describe(
      "Whether to show filter buttons on column headers. Default: true.",
    ),
  bandedRange: BandedRangeSchema.optional(),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetCreateTableInput = z.infer<
  typeof SpreadsheetCreateTableSchema
>;

// Spreadsheet UpdateTable
export const SpreadsheetUpdateTableSchema = z
  .object({
    docId: z.string().describe("The document ID of the spreadsheet"),
    sheetId: z.number().int().describe("The sheet ID"),
    tableId: z
      .string()
      .optional()
      .describe("The table ID to update. Provide either tableId or tableName."),
    tableName: z
      .string()
      .optional()
      .describe(
        "The table name/title to update. Provide either tableId or tableName.",
      ),
    title: z
      .string()
      .min(1)
      .optional()
      .describe("New table name/title. Must be unique within the workbook."),
    columns: z
      .array(TableColumnSchema)
      .optional()
      .describe(
        "Updated column definitions. Must match the current number of columns.",
      ),
    theme: TableThemeSchema,
    headerRow: z.boolean().optional().describe("Whether to show header row."),
    showRowStripes: z
      .boolean()
      .optional()
      .describe(
        "Whether to show alternating row colors. When true, you MUST also provide bandedRange.",
      ),
    showColumnStripes: z
      .boolean()
      .optional()
      .describe("Whether to show alternating column colors."),
    showFirstColumn: z
      .boolean()
      .optional()
      .describe("Whether to highlight the first column."),
    showLastColumn: z
      .boolean()
      .optional()
      .describe("Whether to highlight the last column."),
    filterButton: z
      .boolean()
      .optional()
      .describe("Whether to show filter buttons on column headers."),
    bandedRange: BandedRangeSchema.nullable()
      .optional()
      .describe(
        "Color definitions for banding. Set to null to remove existing banding.",
      ),
    ...ToolExplanationSchemaShape,
  })
  .refine((data) => data.tableId || data.tableName, {
    message: "Either tableId or tableName must be provided",
  });

export type SpreadsheetUpdateTableInput = z.infer<
  typeof SpreadsheetUpdateTableSchema
>;

// Chart type enum
const ChartTypeSchema = z
  .enum(["bar", "column", "line", "pie", "area", "scatter"])
  .describe(
    "Chart type: 'bar' (horizontal), 'column' (vertical), 'line', 'pie', 'area', 'scatter'",
  );

// Stacked type for bar/column/area charts
const StackedTypeSchema = z
  .enum(["stacked", "percentStacked", "unstacked"])
  .optional()
  .describe(
    "Stacking mode for bar/column/area charts. 'stacked' = values stacked, 'percentStacked' = 100% stacked.",
  );

// Spreadsheet CreateChart
export const SpreadsheetCreateChartSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  domain: z
    .string()
    .describe(
      "A1 notation range for X-axis categories/labels (e.g., 'A2:A10' for months). Usually a single column.",
    ),
  series: z
    .array(z.string())
    .describe(
      "Array of A1 notation ranges for data series (e.g., ['B2:B10', 'C2:C10']). Each range becomes a separate series in the chart.",
    ),
  chartType: ChartTypeSchema,
  title: z.string().optional().describe("Chart title displayed at the top."),
  subtitle: z.string().optional().describe("Chart subtitle below the title."),
  anchorCell: z
    .string()
    .optional()
    .describe(
      "Cell where chart's top-left corner is placed (e.g., 'F1'). Defaults to right of data.",
    ),
  width: z
    .number()
    .int()
    .optional()
    .describe("Chart width in pixels. Default: 400."),
  height: z
    .number()
    .int()
    .optional()
    .describe("Chart height in pixels. Default: 300."),
  stackedType: StackedTypeSchema,
  xAxisTitle: z
    .string()
    .optional()
    .describe("Title for horizontal axis (categories)."),
  yAxisTitle: z
    .string()
    .optional()
    .describe("Title for vertical axis (values)."),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetCreateChartInput = z.infer<
  typeof SpreadsheetCreateChartSchema
>;

// Spreadsheet UpdateChart
export const SpreadsheetUpdateChartSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  chartId: z.string().describe("The chart ID to update (required)."),
  title: z
    .string()
    .nullable()
    .optional()
    .describe("New chart title. Set to null to clear."),
  subtitle: z
    .string()
    .nullable()
    .optional()
    .describe("New chart subtitle. Set to null to clear."),
  domain: z
    .string()
    .optional()
    .describe(
      "New A1 notation range for X-axis categories (e.g., 'A2:A10'). DO NOT include header row.",
    ),
  series: z
    .array(z.string())
    .optional()
    .describe(
      "New array of A1 notation ranges for data series (e.g., ['B2:B10', 'C2:C10']). DO NOT include header rows.",
    ),
  chartType: ChartTypeSchema.optional().describe("Change chart type."),
  stackedType: StackedTypeSchema,
  xAxisTitle: z
    .string()
    .nullable()
    .optional()
    .describe("New horizontal axis title. Set to null to clear."),
  yAxisTitle: z
    .string()
    .nullable()
    .optional()
    .describe("New vertical axis title. Set to null to clear."),
  anchorCell: z
    .string()
    .nullable()
    .optional()
    .describe("Move chart to this cell (e.g., 'H1')."),
  width: z.number().int().optional().describe("New chart width in pixels."),
  height: z.number().int().optional().describe("New chart height in pixels."),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetUpdateChartInput = z.infer<
  typeof SpreadsheetUpdateChartSchema
>;

// Spreadsheet DeleteSheet
export const SpreadsheetDeleteSheetSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID to delete"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDeleteSheetInput = z.infer<
  typeof SpreadsheetDeleteSheetSchema
>;

// Spreadsheet DeleteChart
export const SpreadsheetDeleteChartSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  chartId: z.string().describe("The chart ID to delete"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDeleteChartInput = z.infer<
  typeof SpreadsheetDeleteChartSchema
>;

// Spreadsheet DeleteTable
export const SpreadsheetDeleteTableSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID containing the table"),
  tableId: z.string().describe("The table ID to delete"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDeleteTableInput = z.infer<
  typeof SpreadsheetDeleteTableSchema
>;

// Data Validation Types
const DataValidationTypeSchema = z
  .enum(["list", "number", "wholeNumber", "date", "custom"])
  .describe(
    "Type of validation: 'list' for dropdown, 'number'/'wholeNumber' for numeric, 'date' for dates, 'custom' for formula",
  );

const NumberOperatorSchema = z
  .enum([
    "between",
    "notBetween",
    "equal",
    "notEqual",
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
  ])
  .optional()
  .describe(
    "Comparison operator for number/date validation. Default: 'between'",
  );

const DateOperatorSchema = z
  .enum([
    "between",
    "notBetween",
    "equal",
    "notEqual",
    "before",
    "onOrBefore",
    "after",
    "onOrAfter",
  ])
  .optional()
  .describe("Comparison operator for date validation. Default: 'between'");

// Spreadsheet CreateDataValidation
export const SpreadsheetCreateDataValidationSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  range: z
    .string()
    .describe(
      "A1 notation range to apply validation. Use EXACTLY what user specifies - can be single cell (e.g., 'E1') or range (e.g., 'B2:B50').",
    ),
  validationType: DataValidationTypeSchema,

  // List validation
  listValues: z
    .array(z.string())
    .optional()
    .describe(
      "For 'list' type: array of allowed values (e.g., ['Yes', 'No', 'Maybe'])",
    ),
  listRange: z
    .string()
    .optional()
    .describe(
      "For 'list' type: A1 range reference for dropdown values (e.g., 'Sheet2!A1:A10'). Use instead of listValues.",
    ),

  // Number validation
  numberOperator: NumberOperatorSchema,
  minValue: z
    .number()
    .optional()
    .describe(
      "For number type: minimum value (used with 'between', 'greaterThan', etc.)",
    ),
  maxValue: z
    .number()
    .optional()
    .describe(
      "For number type: maximum value (used with 'between', 'lessThan', etc.)",
    ),

  // Date validation
  dateOperator: DateOperatorSchema,
  minDate: z
    .string()
    .optional()
    .describe("For date type: minimum date as ISO string or cell reference"),
  maxDate: z
    .string()
    .optional()
    .describe("For date type: maximum date as ISO string or cell reference"),

  // Custom formula
  customFormula: z
    .string()
    .optional()
    .describe(
      "For 'custom' type: formula that returns TRUE for valid values (e.g., '=A1>0')",
    ),

  // Common options
  allowBlank: z
    .boolean()
    .optional()
    .describe("Allow empty cells. Default: true"),
  showDropdown: z
    .boolean()
    .optional()
    .describe("Show dropdown arrow for list validation. Default: true"),
  inputTitle: z
    .string()
    .optional()
    .describe("Title shown when cell is selected"),
  inputMessage: z
    .string()
    .optional()
    .describe("Help message shown when cell is selected"),
  errorStyle: z
    .enum(["stop", "warning", "information"])
    .optional()
    .describe(
      "Error behavior: 'stop' rejects, 'warning'/'information' allows. Default: 'stop'",
    ),
  errorTitle: z.string().optional().describe("Error dialog title"),
  errorMessage: z.string().optional().describe("Error dialog message"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetCreateDataValidationInput = z.infer<
  typeof SpreadsheetCreateDataValidationSchema
>;

// Spreadsheet UpdateDataValidation
export const SpreadsheetUpdateDataValidationSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  validationId: z.string().describe("The data validation rule ID to update"),

  // All fields optional for update
  range: z
    .string()
    .optional()
    .describe("New A1 notation range for the validation"),
  validationType: DataValidationTypeSchema.optional(),
  listValues: z.array(z.string()).optional(),
  listRange: z.string().optional(),
  numberOperator: NumberOperatorSchema,
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  dateOperator: DateOperatorSchema,
  minDate: z.string().optional(),
  maxDate: z.string().optional(),
  customFormula: z.string().optional(),
  allowBlank: z.boolean().optional(),
  showDropdown: z.boolean().optional(),
  inputTitle: z.string().nullable().optional(),
  inputMessage: z.string().nullable().optional(),
  errorStyle: z.enum(["stop", "warning", "information"]).optional(),
  errorTitle: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetUpdateDataValidationInput = z.infer<
  typeof SpreadsheetUpdateDataValidationSchema
>;

// Spreadsheet DeleteDataValidation
export const SpreadsheetDeleteDataValidationSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  validationId: z.string().describe("The data validation rule ID to delete"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDeleteDataValidationInput = z.infer<
  typeof SpreadsheetDeleteDataValidationSchema
>;

// Conditional Format Rule Types
const ConditionalFormatRuleTypeSchema = z
  .enum(["condition", "colorScale", "topBottom", "duplicates"])
  .describe(
    "Type of conditional format: 'condition' for value-based, 'colorScale' for gradients, 'topBottom' for ranking, 'duplicates' for duplicate detection",
  );

const ConditionTypeForFormatSchema = z
  .enum([
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
    "equal",
    "notEqual",
    "between",
    "notBetween",
    "textContains",
    "textNotContains",
    "textStartsWith",
    "textEndsWith",
    "blank",
    "notBlank",
    "custom",
  ])
  .optional()
  .describe("Condition type for 'condition' rule type");

// Spreadsheet CreateConditionalFormat
export const SpreadsheetCreateConditionalFormatSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  range: z
    .string()
    .describe(
      "A1 notation range to apply formatting. Use EXACTLY what user specifies.",
    ),
  ruleType: ConditionalFormatRuleTypeSchema,

  // For "condition" rule type
  conditionType: ConditionTypeForFormatSchema,
  conditionValues: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe(
      "Values for condition (e.g., [50] for greaterThan, [10, 90] for between)",
    ),
  customFormula: z
    .string()
    .optional()
    .describe("Custom formula for 'custom' condition type (e.g., '=A1>B1')"),

  // For "colorScale" rule type
  colorScaleType: z
    .enum(["2color", "3color"])
    .optional()
    .describe("Type of color scale: '2color' or '3color'"),
  minColor: z
    .string()
    .optional()
    .describe("Color for minimum value (e.g., '#FF0000' for red)"),
  midColor: z
    .string()
    .optional()
    .describe("Color for midpoint value (only for 3color scale)"),
  maxColor: z
    .string()
    .optional()
    .describe("Color for maximum value (e.g., '#00FF00' for green)"),

  // For "topBottom" rule type
  topBottomType: z
    .enum(["top", "bottom"])
    .optional()
    .describe("Highlight 'top' or 'bottom' values"),
  rank: z
    .number()
    .int()
    .optional()
    .describe("Number of items or percentage to highlight (e.g., 10)"),
  isPercent: z
    .boolean()
    .optional()
    .describe(
      "If true, rank is percentage (top 10%); if false, rank is count (top 10 items)",
    ),

  // For "duplicates" rule type
  duplicateType: z
    .enum(["duplicate", "unique"])
    .optional()
    .describe("Highlight 'duplicate' or 'unique' values"),

  // Format to apply (for condition, topBottom, duplicates)
  backgroundColor: z
    .string()
    .optional()
    .describe("Background color to apply (e.g., '#FFCCCC')"),
  textColor: z
    .string()
    .optional()
    .describe("Text color to apply (e.g., '#FF0000')"),
  bold: z.boolean().optional().describe("Make text bold"),
  italic: z.boolean().optional().describe("Make text italic"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetCreateConditionalFormatInput = z.infer<
  typeof SpreadsheetCreateConditionalFormatSchema
>;

// Spreadsheet UpdateConditionalFormat
export const SpreadsheetUpdateConditionalFormatSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  ruleId: z.string().describe("The conditional format rule ID to update"),

  // All fields optional for update
  range: z.string().optional().describe("New A1 notation range"),
  ruleType: ConditionalFormatRuleTypeSchema.optional(),
  conditionType: ConditionTypeForFormatSchema,
  conditionValues: z.array(z.union([z.string(), z.number()])).optional(),
  customFormula: z.string().optional(),
  colorScaleType: z.enum(["2color", "3color"]).optional(),
  minColor: z.string().optional(),
  midColor: z.string().optional(),
  maxColor: z.string().optional(),
  topBottomType: z.enum(["top", "bottom"]).optional(),
  rank: z.number().int().optional(),
  isPercent: z.boolean().optional(),
  duplicateType: z.enum(["duplicate", "unique"]).optional(),
  backgroundColor: z.string().optional(),
  textColor: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  enabled: z.boolean().optional().describe("Enable or disable the rule"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetUpdateConditionalFormatInput = z.infer<
  typeof SpreadsheetUpdateConditionalFormatSchema
>;

// Spreadsheet DeleteConditionalFormat
export const SpreadsheetDeleteConditionalFormatSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  ruleId: z.string().describe("The conditional format rule ID to delete"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDeleteConditionalFormatInput = z.infer<
  typeof SpreadsheetDeleteConditionalFormatSchema
>;

// Spreadsheet QueryDataValidations
export const SpreadsheetQueryDataValidationsSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z
    .number()
    .int()
    .optional()
    .describe("Optional sheet ID to filter validations by"),
  range: z
    .string()
    .optional()
    .describe(
      "Optional A1 range to filter validations that overlap with this range (e.g., 'A1:B10')",
    ),
});

export type SpreadsheetQueryDataValidationsInput = z.infer<
  typeof SpreadsheetQueryDataValidationsSchema
>;

// Spreadsheet QueryConditionalFormats
export const SpreadsheetQueryConditionalFormatsSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z
    .number()
    .int()
    .optional()
    .describe("Optional sheet ID to filter conditional formats by"),
  range: z
    .string()
    .optional()
    .describe(
      "Optional A1 range to filter conditional formats that overlap with this range (e.g., 'A1:B10')",
    ),
});

export type SpreadsheetQueryConditionalFormatsInput = z.infer<
  typeof SpreadsheetQueryConditionalFormatsSchema
>;

// ==================== CONSOLIDATED SCHEMAS ====================

// Spreadsheet Table - consolidated create/update/delete
export const SpreadsheetTableSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID"),
  action: z
    .enum(["create", "update", "delete"])
    .describe("Action to perform on the table"),

  // For create/update - table identification
  tableId: z
    .string()
    .optional()
    .describe(
      "The table ID. Required for 'update' and 'delete'. For 'update', provide either tableId or tableName.",
    ),
  tableName: z
    .string()
    .optional()
    .describe(
      "The table name/title. For 'update', can be used instead of tableId.",
    ),

  // For create
  range: z
    .string()
    .optional()
    .describe(
      "For 'create': A1 notation range for the table (e.g., 'A1:D10'). First row becomes headers.",
    ),
  title: z
    .string()
    .optional()
    .describe(
      "For 'create': REQUIRED table name (must be unique per workbook). For 'update': new table name.",
    ),
  columns: z
    .array(TableColumnSchema)
    .optional()
    .describe(
      "Column definitions. Simple: [{ name: 'Price' }]. Calculated: [{ name: 'Total', formula: '=[Price]*[Qty]' }]",
    ),
  theme: TableThemeSchema,
  headerRow: z
    .boolean()
    .optional()
    .describe("Whether the table displays a header row. Default: true."),
  showRowStripes: z
    .boolean()
    .optional()
    .describe("Whether to show alternating row colors."),
  showColumnStripes: z
    .boolean()
    .optional()
    .describe("Whether to show alternating column colors."),
  showFirstColumn: z
    .boolean()
    .optional()
    .describe("Whether to highlight the first column."),
  showLastColumn: z
    .boolean()
    .optional()
    .describe("Whether to highlight the last column."),
  filterButton: z
    .boolean()
    .optional()
    .describe("Whether to show filter buttons on column headers."),
  bandedRange: BandedRangeSchema.nullable().optional(),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetTableInput = z.infer<typeof SpreadsheetTableSchema>;

// Spreadsheet Chart - consolidated create/update/delete
export const SpreadsheetChartSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z
    .number()
    .int()
    .optional()
    .describe("The sheet ID. Required for 'create'."),
  action: z
    .enum(["create", "update", "delete"])
    .describe("Action to perform on the chart"),

  // For update/delete
  chartId: z
    .string()
    .optional()
    .describe("The chart ID. Required for 'update' and 'delete'."),

  // Chart data
  domain: z
    .string()
    .optional()
    .describe(
      "A1 notation range for X-axis categories (e.g., 'A2:A10'). Required for 'create'.",
    ),
  series: z
    .array(z.string())
    .optional()
    .describe(
      "Array of A1 notation ranges for data series (e.g., ['B2:B10', 'C2:C10']). Required for 'create'.",
    ),
  chartType: ChartTypeSchema.optional().describe(
    "Chart type. Required for 'create'.",
  ),

  // Chart options
  title: z
    .string()
    .nullable()
    .optional()
    .describe("Chart title. Set to null to clear."),
  subtitle: z
    .string()
    .nullable()
    .optional()
    .describe("Chart subtitle. Set to null to clear."),
  anchorCell: z
    .string()
    .nullable()
    .optional()
    .describe("Cell where chart's top-left corner is placed (e.g., 'F1')."),
  width: z.number().int().optional().describe("Chart width in pixels."),
  height: z.number().int().optional().describe("Chart height in pixels."),
  stackedType: StackedTypeSchema,
  xAxisTitle: z
    .string()
    .nullable()
    .optional()
    .describe("Title for horizontal axis."),
  yAxisTitle: z
    .string()
    .nullable()
    .optional()
    .describe("Title for vertical axis."),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetChartInput = z.infer<typeof SpreadsheetChartSchema>;

// Spreadsheet DataValidation - consolidated create/update/delete/query
export const SpreadsheetDataValidationSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z
    .number()
    .int()
    .optional()
    .describe("The sheet ID. Required for create/update/delete."),
  action: z
    .enum(["create", "update", "delete", "query"])
    .describe("Action to perform"),

  // For update/delete
  validationId: z
    .string()
    .optional()
    .describe("The validation rule ID. Required for 'update' and 'delete'."),

  // For create/update/query
  range: z
    .string()
    .optional()
    .describe(
      "A1 notation range. Required for 'create'. Optional for 'query' to filter by range.",
    ),
  validationType: DataValidationTypeSchema.optional().describe(
    "Type of validation. Required for 'create'.",
  ),

  // List validation
  listValues: z
    .array(z.string())
    .optional()
    .describe("For 'list' type: array of allowed values"),
  listRange: z
    .string()
    .optional()
    .describe("For 'list' type: A1 range reference for dropdown values"),

  // Number validation
  numberOperator: NumberOperatorSchema,
  minValue: z.number().optional().describe("For number type: minimum value"),
  maxValue: z.number().optional().describe("For number type: maximum value"),

  // Date validation
  dateOperator: DateOperatorSchema,
  minDate: z.string().optional().describe("For date type: minimum date"),
  maxDate: z.string().optional().describe("For date type: maximum date"),

  // Custom formula
  customFormula: z
    .string()
    .optional()
    .describe("For 'custom' type: formula that returns TRUE for valid values"),

  // Common options
  allowBlank: z.boolean().optional().describe("Allow empty cells"),
  showDropdown: z
    .boolean()
    .optional()
    .describe("Show dropdown arrow for list validation"),
  inputTitle: z
    .string()
    .nullable()
    .optional()
    .describe("Title shown when cell is selected"),
  inputMessage: z
    .string()
    .nullable()
    .optional()
    .describe("Help message shown when cell is selected"),
  errorStyle: z
    .enum(["stop", "warning", "information"])
    .optional()
    .describe("Error behavior"),
  errorTitle: z.string().nullable().optional().describe("Error dialog title"),
  errorMessage: z
    .string()
    .nullable()
    .optional()
    .describe("Error dialog message"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetDataValidationInput = z.infer<
  typeof SpreadsheetDataValidationSchema
>;

// Spreadsheet ConditionalFormat - consolidated create/update/delete/query
export const SpreadsheetConditionalFormatSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z
    .number()
    .int()
    .optional()
    .describe("The sheet ID. Required for create/update/delete."),
  action: z
    .enum(["create", "update", "delete", "query"])
    .describe("Action to perform"),

  // For update/delete
  ruleId: z
    .string()
    .optional()
    .describe(
      "The conditional format rule ID. Required for 'update' and 'delete'.",
    ),

  // For create/update/query
  range: z
    .string()
    .optional()
    .describe(
      "A1 notation range. Required for 'create'. Optional for 'query' to filter by range.",
    ),
  ruleType: ConditionalFormatRuleTypeSchema.optional().describe(
    "Type of conditional format. Required for 'create'.",
  ),

  // For "condition" rule type
  conditionType: ConditionTypeForFormatSchema,
  conditionValues: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe("Values for condition"),
  customFormula: z.string().optional().describe("Custom formula"),

  // For "colorScale" rule type
  colorScaleType: z.enum(["2color", "3color"]).optional(),
  minColor: z.string().optional().describe("Color for minimum value"),
  midColor: z.string().optional().describe("Color for midpoint value"),
  maxColor: z.string().optional().describe("Color for maximum value"),

  // For "topBottom" rule type
  topBottomType: z.enum(["top", "bottom"]).optional(),
  rank: z.number().int().optional().describe("Number of items or percentage"),
  isPercent: z.boolean().optional().describe("If true, rank is percentage"),

  // For "duplicates" rule type
  duplicateType: z.enum(["duplicate", "unique"]).optional(),

  // Format to apply
  backgroundColor: z.string().optional().describe("Background color to apply"),
  textColor: z.string().optional().describe("Text color to apply"),
  bold: z.boolean().optional().describe("Make text bold"),
  italic: z.boolean().optional().describe("Make text italic"),
  enabled: z.boolean().optional().describe("Enable or disable the rule"),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetConditionalFormatInput = z.infer<
  typeof SpreadsheetConditionalFormatSchema
>;

// Spreadsheet ClearCells - consolidated deleteCells/clearFormatting
export const SpreadsheetClearCellsSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z.number().int().describe("The sheet ID (1-based)"),
  ranges: z
    .array(z.string())
    .describe("List of A1 notation ranges (e.g., ['A1:B5', 'D3:F10'])"),
  clear: z
    .enum(["values", "formatting", "all"])
    .describe(
      "'values' to clear cell contents only, 'formatting' to clear formatting only, 'all' to clear both",
    ),
  ...ToolExplanationSchemaShape,
});

export type SpreadsheetClearCellsInput = z.infer<
  typeof SpreadsheetClearCellsSchema
>;

// Spreadsheet GetAuditSnapshot - comprehensive audit data collection
export const SpreadsheetGetAuditSnapshotSchema = z.object({
  docId: z.string().describe("The document ID of the spreadsheet"),
  sheetId: z
    .number()
    .int()
    .optional()
    .describe(
      "Optional: specific sheet ID to audit. If omitted, audits all sheets.",
    ),
});

export type SpreadsheetGetAuditSnapshotInput = z.infer<
  typeof SpreadsheetGetAuditSnapshotSchema
>;
