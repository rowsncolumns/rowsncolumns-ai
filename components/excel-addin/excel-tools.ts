"use client";

import type { ExcelToolCall } from "@/lib/chat/excel-protocol";

type ToolResult = {
  success: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const getWorksheetBySheetId = async (
  context: Excel.RequestContext,
  sheetId: number | undefined,
) => {
  const worksheets = context.workbook.worksheets;
  if (sheetId === undefined) {
    return worksheets.getActiveWorksheet();
  }

  worksheets.load("items/id,items/name,items/position");
  await context.sync();

  const candidate = worksheets.items.find(
    (sheet) =>
      sheet.position + 1 === sheetId ||
      Number.parseInt(sheet.id, 10) === sheetId ||
      sheet.name === String(sheetId),
  );

  return candidate ?? worksheets.getActiveWorksheet();
};

const parseCells2d = (input: unknown) => {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
  return input;
};

const parseRangeStyleCells = (input: unknown) => {
  const parsed = parseCells2d(input);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const firstRow = parsed[0];
  if (!Array.isArray(firstRow) || firstRow.length === 0) return null;
  const firstCell = firstRow[0];
  if (!isRecord(firstCell)) return null;
  const styles = firstCell.cellStyles;
  if (!isRecord(styles)) return null;
  return styles;
};

const normalizeColor = (value: unknown) => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
};

const handleSpreadsheetChangeBatch = async (
  context: Excel.RequestContext,
  args: unknown,
): Promise<ToolResult> => {
  const input = isRecord(args) ? args : {};
  const rangeAddress = asString(input.range);
  const sheetId = asNumber(input.sheetId);
  if (!rangeAddress) {
    return { success: false, error: "range is required." };
  }

  const cells = parseCells2d(input.cells);
  if (!Array.isArray(cells)) {
    return { success: false, error: "cells must be a 2D array." };
  }

  const worksheet = await getWorksheetBySheetId(context, sheetId);
  const range = worksheet.getRange(rangeAddress);

  const values = cells.map((row) => {
    if (!Array.isArray(row)) return [null];
    return row.map((cell) => {
      if (!isRecord(cell)) return null;
      const formula = asString(cell.formula);
      if (formula) {
        return formula.startsWith("=") ? formula : `=${formula}`;
      }
      if (!("value" in cell)) return null;
      const value = cell.value;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return value;
      }
      return String(value);
    });
  });

  range.values = values as (string | number | boolean | null)[][];
  await context.sync();

  return {
    success: true,
    message: `Updated range ${rangeAddress}.`,
    range: rangeAddress,
  };
};

const handleSpreadsheetQueryRange = async (
  context: Excel.RequestContext,
  args: unknown,
): Promise<ToolResult> => {
  const input = isRecord(args) ? args : {};
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    return { success: false, error: "items[] is required." };
  }

  const worksheet = await getWorksheetBySheetId(context, undefined);
  const ranges = items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const range = asString(item.range);
    const layer = asString(item.layer) ?? "values";
    if (!range) return [];
    const ref = worksheet.getRange(range);
    if (layer === "formatting") {
      ref.load([
        "address",
        "format/fill/color",
        "format/font/bold",
        "format/font/color",
        "format/font/italic",
        "format/font/size",
        "format/horizontalAlignment",
        "format/verticalAlignment",
      ]);
    } else {
      ref.load(["address", "values", "formulas", "text", "numberFormat"]);
    }
    return [{ range, layer, ref }];
  });

  if (ranges.length === 0) {
    return { success: false, error: "No valid query items found." };
  }

  await context.sync();

  const resultItems = ranges.map(({ range, layer, ref }) => {
    if (layer === "formatting") {
      return {
        range,
        layer,
        formatting: {
          fillColor: ref.format.fill.color,
          fontColor: ref.format.font.color,
          fontBold: ref.format.font.bold,
          fontItalic: ref.format.font.italic,
          fontSize: ref.format.font.size,
          horizontalAlignment: ref.format.horizontalAlignment,
          verticalAlignment: ref.format.verticalAlignment,
        },
      };
    }

    return {
      range,
      layer,
      values: ref.values,
      formulas: ref.formulas,
      text: ref.text,
      numberFormat: ref.numberFormat,
    };
  });

  return {
    success: true,
    items: resultItems,
  };
};

