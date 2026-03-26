import assert from "node:assert/strict";

import { z } from "zod";

import {
  SpreadsheetClearCellsSchema,
  SpreadsheetTableSchema,
  SpreadsheetChartSchema,
  SpreadsheetDataValidationSchema,
  SpreadsheetConditionalFormatSchema,
  SpreadsheetModifyRowsColsSchema,
} from "../lib/chat/models";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  // ==================== SpreadsheetClearCells Tests ====================
  {
    name: "spreadsheet_clearCells schema is valid top-level object",
    run: () => {
      const jsonSchema = z.toJSONSchema(SpreadsheetClearCellsSchema as never) as {
        type?: string;
      };
      assert.equal(jsonSchema.type, "object");
    },
  },
  {
    name: "spreadsheet_clearCells validates required fields",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        ranges: ["A1:B5"],
        clear: "values" as const,
      };
      const result = SpreadsheetClearCellsSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_clearCells rejects invalid clear type",
    run: () => {
      const invalidInput = {
        docId: "doc123",
        sheetId: 1,
        ranges: ["A1:B5"],
        clear: "invalid",
      };
      const result = SpreadsheetClearCellsSchema.safeParse(invalidInput);
      assert.equal(result.success, false);
    },
  },
  {
    name: "spreadsheet_clearCells accepts all clear types",
    run: () => {
      const clearTypes = ["values", "formatting", "all"] as const;
      for (const clear of clearTypes) {
        const input = { docId: "doc123", sheetId: 1, ranges: ["A1"], clear };
        const result = SpreadsheetClearCellsSchema.safeParse(input);
        assert.equal(result.success, true, `clear type "${clear}" should be valid`);
      }
    },
  },

  // ==================== SpreadsheetTable Tests ====================
  {
    name: "spreadsheet_table schema is valid top-level object",
    run: () => {
      const jsonSchema = z.toJSONSchema(SpreadsheetTableSchema as never) as {
        type?: string;
      };
      assert.equal(jsonSchema.type, "object");
    },
  },
  {
    name: "spreadsheet_table validates create action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "create" as const,
        range: "A1:D10",
        title: "MyTable",
      };
      const result = SpreadsheetTableSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_table validates update action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "update" as const,
        tableId: "table_123",
        theme: "dark" as const,
      };
      const result = SpreadsheetTableSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_table validates delete action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "delete" as const,
        tableId: "table_123",
      };
      const result = SpreadsheetTableSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_table rejects invalid action",
    run: () => {
      const invalidInput = {
        docId: "doc123",
        sheetId: 1,
        action: "invalid",
      };
      const result = SpreadsheetTableSchema.safeParse(invalidInput);
      assert.equal(result.success, false);
    },
  },

  // ==================== SpreadsheetChart Tests ====================
  {
    name: "spreadsheet_chart schema is valid top-level object",
    run: () => {
      const jsonSchema = z.toJSONSchema(SpreadsheetChartSchema as never) as {
        type?: string;
      };
      assert.equal(jsonSchema.type, "object");
    },
  },
  {
    name: "spreadsheet_chart validates create action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "create" as const,
        domain: "A2:A10",
        series: ["B2:B10", "C2:C10"],
        chartType: "column" as const,
      };
      const result = SpreadsheetChartSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_chart validates update action",
    run: () => {
      const validInput = {
        docId: "doc123",
        action: "update" as const,
        chartId: "chart_123",
        title: "Updated Title",
      };
      const result = SpreadsheetChartSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_chart validates delete action",
    run: () => {
      const validInput = {
        docId: "doc123",
        action: "delete" as const,
        chartId: "chart_123",
      };
      const result = SpreadsheetChartSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_chart accepts all chart types",
    run: () => {
      const chartTypes = ["bar", "column", "line", "pie", "area", "scatter"] as const;
      for (const chartType of chartTypes) {
        const input = {
          docId: "doc123",
          sheetId: 1,
          action: "create" as const,
          domain: "A1:A10",
          series: ["B1:B10"],
          chartType,
        };
        const result = SpreadsheetChartSchema.safeParse(input);
        assert.equal(result.success, true, `chartType "${chartType}" should be valid`);
      }
    },
  },
  {
    name: "spreadsheet_chart validates create with all optional parameters",
    run: () => {
      // Regression test: ensures all create parameters are accepted
      // Bug fix: chart creation was using { bounds: range } instead of { range: range }
      const fullInput = {
        docId: "doc123",
        sheetId: 1,
        action: "create" as const,
        domain: "B2:B11",
        series: ["F2:F11"],
        chartType: "column" as const,
        title: "Sales by Product",
        subtitle: "Q1 2024",
        anchorCell: "H2",
        width: 500,
        height: 350,
        xAxisTitle: "Product",
        yAxisTitle: "Total ($)",
        stackedType: "unstacked" as const,
      };
      const result = SpreadsheetChartSchema.safeParse(fullInput);
      assert.equal(result.success, true, "full chart create input should be valid");
    },
  },

  // ==================== SpreadsheetDataValidation Tests ====================
  {
    name: "spreadsheet_dataValidation schema is valid top-level object",
    run: () => {
      const jsonSchema = z.toJSONSchema(SpreadsheetDataValidationSchema as never) as {
        type?: string;
      };
      assert.equal(jsonSchema.type, "object");
    },
  },
  {
    name: "spreadsheet_dataValidation validates create list action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "create" as const,
        range: "B2:B50",
        validationType: "list" as const,
        listValues: ["Yes", "No", "Maybe"],
      };
      const result = SpreadsheetDataValidationSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_dataValidation validates create number action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "create" as const,
        range: "C2:C50",
        validationType: "number" as const,
        numberOperator: "between" as const,
        minValue: 0,
        maxValue: 100,
      };
      const result = SpreadsheetDataValidationSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_dataValidation validates query action",
    run: () => {
      const validInput = {
        docId: "doc123",
        action: "query" as const,
        sheetId: 1,
      };
      const result = SpreadsheetDataValidationSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_dataValidation validates delete action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "delete" as const,
        validationId: "val_123",
      };
      const result = SpreadsheetDataValidationSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_dataValidation accepts all validation types",
    run: () => {
      const validationTypes = ["list", "number", "wholeNumber", "date", "custom"] as const;
      for (const validationType of validationTypes) {
        const input = {
          docId: "doc123",
          sheetId: 1,
          action: "create" as const,
          range: "A1:A10",
          validationType,
          // Add required fields for each type
          ...(validationType === "list" ? { listValues: ["a", "b"] } : {}),
          ...(validationType === "custom" ? { customFormula: "=TRUE" } : {}),
        };
        const result = SpreadsheetDataValidationSchema.safeParse(input);
        assert.equal(result.success, true, `validationType "${validationType}" should be valid`);
      }
    },
  },

  // ==================== SpreadsheetConditionalFormat Tests ====================
  {
    name: "spreadsheet_conditionalFormat schema is valid top-level object",
    run: () => {
      const jsonSchema = z.toJSONSchema(SpreadsheetConditionalFormatSchema as never) as {
        type?: string;
      };
      assert.equal(jsonSchema.type, "object");
    },
  },
  {
    name: "spreadsheet_conditionalFormat validates create condition action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "create" as const,
        range: "A1:A100",
        ruleType: "condition" as const,
        conditionType: "greaterThan" as const,
        conditionValues: [50],
        backgroundColor: "#FFCCCC",
      };
      const result = SpreadsheetConditionalFormatSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_conditionalFormat validates create colorScale action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "create" as const,
        range: "B1:B100",
        ruleType: "colorScale" as const,
        minColor: "#FF0000",
        maxColor: "#00FF00",
      };
      const result = SpreadsheetConditionalFormatSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_conditionalFormat validates create topBottom action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "create" as const,
        range: "C1:C100",
        ruleType: "topBottom" as const,
        topBottomType: "top" as const,
        rank: 10,
        backgroundColor: "#CCFFCC",
      };
      const result = SpreadsheetConditionalFormatSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_conditionalFormat validates create duplicates action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "create" as const,
        range: "D1:D100",
        ruleType: "duplicates" as const,
        duplicateType: "duplicate" as const,
        backgroundColor: "#FFCCFF",
      };
      const result = SpreadsheetConditionalFormatSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_conditionalFormat validates query action",
    run: () => {
      const validInput = {
        docId: "doc123",
        action: "query" as const,
        sheetId: 1,
      };
      const result = SpreadsheetConditionalFormatSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_conditionalFormat validates update action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "update" as const,
        ruleId: "rule_123",
        backgroundColor: "#FFFFFF",
      };
      const result = SpreadsheetConditionalFormatSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_conditionalFormat validates delete action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "delete" as const,
        ruleId: "rule_123",
      };
      const result = SpreadsheetConditionalFormatSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_conditionalFormat accepts all rule types",
    run: () => {
      const ruleTypes = ["condition", "colorScale", "topBottom", "duplicates"] as const;
      for (const ruleType of ruleTypes) {
        const input = {
          docId: "doc123",
          sheetId: 1,
          action: "create" as const,
          range: "A1:A10",
          ruleType,
          // Add required fields for each type
          ...(ruleType === "colorScale" ? { minColor: "#FF0000", maxColor: "#00FF00" } : {}),
          ...(ruleType === "topBottom" ? { topBottomType: "top" as const, rank: 5 } : {}),
          ...(ruleType === "duplicates" ? { duplicateType: "duplicate" as const } : {}),
          ...(ruleType === "condition" ? { conditionType: "greaterThan" as const } : {}),
        };
        const result = SpreadsheetConditionalFormatSchema.safeParse(input);
        assert.equal(result.success, true, `ruleType "${ruleType}" should be valid`);
      }
    },
  },

  // ==================== SpreadsheetModifyRowsCols Tests ====================
  {
    name: "spreadsheet_modifyRowsCols schema is valid top-level object",
    run: () => {
      const jsonSchema = z.toJSONSchema(SpreadsheetModifyRowsColsSchema as never) as {
        type?: string;
      };
      assert.equal(jsonSchema.type, "object");
    },
  },
  {
    name: "spreadsheet_modifyRowsCols validates insert row action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "insert" as const,
        dimension: "row" as const,
        index: 5,
        count: 3,
      };
      const result = SpreadsheetModifyRowsColsSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_modifyRowsCols validates insert column action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "insert" as const,
        dimension: "column" as const,
        index: 2,
        count: 2,
      };
      const result = SpreadsheetModifyRowsColsSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_modifyRowsCols validates delete row action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "delete" as const,
        dimension: "row" as const,
        indexes: [1, 3, 5],
      };
      const result = SpreadsheetModifyRowsColsSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_modifyRowsCols validates delete column action",
    run: () => {
      const validInput = {
        docId: "doc123",
        sheetId: 1,
        action: "delete" as const,
        dimension: "column" as const,
        columns: ["A", "C", "AA"],
      };
      const result = SpreadsheetModifyRowsColsSchema.safeParse(validInput);
      assert.equal(result.success, true);
    },
  },
  {
    name: "spreadsheet_modifyRowsCols rejects invalid action",
    run: () => {
      const invalidInput = {
        docId: "doc123",
        sheetId: 1,
        action: "invalid",
        dimension: "row",
      };
      const result = SpreadsheetModifyRowsColsSchema.safeParse(invalidInput);
      assert.equal(result.success, false);
    },
  },
  {
    name: "spreadsheet_modifyRowsCols rejects invalid dimension",
    run: () => {
      const invalidInput = {
        docId: "doc123",
        sheetId: 1,
        action: "insert",
        dimension: "invalid",
        index: 1,
      };
      const result = SpreadsheetModifyRowsColsSchema.safeParse(invalidInput);
      assert.equal(result.success, false);
    },
  },
  {
    name: "spreadsheet_modifyRowsCols accepts all action/dimension combinations",
    run: () => {
      const actions = ["insert", "delete"] as const;
      const dimensions = ["row", "column"] as const;
      for (const action of actions) {
        for (const dimension of dimensions) {
          const input = {
            docId: "doc123",
            sheetId: 1,
            action,
            dimension,
            // Add required fields based on action
            ...(action === "insert" ? { index: 1, count: 1 } : {}),
            ...(action === "delete" && dimension === "row" ? { indexes: [1] } : {}),
            ...(action === "delete" && dimension === "column" ? { columns: ["A"] } : {}),
          };
          const result = SpreadsheetModifyRowsColsSchema.safeParse(input);
          assert.equal(result.success, true, `action "${action}" + dimension "${dimension}" should be valid`);
        }
      }
    },
  },
];

const run = async () => {
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
      console.log(`PASS ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${test.name}`);
      console.error(`     ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n${passed}/${tests.length} consolidated tool tests passed`);

  if (failed > 0) {
    process.exit(1);
  }
};

run().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
