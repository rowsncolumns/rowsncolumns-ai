/**
 * SpreadsheetBench types and interfaces
 * Based on: https://github.com/RUCKBReasoning/SpreadsheetBench
 */

export type SpreadsheetBenchTask = {
  id: string;
  instruction: string;
  spreadsheet_path: string;
  instruction_type: string;
  answer_position?: string;
};

export type SpreadsheetBenchTestCase = {
  taskId: string;
  testCaseNumber: number;
  inputPath: string;
  answerPath: string;
};

export type BenchmarkResult = {
  taskId: string;
  testCaseNumber: number;
  passed: boolean;
  instruction: string;
  errorMessage?: string;
  executionTimeMs: number;
  toolCalls: number;
  modelTokensUsed?: number;
};

export type BenchmarkSummary = {
  totalTasks: number;
  totalTestCases: number;
  passedTestCases: number;
  failedTestCases: number;
  accuracy: number;
  averageExecutionTimeMs: number;
  totalToolCalls: number;
  results: BenchmarkResult[];
  startTime: string;
  endTime: string;
  model: string;
  provider: string;
};

export type CellComparisonResult = {
  match: boolean;
  expected: unknown;
  actual: unknown;
  cellAddress: string;
  reason?: string;
};

export type SheetComparisonResult = {
  sheetName: string;
  match: boolean;
  cellResults: CellComparisonResult[];
  totalCells: number;
  matchingCells: number;
};

export type WorkbookComparisonResult = {
  match: boolean;
  sheetResults: SheetComparisonResult[];
  totalSheets: number;
  matchingSheets: number;
};
