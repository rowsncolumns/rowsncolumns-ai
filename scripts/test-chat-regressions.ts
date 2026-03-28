import assert from "node:assert/strict";

import { z } from "zod";

import { SpreadsheetSetRowColDimensionsSchema } from "../lib/chat/models";
import { encodeChatStreamEvent, parseChatStream } from "../lib/chat/protocol";
import { spreadsheetTools } from "../lib/chat/tools";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const createBigIntValue = (value: number): unknown => {
  const maybeBigInt = (
    globalThis as { BigInt?: (input: number | string) => unknown }
  ).BigInt;
  if (typeof maybeBigInt !== "function") {
    throw new Error("BigInt is not available in this runtime");
  }
  return maybeBigInt(value);
};

const tests: TestCase[] = [
  {
    name: "spreadsheet_setRowColDimensions schema is top-level object",
    run: () => {
      const jsonSchema = z.toJSONSchema(
        SpreadsheetSetRowColDimensionsSchema as never,
      ) as { type?: string; anyOf?: unknown };

      assert.equal(
        jsonSchema.type,
        "object",
        "Expected top-level JSON schema type to be object",
      );
      assert.equal(
        Array.isArray(jsonSchema.anyOf),
        false,
        "Expected no top-level union for OpenAI function tools",
      );
    },
  },
  {
    name: "all spreadsheet tool schemas compile to top-level object JSON schema",
    run: () => {
      for (const tool of spreadsheetTools as Array<{
        name: string;
        schema: unknown;
      }>) {
        const jsonSchema = z.toJSONSchema(tool.schema as never) as {
          type?: string;
        };
        assert.equal(
          jsonSchema.type,
          "object",
          `Tool ${tool.name} must expose a top-level object schema`,
        );
      }
    },
  },
  {
    name: "chat stream encoding supports BigInt payloads",
    run: async () => {
      const frame = encodeChatStreamEvent({
        type: "tool.call",
        toolName: "test_tool",
        args: {
          row: createBigIntValue(1),
          nested: { col: createBigIntValue(2) },
        },
      });

      assert.match(frame, /"row":"1"/);
      assert.match(frame, /"col":"2"/);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame));
          controller.close();
        },
      });

      const events = [];
      for await (const event of parseChatStream(stream)) {
        events.push(event);
      }

      assert.equal(events.length, 1);
      const parsed = events[0] as {
        type: string;
        args?: { row?: unknown; nested?: { col?: unknown } };
      };
      assert.equal(parsed.type, "tool.call");
      assert.equal(parsed.args?.row, "1");
      assert.equal(parsed.args?.nested?.col, "2");
    },
  },
  {
    name: "chat stream encoding supports circular payloads",
    run: async () => {
      const circular: Record<string, unknown> = { ok: true };
      circular.self = circular;

      const frame = encodeChatStreamEvent({
        type: "tool.result",
        toolName: "test_tool",
        result: circular,
      });

      assert.match(frame, /"\[Circular\]"/);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame));
          controller.close();
        },
      });

      const events = [];
      for await (const event of parseChatStream(stream)) {
        events.push(event);
      }

      assert.equal(events.length, 1);
      const parsed = events[0] as {
        type: string;
        result?: { self?: unknown };
      };
      assert.equal(parsed.type, "tool.result");
      assert.equal(parsed.result?.self, "[Circular]");
    },
  },
  {
    name: "chat stream protocol roundtrips context usage events",
    run: async () => {
      const frame = encodeChatStreamEvent({
        type: "context.usage",
        runId: "run_123",
        model: "claude-sonnet-4-6",
        inputTokensPeak: 140000,
        contextWindowTokens: 200000,
        usedPercent: 70,
        remainingPercent: 30,
        warning: "high",
      });

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame));
          controller.close();
        },
      });

      const events = [];
      for await (const event of parseChatStream(stream)) {
        events.push(event);
      }

      assert.equal(events.length, 1);
      const parsed = events[0] as {
        type: string;
        runId?: string;
        warning?: string;
        usedPercent?: number;
      };
      assert.equal(parsed.type, "context.usage");
      assert.equal(parsed.runId, "run_123");
      assert.equal(parsed.warning, "high");
      assert.equal(parsed.usedPercent, 70);
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

  console.log(`\n${passed}/${tests.length} regression tests passed`);
};

run().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
