import assert from "node:assert/strict";

import {
  buildContextUsageSnapshot,
  extractInputTokensFromModelEndData,
  getNextContextUsageSnapshot,
  resolveModelContextWindowTokens,
} from "../lib/chat/context-usage";
import {
  clearThreadContextUsage,
  getLatestContextUsageFromRunEvents,
  getThreadContextUsage,
  parseAssistantContextUsageEvent,
  setThreadContextUsage,
  type AssistantContextUsageByThread,
} from "../lib/assistant/context-usage-state";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  {
    name: "resolveModelContextWindowTokens maps known model families",
    run: () => {
      assert.equal(
        resolveModelContextWindowTokens("claude-sonnet-4-6"),
        1000000,
      );
      assert.equal(resolveModelContextWindowTokens("gpt-5.4"), 1050000);
      assert.equal(resolveModelContextWindowTokens("unknown-model"), 128000);
    },
  },
  {
    name: "extractInputTokensFromModelEndData reads common usage paths",
    run: () => {
      assert.equal(
        extractInputTokensFromModelEndData({
          output: { usage_metadata: { input_tokens: 42000 } },
        }),
        42000,
      );
      assert.equal(
        extractInputTokensFromModelEndData({
          output: { response_metadata: { token_usage: { prompt_tokens: 7300 } } },
        }),
        7300,
      );
    },
  },
  {
    name: "getNextContextUsageSnapshot updates only when peak increases",
    run: () => {
      const first = getNextContextUsageSnapshot({
        model: "claude-sonnet-4-6",
        modelEndEventData: { output: { usage_metadata: { input_tokens: 10000 } } },
        currentPeakInputTokens: 0,
      });
      assert.equal(first.didIncreasePeak, true);
      assert.equal(first.nextPeakInputTokens, 10000);
      assert.equal(first.snapshot?.usedPercent, 1);

      const second = getNextContextUsageSnapshot({
        model: "claude-sonnet-4-6",
        modelEndEventData: { output: { usage_metadata: { input_tokens: 9000 } } },
        currentPeakInputTokens: first.nextPeakInputTokens,
      });
      assert.equal(second.didIncreasePeak, false);
      assert.equal(second.snapshot, null);
      assert.equal(second.nextPeakInputTokens, 10000);
    },
  },
  {
    name: "buildContextUsageSnapshot flags high warning at 70% used",
    run: () => {
      const normal = buildContextUsageSnapshot({
        model: "claude-sonnet-4-6",
        inputTokensPeak: 100000,
        contextWindowTokens: 200000,
        warningThresholdUsedPercent: 70,
      });
      const high = buildContextUsageSnapshot({
        model: "claude-sonnet-4-6",
        inputTokensPeak: 140000,
        contextWindowTokens: 200000,
        warningThresholdUsedPercent: 70,
      });

      assert.equal(normal?.warning, "normal");
      assert.equal(normal?.usedPercent, 50);
      assert.equal(high?.warning, "high");
      assert.equal(high?.usedPercent, 70);
      assert.equal(high?.remainingPercent, 30);
    },
  },
  {
    name: "context usage thread state set/get/clear behaves correctly",
    run: () => {
      let state: AssistantContextUsageByThread = {};
      const usage = {
        type: "context.usage" as const,
        runId: "run_1",
        model: "claude-sonnet-4-6",
        inputTokensPeak: 50000,
        contextWindowTokens: 200000,
        usedPercent: 25,
        remainingPercent: 75,
        warning: "normal" as const,
      };

      state = setThreadContextUsage(state, "thread-a", usage);
      assert.equal(getThreadContextUsage(state, "thread-a")?.runId, "run_1");
      assert.equal(getThreadContextUsage(state, "thread-b"), null);

      const updated = {
        ...usage,
        runId: "run_2",
        usedPercent: 71,
        remainingPercent: 29,
        warning: "high" as const,
      };
      state = setThreadContextUsage(state, "thread-b", updated);
      state = clearThreadContextUsage(state, "thread-a");
      assert.equal(getThreadContextUsage(state, "thread-a"), null);
      assert.equal(getThreadContextUsage(state, "thread-b")?.warning, "high");
    },
  },
  {
    name: "context usage parsing and latest resume extraction are robust",
    run: () => {
      const invalid = parseAssistantContextUsageEvent({
        type: "context.usage",
        runId: "",
      });
      assert.equal(invalid, null);

      const parsed = parseAssistantContextUsageEvent({
        type: "context.usage",
        runId: "run_42",
        model: "claude-sonnet-4-6",
        inputTokensPeak: 95000,
        contextWindowTokens: 200000,
        usedPercent: 48,
        remainingPercent: 52,
        warning: "normal",
      });
      assert.equal(parsed?.runId, "run_42");
      assert.equal(parsed?.usedPercent, 48);

      const latest = getLatestContextUsageFromRunEvents([
        { data: { type: "message.start", threadId: "thread_a" } },
        {
          data: {
            type: "context.usage",
            runId: "run_1",
            model: "claude-sonnet-4-6",
            inputTokensPeak: 30000,
            contextWindowTokens: 200000,
            usedPercent: 15,
            remainingPercent: 85,
            warning: "normal",
          },
        },
        {
          data: {
            type: "context.usage",
            runId: "run_1",
            model: "claude-sonnet-4-6",
            inputTokensPeak: 150000,
            contextWindowTokens: 200000,
            usedPercent: 75,
            remainingPercent: 25,
            warning: "high",
          },
        },
      ]);

      assert.equal(latest?.runId, "run_1");
      assert.equal(latest?.usedPercent, 75);
      assert.equal(latest?.warning, "high");
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

  console.log(`\n${passed}/${tests.length} context-usage tests passed`);
};

run().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
