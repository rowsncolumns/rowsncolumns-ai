import type { CellStyleData } from "./models";

export type FormatRangeExpansionMode =
  | "none"
  | "single_cell"
  | "repeat_row"
  | "repeat_column";

type ExpandFormatCellsResult =
  | {
      ok: true;
      expandedCells: CellStyleData[][];
      expansionMode: FormatRangeExpansionMode;
    }
  | {
      ok: false;
      error: string;
    };

export const expandFormatCellsToRange = (
  cells: CellStyleData[][],
  rangeRowCount: number,
  rangeColCount: number,
  rangeA1: string,
): ExpandFormatCellsResult => {
  const inputRowCount = cells.length;

  if (inputRowCount === 0) {
    return {
      ok: true,
      expandedCells: cells,
      expansionMode: "none",
    };
  }

  const inputColCount = cells[0]?.length ?? 0;
  const isRectangular = cells.every((row) => row.length === inputColCount);

  if (!isRectangular) {
    return {
      ok: false,
      error:
        "cells must be a rectangular 2D array (all rows must have the same number of columns)",
    };
  }

  if (inputColCount === 0) {
    return {
      ok: true,
      expandedCells: cells,
      expansionMode: "none",
    };
  }

  if (inputRowCount === rangeRowCount && inputColCount === rangeColCount) {
    return {
      ok: true,
      expandedCells: cells,
      expansionMode: "none",
    };
  }

  if (inputRowCount === 1 && inputColCount === 1) {
    const singleCellStyle = cells[0]?.[0] ?? {};

    return {
      ok: true,
      expandedCells: Array.from({ length: rangeRowCount }, () =>
        Array.from({ length: rangeColCount }, () => singleCellStyle),
      ),
      expansionMode: "single_cell",
    };
  }

  if (inputRowCount === 1 && inputColCount === rangeColCount) {
    const sourceRow = cells[0] ?? [];

    return {
      ok: true,
      expandedCells: Array.from({ length: rangeRowCount }, () => [...sourceRow]),
      expansionMode: "repeat_row",
    };
  }

  if (inputColCount === 1 && inputRowCount === rangeRowCount) {
    return {
      ok: true,
      expandedCells: cells.map((row) =>
        Array.from({ length: rangeColCount }, () => row[0] ?? {}),
      ),
      expansionMode: "repeat_column",
    };
  }

  return {
    ok: false,
    error: `cells dimensions (${inputRowCount}x${inputColCount}) do not match range ${rangeA1} dimensions (${rangeRowCount}x${rangeColCount}). Supported shapes: 1x1, 1x${rangeColCount}, ${rangeRowCount}x1, or ${rangeRowCount}x${rangeColCount}.`,
  };
};
