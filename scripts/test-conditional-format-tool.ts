import assert from "node:assert/strict";

import type { ConditionalFormatRule } from "@rowsncolumns/spreadsheet";

import {
  buildConditionalFormatCreatePayload,
  getConditionalFormatRuleType,
} from "../lib/chat/tools";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  {
    name: "buildConditionalFormatCreatePayload creates topBottomRule payload",
    run: () => {
      const payload = buildConditionalFormatCreatePayload({
        ruleType: "topBottom",
        topBottomType: "top",
        rank: 10,
        isPercent: false,
        backgroundColor: "#D9EAD3",
        bold: true,
      });

      assert.deepEqual(payload.topBottomRule, {
        type: "TOP",
        rank: 10,
        isPercent: false,
        format: {
          backgroundColor: "#D9EAD3",
          textFormat: { bold: true },
        },
      });
      assert.equal(payload.booleanRule, undefined);
      assert.equal(payload.gradientRule, undefined);
      assert.equal(payload.distinctRule, undefined);
    },
  },
  {
    name: "buildConditionalFormatCreatePayload defaults topBottom rank/isPercent",
    run: () => {
      const payload = buildConditionalFormatCreatePayload({
        ruleType: "topBottom",
        topBottomType: "bottom",
      });

      assert.deepEqual(payload.topBottomRule, {
        type: "BOTTOM",
        rank: 10,
        isPercent: false,
        format: {},
      });
    },
  },
  {
    name: "buildConditionalFormatCreatePayload creates distinctRule payload",
    run: () => {
      const payload = buildConditionalFormatCreatePayload({
        ruleType: "duplicates",
        duplicateType: "unique",
        backgroundColor: "#FFB6C1",
        textColor: "#111111",
      });

      assert.deepEqual(payload.distinctRule, {
        type: "UNIQUE",
        format: {
          backgroundColor: "#FFB6C1",
          textFormat: { color: "#111111" },
        },
      });
      assert.equal(payload.booleanRule, undefined);
      assert.equal(payload.gradientRule, undefined);
      assert.equal(payload.topBottomRule, undefined);
    },
  },
  {
    name: "buildConditionalFormatCreatePayload creates 3-color gradientRule payload",
    run: () => {
      const payload = buildConditionalFormatCreatePayload({
        ruleType: "colorScale",
        colorScaleType: "3color",
        minColor: "#FF0000",
        midColor: "#FFFF00",
        maxColor: "#00FF00",
      });

      assert.deepEqual(payload.gradientRule, {
        minpoint: { type: "MIN", color: "#FF0000" },
        midpoint: { type: "PERCENTILE", value: "50", color: "#FFFF00" },
        maxpoint: { type: "MAX", color: "#00FF00" },
      });
      assert.equal(payload.booleanRule, undefined);
      assert.equal(payload.topBottomRule, undefined);
      assert.equal(payload.distinctRule, undefined);
    },
  },
  {
    name: "buildConditionalFormatCreatePayload creates condition booleanRule payload",
    run: () => {
      const payload = buildConditionalFormatCreatePayload({
        ruleType: "condition",
        conditionType: "greaterThan",
        conditionValues: [100],
        backgroundColor: "#FFCCCC",
      });

      assert.deepEqual(payload.booleanRule, {
        condition: {
          type: "NUMBER_GREATER",
          values: [{ userEnteredValue: "100" }],
        },
        format: {
          backgroundColor: "#FFCCCC",
        },
      });
      assert.equal(payload.gradientRule, undefined);
      assert.equal(payload.topBottomRule, undefined);
      assert.equal(payload.distinctRule, undefined);
    },
  },
  {
    name: "getConditionalFormatRuleType classifies all rule shapes",
    run: () => {
      const gradientRuleType = getConditionalFormatRuleType({
        gradientRule: { minpoint: { type: "MIN", color: "#f00" } },
        topBottomRule: undefined,
        distinctRule: undefined,
      } as Pick<
        ConditionalFormatRule,
        "gradientRule" | "topBottomRule" | "distinctRule"
      >);
      assert.equal(gradientRuleType, "colorScale");

      const topBottomRuleType = getConditionalFormatRuleType({
        gradientRule: undefined,
        topBottomRule: {
          type: "TOP",
          rank: 10,
          isPercent: false,
          format: {},
        },
        distinctRule: undefined,
      } as Pick<
        ConditionalFormatRule,
        "gradientRule" | "topBottomRule" | "distinctRule"
      >);
      assert.equal(topBottomRuleType, "topBottom");

      const distinctRuleType = getConditionalFormatRuleType({
        gradientRule: undefined,
        topBottomRule: undefined,
        distinctRule: { type: "DUPLICATE", format: {} },
      } as Pick<
        ConditionalFormatRule,
        "gradientRule" | "topBottomRule" | "distinctRule"
      >);
      assert.equal(distinctRuleType, "duplicates");

      const fallbackType = getConditionalFormatRuleType({
        gradientRule: undefined,
        topBottomRule: undefined,
        distinctRule: undefined,
      } as Pick<
        ConditionalFormatRule,
        "gradientRule" | "topBottomRule" | "distinctRule"
      >);
      assert.equal(fallbackType, "condition");
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

  console.log(
    `\n${passed}/${tests.length} conditional format tool tests passed`,
  );
};

run().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
