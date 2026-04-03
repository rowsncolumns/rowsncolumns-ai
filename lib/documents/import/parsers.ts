import * as XLSX from "xlsx";
import {
  WorkBook,
  buildCellData,
  readExcelFile,
} from "@rowsncolumns/toolkit/server";
import type {
  CellData,
  CellFormat,
  Citation,
  DataValidationRule,
  PivotTable,
} from "@rowsncolumns/common-types";
import {
  createCellKeyV3,
  type CellDataV3,
} from "@rowsncolumns/sharedb/helpers";
import { getCellXfsKey } from "@rowsncolumns/utils";
import {
  ConditionalFormatRule,
  EmbeddedChart,
  EmbeddedObject,
  NamedRange,
  ProtectedRange,
  Slicer,
  TableView,
} from "@rowsncolumns/spreadsheet";

export const SUPPORTED_IMPORT_EXTENSIONS = new Set([
  "xlsx",
  "xls",
  "ods",
  "csv",
]);

export type ImportDocumentSnapshot = {
  sheetData: Record<string, CellDataV3<CellData>>;
  sheets: Array<{ sheetId: number; title: string }>;
  tables: TableView[];
  charts: EmbeddedChart[];
  embeds: EmbeddedObject[];
  namedRanges: NamedRange[];
  protectedRanges: ProtectedRange[];
  conditionalFormats: ConditionalFormatRule[];
  dataValidations: DataValidationRule[];
  pivotTables: PivotTable[];
  slicers: Slicer[];
  citations: Citation[];
  cellXfs: Record<string, CellFormat>;
  sharedStrings: Record<string, string>;
  iterativeCalculation: { enabled: boolean } & Record<string, unknown>;
  recalcCells: unknown[];
};

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
  cellXfs:
    | Map<string, unknown>
    | Record<string, unknown>
    | Map<string | number, any>,
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
  workbook: InstanceType<typeof WorkBook>,
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
  const workbook = new WorkBook();

  try {
    const excelBuffer = await readExcelFile(bufferToArrayBuffer(buffer));
    await workbook.load(excelBuffer, filename);

    const pageSize = 100;
    const [sheets, tables] = await workbook.getSheets(1000, 100);

    const sheetData = await buildSheetDataV3FromChunks(workbook, pageSize);
    const cellXfs = normalizeCellXfs(workbook.getCellXfs()) as Record<
      string,
      CellFormat
    >;
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
      tables,
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
  const sourceBuffer = await readExcelFile(bufferToArrayBuffer(buffer));

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
        if (!cellValue) {
          continue;
        }
        const cellData = buildCellData(
          cellValue,
          undefined,
          true,
          true,
          sharedStrings,
        ) as CellData;

        let nextCellData = cellData;
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

  // set cell Xfs
  snapshot.cellXfs = Object.fromEntries(cellXfs);

  // Set shared string
  snapshot.sharedStrings = Object.fromEntries(
    new Map(sharedStrings.values.map((value, index) => [String(index), value])),
  );
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
