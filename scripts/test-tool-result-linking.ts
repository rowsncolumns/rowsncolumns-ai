import assert from "node:assert/strict";

import {
  normalizeStreamingToolResult,
  setStreamingToolResult,
  type ToolStreamContentPart,
} from "../lib/assistant/tool-call-stream";
import { collectRespondedToolCallIds } from "../lib/chat/tool-call-repair";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  {
    name: "orphan streaming tool result is ignored",
    run: () => {
      const parts: ToolStreamContentPart[] = [{ type: "text" }];
      const indexByToolCallId = new Map<string, number>();

      setStreamingToolResult(
        parts,
        indexByToolCallId,
        "tc_1",
        "spreadsheet_changeBatch",
        { success: false, error: "stale" },
      );

      assert.equal(parts.length, 1);
      assert.equal(indexByToolCallId.size, 0);
    },
  },
  {
    name: "streaming tool result links by tool call id",
    run: () => {
      const parts: ToolStreamContentPart[] = [
        {
          type: "tool-call",
          toolCallId: "tc_1",
          toolName: "spreadsheet_changeBatch",
          args: { range: "A1" },
          argsText: "{\"range\":\"A1\"}",
        },
      ];
      const indexByToolCallId = new Map<string, number>([["tc_1", 0]]);

      setStreamingToolResult(
        parts,
        indexByToolCallId,
        "tc_1",
        "spreadsheet_changeBatch",
        { success: true },
      );

      const part = parts[0] as {
        type: string;
        result?: unknown;
      };
      assert.equal(part.type, "tool-call");
      assert.deepEqual(part.result, { success: true });
    },
  },
  {
    name: "streaming tool result falls back to latest pending by name",
    run: () => {
      const parts: ToolStreamContentPart[] = [
        {
          type: "tool-call",
          toolCallId: "tc_old",
          toolName: "spreadsheet_changeBatch",
          args: { range: "A1" },
          argsText: "{\"range\":\"A1\"}",
          result: { success: true },
        },
        {
          type: "tool-call",
          toolCallId: "tc_pending",
          toolName: "spreadsheet_changeBatch",
          args: { range: "A2" },
          argsText: "{\"range\":\"A2\"}",
        },
      ];
      const indexByToolCallId = new Map<string, number>();

      setStreamingToolResult(
        parts,
        indexByToolCallId,
        "tc_missing",
        "spreadsheet_changeBatch",
        { success: false, error: "validation failed" },
      );

      const part = parts[1] as {
        type: string;
        result?: unknown;
      };
      assert.equal(part.type, "tool-call");
      assert.deepEqual(part.result, {
        success: false,
        error: "validation failed",
      });
      assert.equal(indexByToolCallId.get("tc_missing"), 1);
    },
  },
  {
    name: "streaming tool error normalization wraps non-object errors",
    run: () => {
      const normalized = normalizeStreamingToolResult(
        new Error("tool boom"),
        true,
      ) as { success?: boolean; error?: string };
      assert.equal(normalized.success, false);
      assert.match(normalized.error ?? "", /tool boom/);
    },
  },
  {
    name: "collectRespondedToolCallIds reads top-level and kwargs ids",
    run: () => {
      const messages: unknown[] = [
        { tool_call_id: "tc_top" },
        { kwargs: { tool_call_id: "tc_kwargs" } },
        { kwargs: { unrelated: true } },
      ];

      const ids = collectRespondedToolCallIds(messages, 0);
      assert.equal(ids.has("tc_top"), true);
      assert.equal(ids.has("tc_kwargs"), true);
      assert.equal(ids.size, 2);
    },
  },
  {
    name: "collectRespondedToolCallIds respects start index",
    run: () => {
      const messages: unknown[] = [
        { tool_call_id: "tc_early" },
        { tool_call_id: "tc_late" },
      ];

      const ids = collectRespondedToolCallIds(messages, 1);
      assert.equal(ids.has("tc_early"), false);
      assert.equal(ids.has("tc_late"), true);
      assert.equal(ids.size, 1);
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

  console.log(`\n${passed}/${tests.length} tool-result-linking tests passed`);
};

run().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
