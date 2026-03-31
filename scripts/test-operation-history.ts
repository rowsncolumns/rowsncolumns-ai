import assert from "node:assert/strict";

import { clearFlagCache } from "../lib/feature-flags";
import { buildDiffSummary, isOperationInvertible } from "../lib/operation-history/diff-summary";
import { generateInverseRawOp } from "../lib/operation-history/inverse-op";
import type { OperationPayload } from "../lib/operation-history/types";
import {
  operationHistoryActivityQuerySchema,
  operationHistoryDocumentIdSchema,
  operationHistoryUndoRequestSchema,
} from "../lib/operation-history/api-schemas";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

type FakeShareDbDoc = {
  collection: string;
  id: string;
  version: number;
  data: Record<string, unknown>;
  submitOp: (
    op: Array<Record<string, unknown>>,
    options: { source?: unknown },
    callback: (err?: unknown) => void,
  ) => void;
};

const createFakeDoc = (input?: {
  initialVersion?: number;
  submitError?: Error;
  onSubmit?: (op: Array<Record<string, unknown>>, options: { source?: unknown }) => void;
}): FakeShareDbDoc => {
  const initialVersion = input?.initialVersion ?? 0;
  return {
    collection: "spreadsheets",
    id: "doc_test",
    version: initialVersion,
    data: {},
    submitOp(op, options, callback) {
      input?.onSubmit?.(op, options);
      if (input?.submitError) {
        callback(input.submitError);
        return;
      }
      this.version += 1;
      callback();
    },
  };
};

