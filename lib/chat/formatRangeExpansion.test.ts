import assert from "node:assert/strict";
import test from "node:test";
import { expandFormatCellsToRange } from "./formatRangeExpansion";

const makeCell = (id: string) => ({
  cellStyles: {
    horizontalAlignment: id,
  },
});

test("expands 1x1 input to full range", () => {
  const single = [[makeCell("single")]];
  const result = expandFormatCellsToRange(single, 12, 6, "B2:G13");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.expansionMode, "single_cell");
  assert.equal(result.expandedCells.length, 12);
  assert.equal(result.expandedCells[0]?.length, 6);
  assert.equal(
    (result.expandedCells[11]?.[5]?.cellStyles as { horizontalAlignment?: string })
      ?.horizontalAlignment,
    "single",
  );
});

test("expands 1xC input by repeating row down", () => {
  const row = [[makeCell("c1"), makeCell("c2"), makeCell("c3")]];
  const result = expandFormatCellsToRange(row, 4, 3, "B2:D5");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.expansionMode, "repeat_row");
  assert.equal(result.expandedCells.length, 4);
  assert.equal(result.expandedCells[0]?.length, 3);
  assert.equal(
    (result.expandedCells[3]?.[1]?.cellStyles as { horizontalAlignment?: string })
      ?.horizontalAlignment,
    "c2",
  );
});

test("expands Rx1 input by repeating column across", () => {
  const col = [[makeCell("r1")], [makeCell("r2")], [makeCell("r3")]];
  const result = expandFormatCellsToRange(col, 3, 5, "A1:E3");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.expansionMode, "repeat_column");
  assert.equal(result.expandedCells.length, 3);
  assert.equal(result.expandedCells[0]?.length, 5);
  assert.equal(
    (result.expandedCells[1]?.[4]?.cellStyles as { horizontalAlignment?: string })
      ?.horizontalAlignment,
    "r2",
  );
});

test("keeps exact RxC input unchanged", () => {
  const cells = [
    [makeCell("a"), makeCell("b")],
    [makeCell("c"), makeCell("d")],
  ];
  const result = expandFormatCellsToRange(cells, 2, 2, "A1:B2");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.expansionMode, "none");
  assert.deepEqual(result.expandedCells, cells);
});

test("rejects dimension mismatch", () => {
  const cells = [
    [makeCell("a"), makeCell("b"), makeCell("c")],
    [makeCell("d"), makeCell("e"), makeCell("f")],
  ];
  const result = expandFormatCellsToRange(cells, 4, 4, "A1:D4");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /Supported shapes/);
});

test("rejects ragged (non-rectangular) input", () => {
  const ragged = [[makeCell("a"), makeCell("b")], [makeCell("c")]];
  const result = expandFormatCellsToRange(ragged, 2, 2, "A1:B2");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /rectangular 2D array/);
});

test("treats empty cells as no-op", () => {
  const result = expandFormatCellsToRange([], 3, 3, "A1:C3");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.expansionMode, "none");
  assert.deepEqual(result.expandedCells, []);
});