const handleSpreadsheetReadDocument = async (
  context: Excel.RequestContext,
  args: unknown,
): Promise<ToolResult> => {
  const input = isRecord(args) ? args : {};
  const rangeAddress = asString(input.range);
  const sheetId = asNumber(input.sheetId);

  const worksheet = await getWorksheetBySheetId(context, sheetId);
  worksheet.load(["name", "position", "id"]);

  const range = rangeAddress
    ? worksheet.getRange(rangeAddress)
    : worksheet.getUsedRangeOrNullObject();
  range.load(["address", "values", "formulas", "text", "numberFormat"]);

  await context.sync();

  if (!rangeAddress && range.isNullObject) {
    return {
      success: true,
      message: "Sheet is empty.",
      sheet: {
        sheetId: worksheet.position + 1,
        name: worksheet.name,
        excelSheetId: worksheet.id,
      },
      range: null,
      values: [],
    };
  }

  return {
    success: true,
    sheet: {
      sheetId: worksheet.position + 1,
      name: worksheet.name,
      excelSheetId: worksheet.id,
    },
    range: range.address,
    values: range.values,
    formulas: range.formulas,
    text: range.text,
    numberFormat: range.numberFormat,
  };
};

const handleSpreadsheetCreateSheet = async (
  context: Excel.RequestContext,
  args: unknown,
): Promise<ToolResult> => {
  const input = isRecord(args) ? args : {};
  const sheetSpec = isRecord(input.sheetSpec) ? input.sheetSpec : {};

  const title = asString(sheetSpec.title);
  const worksheet = context.workbook.worksheets.add(title);

  if (sheetSpec.hidden === true) {
    worksheet.visibility = Excel.SheetVisibility.hidden;
  }
  if (sheetSpec.hidden === false) {
    worksheet.visibility = Excel.SheetVisibility.visible;
  }

  const frozenRows = asNumber(sheetSpec.frozenRowCount);
  if (frozenRows && frozenRows > 0) {
    worksheet.freezePanes.freezeRows(frozenRows);
  }
  const frozenColumns = asNumber(sheetSpec.frozenColumnCount);
  if (frozenColumns && frozenColumns > 0) {
    worksheet.freezePanes.freezeColumns(frozenColumns);
  }

  const tabColor = normalizeColor(sheetSpec.tabColor);
  if (tabColor) {
    worksheet.tabColor = tabColor;
  }

  worksheet.load(["id", "name", "position"]);
  await context.sync();

  return {
    success: true,
    message: `Created sheet "${worksheet.name}".`,
    sheetId: worksheet.position + 1,
    excelSheetId: worksheet.id,
    title: worksheet.name,
  };
};

const handleSpreadsheetUpdateSheet = async (
  context: Excel.RequestContext,
  args: unknown,
): Promise<ToolResult> => {
  const input = isRecord(args) ? args : {};
  const sheetId = asNumber(input.sheetId);
  const sheetSpec = isRecord(input.sheetSpec) ? input.sheetSpec : {};

  const worksheet = await getWorksheetBySheetId(context, sheetId);

  const title = asString(sheetSpec.title);
  if (title) {
    worksheet.name = title;
  }

  if (sheetSpec.hidden === true) {
    worksheet.visibility = Excel.SheetVisibility.hidden;
  }
  if (sheetSpec.hidden === false) {
    worksheet.visibility = Excel.SheetVisibility.visible;
  }

  const frozenRows = asNumber(sheetSpec.frozenRowCount);
  const frozenColumns = asNumber(sheetSpec.frozenColumnCount);
  if (frozenRows && frozenRows > 0) {
    worksheet.freezePanes.freezeRows(frozenRows);
  }
  if (frozenColumns && frozenColumns > 0) {
    worksheet.freezePanes.freezeColumns(frozenColumns);
  }

  const tabColor = normalizeColor(sheetSpec.tabColor);
  if (tabColor) {
    worksheet.tabColor = tabColor;
  }

  worksheet.load(["name", "position", "id"]);
  await context.sync();

  return {
    success: true,
    message: `Updated sheet "${worksheet.name}".`,
    sheetId: worksheet.position + 1,
    excelSheetId: worksheet.id,
  };
};

