# Missing Spreadsheet Tools vs Interface Coverage

## Scope

This document tracks capabilities that exist in:

- `spreadsheet-v2/libs/spreadsheet-state/interface/spreadsheet-interface.ts`

but are not currently exposed as assistant tools in:

- `rowsncolumns-ai/lib/chat/tools.ts`

As of now, `lib/chat/tools.ts` exports 18 tools and all 18 are included in `spreadsheetTools`.

## Not Exposed As Tools

The following `Spreadsheet` public methods are not currently surfaced as dedicated assistant tools:

- `changeBatchStream`
- `insertTableRow`
- `insertTableColumn`
- `deleteTableColumn`
- `deleteTableRow`
- `deleteCellsShiftLeft`
- `deleteCellsShiftUp`
- `changeBorder`
- `changeDecimals`
- `changeTheme`
- `removeDuplicates`
- `increaseIndent`
- `decreaseIndent`
- `createNamedRange`
- `deleteNamedRange`
- `createEmbed`
- `updateEmbed`
- `deleteEmbed`
- `moveEmbed`
- `resizeEmbed`
- `createPivotTable`
- `deletePivotTable`
- `previewConditionalFormattingRule`
- `deleteDataValidationRules`
- `createCitation`
- `updateCitation`
- `removeCitationFromCell`
- `deleteCitation`

## Covered Indirectly (No New Tool Needed Right Now)

These interface methods are not called directly from `tools.ts`, but their outcomes are available through consolidated tools:

- `freezeRow`, `freezeColumn`, `hideRows`, `hideColumns`, `changeSheetTabcolor`:
  covered by `spreadsheet_sheet` via sheet metadata updates (`frozenRowCount`, `frozenColumnCount`, `rowMetadata`, `columnMetadata`, `tabColor`).
- `moveChart`, `resizeChart`:
  covered by `spreadsheet_chart` update action using `anchorCell`, `width`, and `height`.

## Candidate Tool Additions (Priority Order)

### High

- Named ranges (`create/delete`) for formula-heavy workflows.
- Embed operations (`create/update/delete/move/resize`) for richer documents.
- Pivot table operations (`create/delete`) for analytics workflows.

### Medium

- Table structural ops (`insert/delete row/column`).
- Citation lifecycle ops (`update/remove/delete` beyond write-time citation assignment).
- `removeDuplicates`.

### Low

- Formatting micro-ops (`changeBorder`, `changeDecimals`, `increaseIndent`, `decreaseIndent`) since current formatting tools already cover broad use cases.
- `changeBatchStream` unless streaming writes become a core assistant workflow.
- `previewConditionalFormattingRule` and batch `deleteDataValidationRules` unless explicit UI workflows require them.
