const A1_CELL_REGEX = /^([A-Z]+)(\d+)$/;

type ParsedCell = {
  row: number;
  col: number;
};

const keyForCell = (row: number, col: number) => `${row}:${col}`;

const columnA1ToNumber = (column: string): number => {
  let result = 0;
  for (const char of column) {
    result = result * 26 + (char.charCodeAt(0) - 64);
  }
  return result;
};

const columnNumberToA1 = (columnNumber: number): string => {
  let n = columnNumber;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
};

const formatRange = (
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
) => {
  const start = `${columnNumberToA1(startCol)}${startRow}`;
  const end = `${columnNumberToA1(endCol)}${endRow}`;
  return start === end ? start : `${start}:${end}`;
};

const parseA1Cell = (value: string): ParsedCell | null => {
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(A1_CELL_REGEX);
  if (!match) {
    return null;
  }

  const col = columnA1ToNumber(match[1]!);
  const row = Number(match[2]!);
  if (!Number.isFinite(row) || row <= 0 || col <= 0) {
    return null;
  }

  return { row, col };
};

/**
 * Compresses a list of A1 cell addresses into exact A1 ranges that cover all cells.
 * Non-contiguous sets may return multiple ranges.
 */
export const compressA1CellsToRanges = (cells: string[]): string[] => {
  if (!Array.isArray(cells) || cells.length === 0) {
    return [];
  }

  const parsedByKey = new Map<string, ParsedCell>();
  const passthroughValues = new Set<string>();

  for (const raw of cells) {
    if (typeof raw !== "string") {
      continue;
    }

    const value = raw.trim();
    if (!value) {
      continue;
    }

    const parsed = parseA1Cell(value);
    if (!parsed) {
      passthroughValues.add(value);
      continue;
    }

    parsedByKey.set(keyForCell(parsed.row, parsed.col), parsed);
  }

  if (parsedByKey.size === 0) {
    return Array.from(passthroughValues).sort((a, b) => a.localeCompare(b));
  }

  const sortedCells = Array.from(parsedByKey.values()).sort((a, b) => {
    const rowDiff = a.row - b.row;
    if (rowDiff !== 0) return rowDiff;
    return a.col - b.col;
  });

  const occupied = new Set(parsedByKey.keys());
  const used = new Set<string>();
  const ranges: string[] = [];

  for (const cell of sortedCells) {
    const startKey = keyForCell(cell.row, cell.col);
    if (used.has(startKey)) {
      continue;
    }

    let endCol = cell.col;
    while (true) {
      const nextCol = endCol + 1;
      const nextKey = keyForCell(cell.row, nextCol);
      if (!occupied.has(nextKey) || used.has(nextKey)) {
        break;
      }
      endCol = nextCol;
    }

    let endRow = cell.row;
    while (true) {
      const nextRow = endRow + 1;
      let canExtend = true;
      for (let col = cell.col; col <= endCol; col++) {
        const key = keyForCell(nextRow, col);
        if (!occupied.has(key) || used.has(key)) {
          canExtend = false;
          break;
        }
      }
      if (!canExtend) {
        break;
      }
      endRow = nextRow;
    }

    for (let row = cell.row; row <= endRow; row++) {
      for (let col = cell.col; col <= endCol; col++) {
        used.add(keyForCell(row, col));
      }
    }

    ranges.push(formatRange(cell.row, cell.col, endRow, endCol));
  }

  const sortedPassthrough = Array.from(passthroughValues).sort((a, b) =>
    a.localeCompare(b),
  );

  return [...ranges, ...sortedPassthrough];
};