const handleSpreadsheetFormatRange = async (
  context: Excel.RequestContext,
  args: unknown,
): Promise<ToolResult> => {
  const input = isRecord(args) ? args : {};
  const rangeAddress = asString(input.range);
  const sheetId = asNumber(input.sheetId);
  if (!rangeAddress) {
    return { success: false, error: "range is required." };
  }

  const worksheet = await getWorksheetBySheetId(context, sheetId);
  const range = worksheet.getRange(rangeAddress);
  const style = parseRangeStyleCells(input.cells);

  if (!style) {
    return {
      success: false,
      error: "cells with cellStyles are required for spreadsheet_formatRange.",
    };
  }

  const backgroundColor = normalizeColor(style.backgroundColor);
  if (backgroundColor) {
    range.format.fill.color = backgroundColor;
  }

  const textFormat = isRecord(style.textFormat) ? style.textFormat : {};
  const fontColor = normalizeColor(textFormat.color);
  if (fontColor) {
    range.format.font.color = fontColor;
  }
  const fontSize = asNumber(textFormat.fontSize);
  if (fontSize && fontSize > 0) {
    range.format.font.size = fontSize;
  }
  if (typeof textFormat.bold === "boolean") {
    range.format.font.bold = textFormat.bold;
  }
  if (typeof textFormat.italic === "boolean") {
    range.format.font.italic = textFormat.italic;
  }
  if (typeof textFormat.underline === "boolean") {
    range.format.font.underline = textFormat.underline
      ? Excel.RangeUnderlineStyle.single
      : Excel.RangeUnderlineStyle.none;
  }

  const horizontalAlignment = asString(style.horizontalAlignment);
  if (
    horizontalAlignment === "left" ||
    horizontalAlignment === "center" ||
    horizontalAlignment === "right"
  ) {
    range.format.horizontalAlignment =
      horizontalAlignment === "left"
        ? "Left"
        : horizontalAlignment === "center"
          ? "Center"
          : "Right";
  }

  const verticalAlignment = asString(style.verticalAlignment);
  if (
    verticalAlignment === "top" ||
    verticalAlignment === "middle" ||
    verticalAlignment === "bottom"
  ) {
    range.format.verticalAlignment =
      verticalAlignment === "top"
        ? "Top"
        : verticalAlignment === "middle"
          ? "Center"
          : "Bottom";
  }

  await context.sync();

  return {
    success: true,
    message: `Formatted range ${rangeAddress}.`,
    range: rangeAddress,
  };
};

const EXECUTORS: Record<
  string,
  (context: Excel.RequestContext, args: unknown) => Promise<ToolResult>
> = {
  spreadsheet_changeBatch: handleSpreadsheetChangeBatch,
  spreadsheet_queryRange: handleSpreadsheetQueryRange,
  spreadsheet_readDocument: handleSpreadsheetReadDocument,
  spreadsheet_createSheet: handleSpreadsheetCreateSheet,
  spreadsheet_updateSheet: handleSpreadsheetUpdateSheet,
  spreadsheet_formatRange: handleSpreadsheetFormatRange,
};

export const executeExcelToolCall = async (
  context: Excel.RequestContext,
  call: ExcelToolCall,
) => {
  const executor = EXECUTORS[call.toolName];
  if (!executor) {
    return {
      success: false,
      error: `Tool "${call.toolName}" is not implemented in the Excel add-in yet.`,
      unsupportedTool: true,
    };
  }

  try {
    return await executor(context, call.args);
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
};
