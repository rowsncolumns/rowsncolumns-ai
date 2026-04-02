/**
 * Tests for Human-in-the-Loop (HITL) graph functionality.
 *
 * Run with: npx tsx scripts/test-hitl-graph.ts
 */

import assert from "node:assert/strict";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { collectRespondedToolCallIds } from "../lib/chat/tool-call-repair";
import {
  HUMAN_IN_THE_LOOP_TOOL_NAMES,
  isHumanInTheLoopToolName,
} from "../lib/chat/hitl-tools";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

// Re-implement getPendingHumanToolCall logic for testing (same as in graph.ts)
type PendingHumanToolCall = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

const getToolCallArgs = (toolCall: unknown): unknown => {
  if (!toolCall || typeof toolCall !== "object") {
    return {};
  }
  if ("args" in toolCall) {
    return (toolCall as { args?: unknown }).args ?? {};
  }
  return {};
};

const getPendingHumanToolCall = (
  messages: Array<HumanMessage | AIMessage | ToolMessage>,
): PendingHumanToolCall | null => {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (
      !message ||
      typeof message !== "object" ||
      !("tool_calls" in message) ||
      !Array.isArray(message.tool_calls) ||
      message.tool_calls.length === 0
    ) {
      continue;
    }

    const respondedToolCallIds = collectRespondedToolCallIds(
      messages,
      messageIndex + 1,
    );
    for (const toolCall of message.tool_calls) {
      const maybeToolCall = toolCall as { id?: unknown; name?: unknown };
      const toolCallId =
        typeof maybeToolCall.id === "string" ? maybeToolCall.id : "";
      const toolName =
        typeof maybeToolCall.name === "string" ? maybeToolCall.name : "";
      if (!toolCallId || !toolName) {
        continue;
      }
      if (!isHumanInTheLoopToolName(toolName)) {
        continue;
      }
      if (respondedToolCallIds.has(toolCallId)) {
        continue;
      }

      return {
        toolCallId,
        toolName,
        args: getToolCallArgs(toolCall),
      };
    }

    // Only inspect the latest assistant tool-call message.
    break;
  }

  return null;
};

// Re-implement resolveInterruptedToolResponse for testing
type ResumeToolResponseLike = {
  toolCallId?: string;
  toolName?: string;
  result?: unknown;
  isError?: boolean;
};

const parseResumeToolResponseLike = (
  value: unknown,
): ResumeToolResponseLike | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    toolCallId?: unknown;
    toolName?: unknown;
    result?: unknown;
    isError?: unknown;
  };

  const hasShape =
    "result" in candidate ||
    "toolCallId" in candidate ||
    "toolName" in candidate ||
    "isError" in candidate;
  if (!hasShape) {
    return null;
  }

  const toolCallId =
    typeof candidate.toolCallId === "string" ? candidate.toolCallId : undefined;
  const toolName =
    typeof candidate.toolName === "string" ? candidate.toolName : undefined;
  const isError =
    typeof candidate.isError === "boolean" ? candidate.isError : undefined;

  return {
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(isError !== undefined ? { isError } : {}),
    ...(Object.prototype.hasOwnProperty.call(candidate, "result")
      ? { result: candidate.result }
      : {}),
  };
};

const resolveInterruptedToolResponse = (
  resumeValue: unknown,
  pendingToolCall: PendingHumanToolCall,
): { result: unknown; isError: boolean } => {
  const resumeEntries = Array.isArray(resumeValue) ? resumeValue : [resumeValue];
  const parsedEntries = resumeEntries
    .map(parseResumeToolResponseLike)
    .filter((entry): entry is ResumeToolResponseLike => entry !== null);

  const byToolCallId = parsedEntries.find(
    (entry) => entry.toolCallId === pendingToolCall.toolCallId,
  );
  const byToolName = parsedEntries.find(
    (entry) => entry.toolName === pendingToolCall.toolName,
  );
  const matchedEntry = byToolCallId ?? byToolName ?? parsedEntries[0];

  if (matchedEntry) {
    if (Object.prototype.hasOwnProperty.call(matchedEntry, "result")) {
      return {
        result: matchedEntry.result,
        isError: matchedEntry.isError === true,
      };
    }

    return {
      result: matchedEntry,
      isError: matchedEntry.isError === true,
    };
  }

  return {
    result: resumeValue,
    isError: false,
  };
};

