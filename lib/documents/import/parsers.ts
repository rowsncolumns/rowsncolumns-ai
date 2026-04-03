import * as XLSX from "xlsx";
import * as toolkitServer from "@rowsncolumns/toolkit/server";
import type { CellData, CellFormat } from "@rowsncolumns/common-types";
import {
  createCellKeyV3,
  type CellDataV3,
} from "@rowsncolumns/sharedb/helpers";
import { SheetCell } from "@rowsncolumns/spreadsheet-state/server";
import { getCellXfsKey } from "@rowsncolumns/utils";

export const SUPPORTED_IMPORT_EXTENSIONS = new Set([
  "xlsx",
  "xls",
  "ods",
  "csv",
]);

export type ImportDocumentSnapshot = {
  sheetData: Record<string, CellDataV3<CellData>>;
  sheets: Array<{ sheetId: number; title: string }>;
  tables: unknown[];
  charts: unknown[];
  embeds: unknown[];
  namedRanges: unknown[];
  protectedRanges: unknown[];
  conditionalFormats: unknown[];
  dataValidations: unknown[];
  pivotTables: unknown[];
  slicers: unknown[];
  citations: unknown[];
  cellXfs: Record<string, unknown>;
  sharedStrings: Record<string, string>;
  iterativeCalculation: { enabled: boolean } & Record<string, unknown>;
  recalcCells: unknown[];
};

type WorkbookParser = {
  load: (buffer: ArrayBuffer | File, fileName?: string) => Promise<void>;
  getSheets: (
    minRowCount?: number,
    minColumnCount?: number,
  ) => Promise<[Array<{ sheetId: number; title?: string }>, unknown[]]>;
  processSheetData: (
    chunkSize?: number,
    enableCellXfsRegistry?: boolean,
    enableSharedStrings?: boolean,
  ) => AsyncIterable<{
    sheetId: number;
    chunkIndex: number;
    rows: Array<{ values?: Array<CellData | null | undefined> }>;
    rowIndices: number[];
  }>;
  getCharts: () => Promise<unknown[]>;
  getDrawings: () => Promise<unknown[]>;
  getConditionalFormatting: () => Promise<unknown[]>;
  getDataValidations: () => Promise<unknown[]>;
  getNamedRanges: () => unknown[];
  getSlicers: () => Promise<unknown[]>;
  getCellXfs: () => Map<string, unknown> | Record<string, unknown>;
  getSharedStrings: () => string[];
  getIterativeCalculationOptions: () => Record<string, unknown> | undefined;
  dispose: () => void;
};

type WorkbookConstructor = new () => WorkbookParser;

type ToolkitServerModule = {
  WorkBook?: WorkbookConstructor;
  readExcelFile?: (file: File | ArrayBuffer) => Promise<ArrayBuffer>;
  default?: {
    WorkBook?: WorkbookConstructor;
    readExcelFile?: (file: File | ArrayBuffer) => Promise<ArrayBuffer>;
  };
};

const toolkitModule = toolkitServer as unknown as ToolkitServerModule;

const WorkbookCtor = toolkitModule.WorkBook ?? toolkitModule.default?.WorkBook;
const readToolkitExcelFile =
  toolkitModule.readExcelFile ?? toolkitModule.default?.readExcelFile;

const bufferToArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

const normalizeSheetTitle = (title: string, index: number): string => {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return `Sheet${index + 1}`;
  }
  return normalized.slice(0, 100);
};

const createBaseSnapshot = (): ImportDocumentSnapshot => ({
  sheetData: {},
  sheets: [{ sheetId: 1, title: "Sheet1" }],
  tables: [],
  charts: [],
  embeds: [],
  namedRanges: [],
  protectedRanges: [],
  conditionalFormats: [],
  dataValidations: [],
  pivotTables: [],
  slicers: [],
  citations: [],
  cellXfs: {},
  sharedStrings: {},
  iterativeCalculation: { enabled: false },
  recalcCells: [],
});

