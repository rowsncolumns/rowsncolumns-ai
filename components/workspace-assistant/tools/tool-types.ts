export type AskUserQuestionOption = {
  label: string;
  description: string;
};

export type AskUserQuestionItem = {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
};

export type ConfirmPlanExecutionItem = {
  title: string;
  summary: string;
  steps: string[];
  risks: string[];
  reason?: string;
};

export type ParsedToolResult = {
  success?: boolean;
  error?: string;
  range?: string;
  [key: string]: unknown;
};

export type ToolCopy = {
  running: string;
  success: string;
  failed: string;
};
