import assert from "node:assert/strict";

import {
  getStablePartRenderKeyFromSignature,
  getStablePartSignature,
  getStablePartTypeFromSignature,
  getStableThreadMessageRenderKey,
  groupStableMessageParts,
} from "../lib/assistant/stable-rendering";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  {
    name: "stable part signature ignores non-identity fields",
    run: () => {
      const a = getStablePartSignature({
        type: "tool-call",
        toolCallId: "tc_123",
        args: { value: 1 },
        text: "old",
      });
      const b = getStablePartSignature({
        type: "tool-call",
        toolCallId: "tc_123",
        args: { value: 999 },
        text: "new",
      });

      assert.equal(a, b);
      assert.equal(getStablePartTypeFromSignature(a), "tool-call");
    },
  },
  {
    name: "stable render keys prefer toolCallId and parentId",
    run: () => {
      const toolSig = getStablePartSignature({
        type: "tool-call",
        toolCallId: "tool_abc",
      });
      const reasoningSig = getStablePartSignature({
        type: "reasoning",
        parentId: "parent_xyz",
      });
      const textSig = getStablePartSignature({ type: "text" });

      assert.equal(getStablePartRenderKeyFromSignature(toolSig, 99), "tool:tool_abc");
      assert.equal(
        getStablePartRenderKeyFromSignature(reasoningSig, 42),
        "reasoning:parent_xyz",
      );
      assert.equal(getStablePartRenderKeyFromSignature(textSig, 3), "text:3");
    },
  },
  {
    name: "grouping keeps tool and reasoning ranges stable",
    run: () => {
      const ranges = groupStableMessageParts([
        "text",
        "tool-call",
        "tool-call",
        "reasoning",
        "text",
      ]);

      assert.deepEqual(ranges, [
        { type: "single", index: 0 },
        { type: "toolGroup", startIndex: 1, endIndex: 2 },
        { type: "reasoningGroup", startIndex: 3, endIndex: 3 },
        { type: "single", index: 4 },
      ]);
    },
  },
  {
    name: "grouping handles empty and single-part inputs",
    run: () => {
      assert.deepEqual(groupStableMessageParts([]), []);
      assert.deepEqual(groupStableMessageParts(["tool-call"]), [
        { type: "toolGroup", startIndex: 0, endIndex: 0 },
      ]);
      assert.deepEqual(groupStableMessageParts(["reasoning"]), [
        { type: "reasoningGroup", startIndex: 0, endIndex: 0 },
      ]);
    },
  },
  {
    name: "thread message key uses id when present",
    run: () => {
      assert.equal(getStableThreadMessageRenderKey("msg_1", 7), "msg_1");
      assert.equal(getStableThreadMessageRenderKey("", 2), "message:2");
      assert.equal(getStableThreadMessageRenderKey(undefined, 5), "message:5");
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

  console.log(`\n${passed}/${tests.length} stable-rendering tests passed`);
};

run().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
