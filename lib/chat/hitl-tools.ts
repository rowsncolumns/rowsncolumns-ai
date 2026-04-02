export const HUMAN_IN_THE_LOOP_TOOL_NAMES = [
  "assistant_askUserQuestion",
  "assistant_confirmPlanExecution",
] as const;

const HUMAN_IN_THE_LOOP_TOOL_NAME_SET = new Set<string>(
  HUMAN_IN_THE_LOOP_TOOL_NAMES,
);

export const isHumanInTheLoopToolName = (toolName: string) =>
  HUMAN_IN_THE_LOOP_TOOL_NAME_SET.has(toolName);