const normalizeCellXfs = (
  cellXfs: Map<string, unknown> | Record<string, unknown>,
): Record<string, unknown> => {
  if (cellXfs instanceof Map) {
    return Object.fromEntries(cellXfs);
  }
  return cellXfs;
};

const buildSharedStringsMap = (
  sharedStrings: string[],
): Record<string, string> =>
  Object.fromEntries(
    sharedStrings.map((value, index) => [String(index), value]),
  );

const buildSheetDataV3FromChunks = async (
  workbook: WorkbookParser,
  pageSize: number,
): Promise<Record<string, CellDataV3<CellData>>> => {
  const sheetData: Record<string, CellDataV3<CellData>> = {};

  for await (const response of workbook.processSheetData(
    pageSize,
    true,
    true,
  )) {
    const { sheetId, rowIndices, rows } = response;

    for (let i = 0; i < rowIndices.length; i++) {
      const rowIndex = rowIndices[i];
      const row = rows[i];
      if (!row || rowIndex === undefined) {
        continue;
      }

      const values = row.values ?? [];
      for (let columnIndex = 0; columnIndex < values.length; columnIndex++) {
        const cell = values[columnIndex];
        if (!cell) {
          continue;
        }

        const key = createCellKeyV3(sheetId, rowIndex, columnIndex);
        sheetData[key] = {
          value: cell,
          sId: sheetId,
          r: rowIndex,
          c: columnIndex,
        };
      }
    }
  }

  return sheetData;
};

const parseToolkitWorkbookToSnapshot = async (
  buffer: Buffer,
  filename: string,
): Promise<ImportDocumentSnapshot> => {
  if (!WorkbookCtor) {
    throw new Error("Toolkit WorkBook export is unavailable.");
  }
  if (!readToolkitExcelFile) {
    throw new Error("Toolkit readExcelFile export is unavailable.");
  }

  const workbook = new WorkbookCtor();

  try {
    const excelBuffer = await readToolkitExcelFile(bufferToArrayBuffer(buffer));
    await workbook.load(excelBuffer, filename);

    const pageSize = 100;
    const [rawSheets, rawTables] = await workbook.getSheets(1000, 100);

    const sheets = rawSheets.map((sheet, index) => ({
      sheetId: sheet.sheetId,
      title: normalizeSheetTitle(sheet.title ?? `Sheet${index + 1}`, index),
    }));

    const sheetData = await buildSheetDataV3FromChunks(workbook, pageSize);
    const cellXfs = normalizeCellXfs(workbook.getCellXfs());
    const sharedStrings = buildSharedStringsMap(workbook.getSharedStrings());

    const iterativeOptions = workbook.getIterativeCalculationOptions();
    const iterativeCalculation = {
      enabled: false,
      ...(iterativeOptions ?? {}),
    };

    return {
      ...createBaseSnapshot(),
      sheetData,
      sheets: sheets.length > 0 ? sheets : [{ sheetId: 1, title: "Sheet1" }],
      tables: rawTables,
      charts: await workbook.getCharts(),
      embeds: await workbook.getDrawings(),
      namedRanges: workbook.getNamedRanges(),
      conditionalFormats: await workbook.getConditionalFormatting(),
      dataValidations: await workbook.getDataValidations(),
      slicers: await workbook.getSlicers(),
      cellXfs,
      sharedStrings,
      iterativeCalculation,
    };
  } finally {
    workbook.dispose();
  }
};

export type SharedStringState = {
  values: string[];
  valueToIndex: Map<string, number>;
};

export const createSharedStringState = (): SharedStringState => ({
  values: [],
  valueToIndex: new Map(),
});

const isStyleReference = (value: any): value is { sid: string } =>
  !!value && typeof value === "object" && "sid" in value;

export const applyCellXfsRegistry = (
  cellData: CellData,
  cellXfs: Map<string, CellFormat>,
) => {
  let nextCellData = cellData;
  const ef = cellData.ef;
  const uf = cellData.uf;

  if (ef && !isStyleReference(ef)) {
    const efKey = getCellXfsKey(ef as CellFormat);
    if (!cellXfs.has(efKey)) {
      cellXfs.set(efKey, ef as CellFormat);
    }
    nextCellData = { ...nextCellData, ef: { sid: efKey } };
  }

  if (uf && !isStyleReference(uf)) {
    const ufKey = getCellXfsKey(uf as CellFormat);
    if (!cellXfs.has(ufKey)) {
      cellXfs.set(ufKey, uf as CellFormat);
    }
    nextCellData = { ...nextCellData, uf: { sid: ufKey } };
  }

  return nextCellData;
};

