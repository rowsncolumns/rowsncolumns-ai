import type { ActivityDiffSummary, OperationPayload } from "./types";

const A1_CELL_REGEX = /^([A-Z]+)(\d+)$/;
const PATCH_TUPLE_CELL_PATH_LENGTH = 4;
const STRUCTURAL_PATH_LABELS: Record<string, string> = {
  sheets: "Sheets",
  tables: "Tables",
  charts: "Charts",
  conditionalFormats: "Conditional Formats",
  dataValidations: "Data Validations",
  namedRanges: "Named Ranges",
  protectedRanges: "Protected Ranges",
  pivotTables: "Pivot Tables",
  slicers: "Slicers",
  citations: "Citations",
  iterativeCalculation: "Iterative Calculation",
  iterativeCalculationOptions: "Iterative Calculation",
};

function columnNumberToA1(columnNumber: number): string {
  let n = columnNumber;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function columnA1ToNumber(column: string): number {
  let result = 0;
  for (const char of column) {
    result = result * 26 + (char.charCodeAt(0) - 64);
  }
  return result;
}

function parseSheetCellKey(
  value: unknown,
): { sheetId: string; cellA1: string } | null {
  if (typeof value !== "string") {
    return null;
  }
  const [sheetId, cellA1] = value.split("!");
  if (!sheetId || !cellA1) {
    return null;
  }
  const normalizedCell = cellA1.toUpperCase();
  if (!A1_CELL_REGEX.test(normalizedCell)) {
    return null;
  }
  return { sheetId, cellA1: normalizedCell };
}

function parsePatchTupleCellPath(
  path: unknown,
): { sheetId: string; cellA1: string } | null {
  if (!Array.isArray(path) || path.length < PATCH_TUPLE_CELL_PATH_LENGTH) {
    return null;
  }
  const [sheetIdRaw, rowRaw, valueKey, colRaw] = path;
  if (valueKey !== "values") {
    return null;
  }
  const sheetId = String(sheetIdRaw);
  const row = typeof rowRaw === "number" ? rowRaw : Number(rowRaw);
  const colIndex = typeof colRaw === "number" ? colRaw : Number(colRaw);
  if (
    !Number.isFinite(row) ||
    !Number.isFinite(colIndex) ||
    row <= 0 ||
    colIndex < 0
  ) {
    return null;
  }
  const cellA1 = `${columnNumberToA1(colIndex + 1)}${Math.floor(row)}`;
  return { sheetId, cellA1 };
}

function getSheetRange(cells: string[]): string {
  if (cells.length === 0) {
    return "";
  }
  if (cells.length === 1) {
    return cells[0]!;
  }

  let minRow = Number.MAX_SAFE_INTEGER;
  let maxRow = 0;
  let minCol = Number.MAX_SAFE_INTEGER;
  let maxCol = 0;

  for (const cell of cells) {
    const match = cell.match(A1_CELL_REGEX);
    if (!match) {
      continue;
    }
    const col = columnA1ToNumber(match[1]!);
    const row = Number(match[2]!);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }

  if (
    !Number.isFinite(minCol) ||
    !Number.isFinite(minRow) ||
    maxCol === 0 ||
    maxRow === 0
  ) {
    return cells[0]!;
  }

  const start = `${columnNumberToA1(minCol)}${minRow}`;
  const end = `${columnNumberToA1(maxCol)}${maxRow}`;
  return start === end ? start : `${start}:${end}`;
}

export function buildDiffSummary(
  operationKind: string,
  operationPayload: OperationPayload,
): ActivityDiffSummary | null {
  const sheetCells = new Map<string, Set<string>>();
  const structuralChanges = new Set<string>();
  let totalOps = 0;

  const addCell = (sheetId: string, cellA1: string) => {
    const existing = sheetCells.get(sheetId) ?? new Set<string>();
    existing.add(cellA1.toUpperCase());
    sheetCells.set(sheetId, existing);
  };

  const addStructuralChange = (pathKey: string) => {
    const label = STRUCTURAL_PATH_LABELS[pathKey];
    if (label) {
      structuralChanges.add(label);
    }
  };

  if (operationKind === "raw_op" && Array.isArray(operationPayload.forward?.data)) {
    for (const opItem of operationPayload.forward.data) {
      totalOps += 1;
      const path = (opItem as { p?: unknown }).p;
      if (!Array.isArray(path) || path.length === 0) {
        continue;
      }
      const pathKey = path[0];
      if (pathKey === "sheetData") {
        const parsed = parseSheetCellKey(path[1]);
        if (parsed) {
          addCell(parsed.sheetId, parsed.cellA1);
        }
        continue;
      }
      if (
        pathKey === "recalcCells" ||
        pathKey === "sharedStrings" ||
        pathKey === "cellXfs"
      ) {
        continue;
      }
      if (typeof pathKey === "string") {
        addStructuralChange(pathKey);
      }
    }
  }

  if (
    operationKind === "patch_tuples" &&
    Array.isArray(operationPayload.forward?.data)
  ) {
    for (const tuple of operationPayload.forward.data) {
      if (!Array.isArray(tuple) || tuple.length === 0) {
        continue;
      }
      const patchRoot = tuple[0] as Record<string, unknown> | undefined;
      if (!patchRoot || typeof patchRoot !== "object") {
        continue;
      }

      const sheetData = patchRoot.sheetData as
        | { patches?: Array<{ path?: unknown }> }
        | undefined;
      if (sheetData?.patches) {
        totalOps += sheetData.patches.length;
        for (const patch of sheetData.patches) {
          const parsed = parsePatchTupleCellPath(patch.path);
          if (parsed) {
            addCell(parsed.sheetId, parsed.cellA1);
          }
        }
      }

      for (const pathKey of Object.keys(STRUCTURAL_PATH_LABELS)) {
        const patchSection = patchRoot[pathKey] as { patches?: unknown[] } | undefined;
        if (patchSection?.patches && patchSection.patches.length > 0) {
          totalOps += patchSection.patches.length;
          addStructuralChange(pathKey);
        }
      }
    }
  }

  const sheets = Array.from(sheetCells.entries())
    .map(([sheetId, cellSet]) => {
      const cells = Array.from(cellSet).sort((a, b) => {
        const aMatch = a.match(A1_CELL_REGEX);
        const bMatch = b.match(A1_CELL_REGEX);
        if (!aMatch || !bMatch) {
          return a.localeCompare(b);
        }
        const rowDiff = Number(aMatch[2]) - Number(bMatch[2]);
        if (rowDiff !== 0) {
          return rowDiff;
        }
        return columnA1ToNumber(aMatch[1]) - columnA1ToNumber(bMatch[1]);
      });
      return {
        sheetId,
        cellCount: cells.length,
        a1Range: getSheetRange(cells),
        sampleCells: cells.slice(0, 5),
      };
    })
    .sort((a, b) => {
      const aNum = Number(a.sheetId);
      const bNum = Number(b.sheetId);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
        return aNum - bNum;
      }
      return a.sheetId.localeCompare(b.sheetId);
    });

  const changedCellCount = sheets.reduce((total, sheet) => total + sheet.cellCount, 0);

  if (totalOps === 0 && changedCellCount === 0 && structuralChanges.size === 0) {
    return null;
  }

  return {
    totalOps,
    changedCellCount,
    sheets,
    structuralChanges: Array.from(structuralChanges).sort(),
  };
}

export function isOperationInvertible(operationPayload: OperationPayload): boolean {
  return (
    Array.isArray(operationPayload.inverse?.data) &&
    operationPayload.inverse.data.length > 0
  );
}