const tests: TestCase[] = [
  // HITL tool name registry tests
  {
    name: "isHumanInTheLoopToolName returns true for HITL tools",
    run: () => {
      assert.equal(isHumanInTheLoopToolName("assistant_askUserQuestion"), true);
    },
  },
  {
    name: "isHumanInTheLoopToolName returns false for non-HITL tools",
    run: () => {
      assert.equal(isHumanInTheLoopToolName("spreadsheet_changeBatch"), false);
      assert.equal(isHumanInTheLoopToolName("web_search"), false);
    },
  },

  // getPendingHumanToolCall tests
  {
    name: "getPendingHumanToolCall returns pending HITL tool call",
    run: () => {
      const messages = [
        new HumanMessage("Ask me something"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "tc_123",
              name: "assistant_askUserQuestion",
              args: { questions: [{ question: "What color?", options: [] }] },
            },
          ],
        }),
      ];

      const pending = getPendingHumanToolCall(messages);
      assert.notEqual(pending, null);
      assert.equal(pending?.toolCallId, "tc_123");
      assert.equal(pending?.toolName, "assistant_askUserQuestion");
    },
  },
  {
    name: "getPendingHumanToolCall returns null when tool call is already responded",
    run: () => {
      const messages = [
        new HumanMessage("Ask me something"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "tc_123",
              name: "assistant_askUserQuestion",
              args: { questions: [] },
            },
          ],
        }),
        new ToolMessage({
          tool_call_id: "tc_123",
          name: "assistant_askUserQuestion",
          content: JSON.stringify({ answer: "Blue" }),
        }),
      ];

      const pending = getPendingHumanToolCall(messages);
      assert.equal(pending, null, "Should return null when already responded");
    },
  },
  {
    name: "getPendingHumanToolCall ignores non-HITL tool calls",
    run: () => {
      const messages = [
        new HumanMessage("Do something"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "tc_456",
              name: "spreadsheet_changeBatch",
              args: { changes: [] },
            },
          ],
        }),
      ];

      const pending = getPendingHumanToolCall(messages);
      assert.equal(pending, null, "Should return null for non-HITL tools");
    },
  },
  {
    name: "getPendingHumanToolCall handles mixed tool calls (HITL + non-HITL)",
    run: () => {
      const messages = [
        new HumanMessage("Do something"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "tc_regular",
              name: "spreadsheet_changeBatch",
              args: { changes: [] },
            },
            {
              id: "tc_hitl",
              name: "assistant_askUserQuestion",
              args: { questions: [] },
            },
          ],
        }),
      ];

      const pending = getPendingHumanToolCall(messages);
      assert.notEqual(pending, null);
      assert.equal(pending?.toolCallId, "tc_hitl");
      assert.equal(pending?.toolName, "assistant_askUserQuestion");
    },
  },

  // resolveInterruptedToolResponse tests
  {
    name: "resolveInterruptedToolResponse extracts result from matching toolCallId",
    run: () => {
      const pendingToolCall: PendingHumanToolCall = {
        toolCallId: "tc_123",
        toolName: "assistant_askUserQuestion",
        args: {},
      };
      const resumeValue = [
        {
          toolCallId: "tc_123",
          toolName: "assistant_askUserQuestion",
          result: { answer: "Blue" },
        },
      ];

      const response = resolveInterruptedToolResponse(resumeValue, pendingToolCall);
      assert.deepEqual(response.result, { answer: "Blue" });
      assert.equal(response.isError, false);
    },
  },
  {
    name: "resolveInterruptedToolResponse handles single response (not array)",
    run: () => {
      const pendingToolCall: PendingHumanToolCall = {
        toolCallId: "tc_123",
        toolName: "assistant_askUserQuestion",
        args: {},
      };
      const resumeValue = {
        toolCallId: "tc_123",
        result: { answer: "Red" },
      };

      const response = resolveInterruptedToolResponse(resumeValue, pendingToolCall);
      assert.deepEqual(response.result, { answer: "Red" });
    },
  },
  {
    name: "resolveInterruptedToolResponse handles isError flag",
    run: () => {
      const pendingToolCall: PendingHumanToolCall = {
        toolCallId: "tc_123",
        toolName: "assistant_askUserQuestion",
        args: {},
      };
      const resumeValue = {
        toolCallId: "tc_123",
        result: { error: "User cancelled" },
        isError: true,
      };

      const response = resolveInterruptedToolResponse(resumeValue, pendingToolCall);
      assert.equal(response.isError, true);
    },
  },
  {
    name: "resolveInterruptedToolResponse falls back to toolName matching",
    run: () => {
      const pendingToolCall: PendingHumanToolCall = {
        toolCallId: "tc_123",
        toolName: "assistant_askUserQuestion",
        args: {},
      };
      // No toolCallId, but has toolName
      const resumeValue = {
        toolName: "assistant_askUserQuestion",
        result: { answer: "Green" },
      };

      const response = resolveInterruptedToolResponse(resumeValue, pendingToolCall);
      assert.deepEqual(response.result, { answer: "Green" });
    },
  },

  // Duplicate ToolMessage prevention test
  {
    name: "ToolMessage from Command.update should prevent humanNode from adding duplicate",
    run: () => {
      // Simulate state AFTER Command.update has added the ToolMessage
      const messagesAfterUpdate = [
        new HumanMessage("Ask me something"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "tc_123",
              name: "assistant_askUserQuestion",
              args: { questions: [] },
            },
          ],
        }),
        // This ToolMessage was added by Command.update
        new ToolMessage({
          tool_call_id: "tc_123",
          name: "assistant_askUserQuestion",
          content: JSON.stringify({ answer: "Blue" }),
        }),
      ];

      // getPendingHumanToolCall should return null since the tool call is already responded
      const pending = getPendingHumanToolCall(messagesAfterUpdate);
      assert.equal(
        pending,
        null,
        "After Command.update adds ToolMessage, getPendingHumanToolCall should return null to prevent duplicate",
      );
    },
  },

  // Multiple HITL tool calls scenario
  {
    name: "getPendingHumanToolCall handles multiple HITL calls - returns first unanswered",
    run: () => {
      const messages = [
        new HumanMessage("Ask me two things"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "tc_q1",
              name: "assistant_askUserQuestion",
              args: { questions: [{ question: "First?" }] },
            },
            {
              id: "tc_q2",
              name: "assistant_askUserQuestion",
              args: { questions: [{ question: "Second?" }] },
            },
          ],
        }),
      ];

      const pending = getPendingHumanToolCall(messages);
      assert.notEqual(pending, null);
      // Should return first unanswered HITL tool call
      assert.equal(pending?.toolCallId, "tc_q1");
    },
  },
  {
    name: "getPendingHumanToolCall returns second HITL call when first is answered",
    run: () => {
      const messages = [
        new HumanMessage("Ask me two things"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "tc_q1",
              name: "assistant_askUserQuestion",
              args: { questions: [{ question: "First?" }] },
            },
            {
              id: "tc_q2",
              name: "assistant_askUserQuestion",
              args: { questions: [{ question: "Second?" }] },
            },
          ],
        }),
        new ToolMessage({
          tool_call_id: "tc_q1",
          name: "assistant_askUserQuestion",
          content: JSON.stringify({ answer: "First answer" }),
        }),
      ];

      const pending = getPendingHumanToolCall(messages);
      assert.notEqual(pending, null);
      assert.equal(pending?.toolCallId, "tc_q2");
    },
  },
  {
    name: "getPendingHumanToolCall returns null when all HITL calls are answered",
    run: () => {
      const messages = [
        new HumanMessage("Ask me two things"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "tc_q1",
              name: "assistant_askUserQuestion",
              args: { questions: [{ question: "First?" }] },
            },
            {
              id: "tc_q2",
              name: "assistant_askUserQuestion",
              args: { questions: [{ question: "Second?" }] },
            },
          ],
        }),
        new ToolMessage({
          tool_call_id: "tc_q1",
          name: "assistant_askUserQuestion",
          content: JSON.stringify({ answer: "First answer" }),
        }),
        new ToolMessage({
          tool_call_id: "tc_q2",
          name: "assistant_askUserQuestion",
          content: JSON.stringify({ answer: "Second answer" }),
        }),
      ];

      const pending = getPendingHumanToolCall(messages);
      assert.equal(pending, null, "All HITL calls answered, should return null");
    },
  },
];

async function runTests() {
  console.log("Running HITL Graph tests...\n");

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.run();
      console.log(`  ✅ ${test.name}`);
      passed++;
    } catch (error) {
      console.log(`  ❌ ${test.name}`);
      console.log(`     ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Test runner failed:", error);
  process.exit(1);
});