const parseCsvToSnapshot = async (
  buffer: Buffer,
): Promise<ImportDocumentSnapshot> => {
  const sourceBuffer = readToolkitExcelFile
    ? await readToolkitExcelFile(bufferToArrayBuffer(buffer))
    : bufferToArrayBuffer(buffer);

  const workbook = XLSX.read(sourceBuffer, {
    type: "array",
    raw: true,
    codepage: 65001,
  });

  const snapshot = createBaseSnapshot();
  const firstSheetName = workbook.SheetNames[0] ?? "Sheet1";
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = worksheet
    ? (XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
      }) as Array<Array<string | number | boolean | null | undefined>>)
    : [];

  let totalColumns = 0;
  for (const row of rows) {
    totalColumns = Math.max(totalColumns, row?.length ?? 0);
  }
  const sheetId = 1;
  snapshot.sheets = [
    {
      sheetId,
      title: normalizeSheetTitle(firstSheetName, 0),
    },
  ];

  const sharedStrings = createSharedStringState();
  const cellXfs = new Map<string, any>();
  let lastSharedStringsLength = 0;
  let lastCellXfsSize = 0;

  const pageSize = 100;
  const startRowIndex = 1;
  const startColumnIndex = 1;

  for (let offset = 0; offset < rows.length; offset += pageSize) {
    const chunk = rows.slice(offset, offset + pageSize);

    for (let i = 0; i < chunk.length; i++) {
      const rowIndex = startRowIndex + offset + i;
      const rowValues = chunk[i];
      if (!rowValues) {
        continue;
      }

      const maxColumnsForRow = Math.max(rowValues.length, totalColumns);
      for (let j = 0; j < maxColumnsForRow; j++) {
        const columnIndex = startColumnIndex + j;
        const cellValue = rowValues[j];
        const sheetCell = new SheetCell(
          sheetId,
          { rowIndex, columnIndex },
          undefined,
        );
        sheetCell.setUserEnteredValue(cellValue);
        const cellData = sheetCell.getCellData();
        if (!cellData) {
          continue;
        }

        let nextCellData = cellData as any;
        if (nextCellData && (nextCellData.ef || nextCellData.uf)) {
          nextCellData = applyCellXfsRegistry(nextCellData, cellXfs);
        }

        const key = createCellKeyV3(1, rowIndex, columnIndex);
        snapshot.sheetData[key] = {
          value: cellData,
          sId: 1,
          r: rowIndex,
          c: columnIndex,
        };
      }
    }
  }

  let sharedStringsChunk: string[] | undefined;
  let sharedStringsStartIndex: number | undefined;
  let cellXfsChunk: Array<[string, any]> | undefined;
  if (sharedStrings.values.length > lastSharedStringsLength) {
    sharedStringsStartIndex = lastSharedStringsLength;
    sharedStringsChunk = sharedStrings.values.slice(lastSharedStringsLength);
    lastSharedStringsLength = sharedStrings.values.length;
  }
  if (cellXfs.size > lastCellXfsSize) {
    cellXfsChunk = Array.from(cellXfs.entries()).slice(lastCellXfsSize);
    lastCellXfsSize = cellXfs.size;
  }

  return snapshot;
};

export const parseSpreadsheetBuffer = async (
  buffer: Buffer,
  filename: string,
  extension: string,
): Promise<ImportDocumentSnapshot> => {
  if (extension === "csv") {
    return await parseCsvToSnapshot(buffer);
  }

  if (extension === "xlsx" || extension === "xls" || extension === "ods") {
    return parseToolkitWorkbookToSnapshot(buffer, filename);
  }

  throw new Error(`Unsupported import extension: ${extension}`);
};
