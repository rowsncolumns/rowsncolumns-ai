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
  reviewHeader?: string;
  approveButtonLabel?: string;
  requestChangesButtonLabel?: string;
  submitChangesButtonLabel?: string;
  feedbackPrompt?: string;
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
