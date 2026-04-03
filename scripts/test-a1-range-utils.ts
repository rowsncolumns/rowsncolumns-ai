import assert from "node:assert/strict";

import { compressA1CellsToRanges } from "../lib/chat/a1-range-utils";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  {
    name: "compresses contiguous vertical cells into one range",
    run: () => {
      const result = compressA1CellsToRanges([
        "B4",
        "B5",
        "B6",
        "B7",
        "B8",
        "B9",
        "B6", // duplicate
      ]);
      assert.deepEqual(result, ["B4:B9"]);
    },
  },
  {
    name: "compresses contiguous horizontal cells into one range",
    run: () => {
      const result = compressA1CellsToRanges(["A1", "B1", "C1"]);
      assert.deepEqual(result, ["A1:C1"]);
    },
  },
  {
    name: "compresses full rectangles",
    run: () => {
      const result = compressA1CellsToRanges(["A1", "B1", "A2", "B2"]);
      assert.deepEqual(result, ["A1:B2"]);
    },
  },
  {
    name: "splits non-contiguous sets into multiple ranges",
    run: () => {
      const result = compressA1CellsToRanges(["B4", "B5", "B7", "B8", "B9"]);
      assert.deepEqual(result, ["B4:B5", "B7:B9"]);
    },
  },
  {
    name: "handles L-shaped blocks without including missing cells",
    run: () => {
      const result = compressA1CellsToRanges(["A1", "B1", "A2"]);
      assert.deepEqual(result, ["A1:B1", "A2"]);
    },
  },
  {
    name: "preserves unsupported values as passthrough entries",
    run: () => {
      const result = compressA1CellsToRanges(["A1", "A2", "A:A"]);
      assert.deepEqual(result, ["A1:A2", "A:A"]);
    },
  },
];

const run = async () => {
  let passed = 0;
  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
      console.log(`✓ ${test.name}`);
    } catch (error) {
      console.error(`✗ ${test.name}`);
      throw error;
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
};

void run();