const tests: TestCase[] = [
  {
    name: "generateInverseRawOp supports object/list/string/number/list-move ops",
    run: () => {
      const forward = [
        { p: ["sheetData", "1!A1"], od: { value: "old" }, oi: { value: "new" } },
        { p: ["rows", 1], li: { id: 1 }, ld: { id: 0 } },
        { p: ["title", 0], si: "x" },
        { p: ["count"], na: 2 },
        { p: ["items", 1], lm: 3 },
      ] satisfies Array<Record<string, unknown>>;

      const inverse = generateInverseRawOp(forward);
      assert.ok(Array.isArray(inverse));
      assert.deepEqual(inverse, [
        { p: ["items", 3], lm: 1 },
        { p: ["count"], na: -2 },
        { p: ["title", 0], sd: "x" },
        { p: ["rows", 1], li: { id: 0 }, ld: { id: 1 } },
        { p: ["sheetData", "1!A1"], oi: { value: "old" }, od: { value: "new" } },
      ]);
    },
  },
  {
    name: "generateInverseRawOp returns null for unsupported subtype ops",
    run: () => {
      const inverse = generateInverseRawOp([
        { p: ["richText"], t: "text0", o: [{ p: 0, i: "x" }] },
      ]);
      assert.equal(inverse, null);
    },
  },
  {
    name: "buildDiffSummary extracts raw_op cell + structural impact",
    run: () => {
      const payload: OperationPayload = {
        forward: {
          kind: "raw_op",
          data: [
            { p: ["sheetData", "1!A1"], oi: { value: "A" } },
            { p: ["sheetData", "1!B2"], oi: { value: "B" } },
            { p: ["tables", 0], li: { tableId: "tbl_1" } },
          ],
        },
        inverse: {
          kind: "raw_op",
          data: [{ p: ["tables", 0], ld: { tableId: "tbl_1" } }],
        },
      };

      const summary = buildDiffSummary("raw_op", payload);
      assert.ok(summary);
      assert.equal(summary?.changedCellCount, 2);
      assert.equal(summary?.totalOps, 3);
      assert.equal(summary?.sheets[0]?.sheetId, "1");
      assert.equal(summary?.sheets[0]?.a1Range, "A1:B2");
      assert.equal(summary?.structuralChanges.includes("Tables"), true);
    },
  },
  {
    name: "buildDiffSummary extracts patch_tuples cell + structural impact",
    run: () => {
      const payload: OperationPayload = {
        forward: {
          kind: "patch_tuples",
          data: [
            [
              {
                sheetData: { patches: [{ path: [1, 5, "values", 2] }] },
                charts: { patches: [{ op: "add" }] },
              },
            ],
          ],
        },
        inverse: {
          kind: "patch_tuples",
          data: [[{}]],
        },
      };

      const summary = buildDiffSummary("patch_tuples", payload);
      assert.ok(summary);
      assert.equal(summary?.changedCellCount, 1);
      assert.equal(summary?.sheets[0]?.a1Range, "C5");
      assert.equal(summary?.structuralChanges.includes("Charts"), true);
    },
  },
  {
    name: "isOperationInvertible requires non-empty inverse array",
    run: () => {
      assert.equal(
        isOperationInvertible({
          forward: { kind: "raw_op", data: [] },
          inverse: { kind: "raw_op", data: [{ p: ["a"], od: 1 }] },
        }),
        true,
      );
      assert.equal(
        isOperationInvertible({
          forward: { kind: "raw_op", data: [] },
          inverse: { kind: "raw_op", data: [] },
        }),
        false,
      );
      assert.equal(
        isOperationInvertible({
          forward: { kind: "raw_op", data: [] },
          inverse: { kind: "raw_op", data: null },
        }),
        false,
      );
    },
  },
  {
    name: "trackedSubmitOp submits op and honors provided source metadata",
    run: async () => {
      process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
      process.env.FEATURE_ENABLE_OPERATION_TRACKING = "false";
      process.env.FEATURE_ENABLE_OPERATION_TRACKING_AGENTS = "false";
      clearFlagCache();

      const { trackedSubmitOp } = await import("../lib/operation-history/tracked-submit");
      let submittedSource: unknown = null;
      const doc = createFakeDoc({
        onSubmit: (_op, options) => {
          submittedSource = options.source;
        },
      });

      const result = await trackedSubmitOp(
        doc as never,
        [{ p: ["sheetData", "1!A1"], oi: { value: "x" } }],
        {
          source: "agent",
          actorType: "assistant",
          actorId: "asst_1",
        },
        { source: { sourceType: "agent", channel: "tool" } },
      );

      assert.equal(result.success, true);
      assert.equal(result.versionFrom, 0);
      assert.equal(result.versionTo, 1);
      assert.deepEqual(submittedSource, { sourceType: "agent", channel: "tool" });
    },
  },
  {
    name: "trackedSubmitOp surfaces submit errors",
    run: async () => {
      process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
      process.env.FEATURE_ENABLE_OPERATION_TRACKING = "false";
      clearFlagCache();

      const { trackedSubmitOp } = await import("../lib/operation-history/tracked-submit");
      const doc = createFakeDoc({
        submitError: new Error("submit failed"),
      });

      const result = await trackedSubmitOp(
        doc as never,
        [{ p: ["sheetData", "1!A1"], oi: { value: "x" } }],
        {
          source: "agent",
          actorType: "assistant",
          actorId: "asst_1",
        },
      );

      assert.equal(result.success, false);
      assert.match(result.error?.message ?? "", /submit failed/);
      assert.equal(result.versionFrom, 0);
      assert.equal(result.versionTo, 0);
    },
  },
  {
    name: "activity API query schema parses comma filters and defaults",
    run: () => {
      const parsed = operationHistoryActivityQuerySchema.parse({
        limit: "10",
        sources: "agent,user",
        activityTypes: "write,rollback",
      });

      assert.equal(parsed.limit, 10);
      assert.equal(parsed.includeCount, false);
      assert.deepEqual(parsed.sources, ["agent", "user"]);
      assert.deepEqual(parsed.activityTypes, ["write", "rollback"]);
    },
  },
  {
    name: "undo API request schema validates optional reason length",
    run: () => {
      const valid = operationHistoryUndoRequestSchema.safeParse({
        operationId: "123e4567-e89b-12d3-a456-426614174000",
        confirm: true,
        reason: "rollback for audit check",
      });
      assert.equal(valid.success, true);

      const invalid = operationHistoryUndoRequestSchema.safeParse({
        reason: "x".repeat(501),
      });
      assert.equal(invalid.success, false);
    },
  },
  {
    name: "document id schema enforces non-empty and max length",
    run: () => {
      assert.equal(operationHistoryDocumentIdSchema.safeParse("doc_1").success, true);
      assert.equal(operationHistoryDocumentIdSchema.safeParse(" ").success, false);
      assert.equal(
        operationHistoryDocumentIdSchema.safeParse("x".repeat(201)).success,
        false,
      );
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

  console.log(`\n${passed}/${tests.length} operation-history tests passed`);
};

run().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
