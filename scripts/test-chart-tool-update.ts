import assert from "node:assert/strict";

import type { EmbeddedChart } from "@rowsncolumns/spreadsheet";
import type { GridRange } from "@rowsncolumns/common-types";

import {
  buildChartDomainsUpdate,
  buildChartSeriesUpdate,
  resolveChartUpdateDefaultSheetIds,
} from "../lib/chat/tools";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const rangeA: GridRange = {
  startRowIndex: 2,
  endRowIndex: 8,
  startColumnIndex: 1,
  endColumnIndex: 1,
};

const rangeB: GridRange = {
  startRowIndex: 2,
  endRowIndex: 8,
  startColumnIndex: 2,
  endColumnIndex: 2,
};

const tests: TestCase[] = [
  {
    name: "resolveChartUpdateDefaultSheetIds prefers domains[].sources[].sheetId",
    run: () => {
      const chart = {
        chartId: "c1",
        position: { sheetId: 443899155, overlayPosition: { anchorCell: { rowIndex: 1, columnIndex: 1 } } },
        spec: {
          chartType: "column",
          // Regression context: legacy shape may exist in stale docs.
          domain: { sheetId: 99999999 },
          domains: [{ sources: [{ ...rangeA, sheetId: 230035900 }] }],
          series: [],
        },
      } as unknown as EmbeddedChart;

      const resolved = resolveChartUpdateDefaultSheetIds(chart, 1);
      assert.equal(resolved.domainSheetId, 230035900);
      assert.equal(resolved.seriesSheetId, 230035900);
    },
  },
  {
    name: "resolveChartUpdateDefaultSheetIds prefers series[].sources[].sheetId for series",
    run: () => {
      const chart = {
        chartId: "c2",
        position: { sheetId: 443899155, overlayPosition: { anchorCell: { rowIndex: 1, columnIndex: 1 } } },
        spec: {
          chartType: "column",
          domains: [{ sources: [{ ...rangeA, sheetId: 230035900 }] }],
          series: [{ sources: [{ ...rangeB, sheetId: 123456789 }] }],
        },
      } as unknown as EmbeddedChart;

      const resolved = resolveChartUpdateDefaultSheetIds(chart, 1);
      assert.equal(resolved.domainSheetId, 230035900);
      assert.equal(resolved.seriesSheetId, 123456789);
    },
  },
  {
    name: "resolveChartUpdateDefaultSheetIds falls back to chart position then input sheet",
    run: () => {
      const chartWithPosition = {
        chartId: "c3",
        position: { sheetId: 42, overlayPosition: { anchorCell: { rowIndex: 1, columnIndex: 1 } } },
        spec: {
          chartType: "column",
          domains: [],
          series: [],
        },
      } as unknown as EmbeddedChart;

      const withPosition = resolveChartUpdateDefaultSheetIds(chartWithPosition, 77);
      assert.equal(withPosition.domainSheetId, 42);
      assert.equal(withPosition.seriesSheetId, 42);

      const chartWithoutPosition = {
        chartId: "c4",
        position: undefined,
        spec: {
          chartType: "column",
          domains: [],
          series: [],
        },
      } as unknown as EmbeddedChart;

      const withoutPosition = resolveChartUpdateDefaultSheetIds(chartWithoutPosition, 77);
      assert.equal(withoutPosition.domainSheetId, 77);
      assert.equal(withoutPosition.seriesSheetId, 77);
    },
  },
  {
    name: "buildChartDomainsUpdate emits domains[].sources[] shape",
    run: () => {
      const result = buildChartDomainsUpdate([{ sheetId: 12, range: rangeA }]);
      assert.deepEqual(result, [
        {
          sources: [
            {
              sheetId: 12,
              ...rangeA,
            },
          ],
        },
      ]);
    },
  },
  {
    name: "buildChartSeriesUpdate emits series[].sources[] shape",
    run: () => {
      const result = buildChartSeriesUpdate([
        { sheetId: 12, range: rangeA },
        { sheetId: 34, range: rangeB },
      ]);
      assert.deepEqual(result, [
        {
          sources: [
            {
              sheetId: 12,
              ...rangeA,
            },
          ],
        },
        {
          sources: [
            {
              sheetId: 34,
              ...rangeB,
            },
          ],
        },
      ]);
    },
  },
];

const run = async () => {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
    console.log(`PASS ${test.name}`);
  }

  console.log(`\n${passed}/${tests.length} chart tool update tests passed`);
};

run().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

