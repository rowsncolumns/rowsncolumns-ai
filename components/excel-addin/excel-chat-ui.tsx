"use client";

import type {
  AssistantToolUIProps,
  ToolCallMessagePartProps,
} from "@assistant-ui/react";
import {
  ComposerPrimitive,
  MessagePrimitive,
  useAssistantToolUI,
  useAuiState,
  useComposer,
  useComposerRuntime,
  useMessage,
  useMessagePartText,
  useThread,
  useThreadRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import * as Collapsible from "@radix-ui/react-collapsible";
import { uuidString } from "@rowsncolumns/utils";
import { IconButton } from "@rowsncolumns/ui";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  Cpu,
  Loader2,
  Navigation,
  SendHorizontal,
  Sparkles,
  Square,
  Table2,
  X,
  XCircle,
} from "lucide-react";
import * as React from "react";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INITIAL_CREDITS, MIN_CREDITS_PER_RUN } from "@/lib/credits/pricing";
import { cn } from "@/lib/utils";
import { useExcelContext } from "@/components/excel-addin/excel-context";

const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const TOOL_INPUT_UNAVAILABLE_MARKER = "__rnc_tool_input_unavailable__";

type ModelOption = {
  value: string;
  label: string;
};

type ModelOptionGroup = {
  label: string;
  options: ModelOption[];
};

const MODEL_OPTION_GROUPS: ModelOptionGroup[] = [
  {
    label: "OpenAI",
    options: [
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
      { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
      { value: "gpt-5.2-chat-latest", label: "GPT-5.2 Chat" },
      { value: "gpt-5-mini", label: "GPT-5 Mini" },
      { value: "gpt-5-nano", label: "GPT-5 Nano" },
      { value: "gpt-4.1", label: "GPT-4.1" },
      { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
      { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
      { value: "o3", label: "o3" },
      { value: "o4-mini", label: "o4-mini" },
    ],
  },
  {
    label: "Anthropic",
    options: [
      { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
      { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
      { value: "claude-opus-4-1-20250805", label: "Claude Opus 4.1" },
    ],
  },
];

const MODEL_OPTIONS: ModelOption[] = MODEL_OPTION_GROUPS.flatMap(
  (group) => group.options,
);
export const DEFAULT_ASSISTANT_MODEL =
  MODEL_OPTION_GROUPS[0]?.options[0]?.value ?? "gpt-5.2-chat-latest";
export const getAssistantModelLabel = (model: string) =>
  MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model;

const SPREADSHEET_TOOL_NAMES = [
  "spreadsheet_changeBatch",
  "spreadsheet_createSheet",
  "spreadsheet_updateSheet",
  "spreadsheet_formatRange",
  "spreadsheet_insertRows",
  "spreadsheet_insertColumns",
  "spreadsheet_queryRange",
  "spreadsheet_setIterativeMode",
  "spreadsheet_readDocument",
  "spreadsheet_setRowColDimensions",
  "spreadsheet_duplicateSheet",
  "spreadsheet_deleteCells",
  "spreadsheet_clearFormatting",
  "spreadsheet_applyFill",
  "spreadsheet_insertNote",
  "spreadsheet_deleteRows",
  "spreadsheet_deleteColumns",
] as const;

type ToolCopy = {
  running: string;
  success: string;
  failed: string;
};

const TOOL_UI_COPY: Record<string, ToolCopy> = {
  spreadsheet_changeBatch: {
    running: "Updating spreadsheet data",
    success: "Updated spreadsheet data",
    failed: "Failed to update spreadsheet data",
  },
  spreadsheet_createSheet: {
    running: "Creating sheet",
    success: "Created sheet",
    failed: "Failed to create sheet",
  },
  spreadsheet_updateSheet: {
    running: "Updating sheet settings",
    success: "Updated sheet settings",
    failed: "Failed to update sheet settings",
  },
  spreadsheet_formatRange: {
    running: "Applying formatting",
    success: "Applied formatting",
    failed: "Failed to apply formatting",
  },
  spreadsheet_insertRows: {
    running: "Inserting rows",
    success: "Inserted rows",
    failed: "Failed to insert rows",
  },
  spreadsheet_insertColumns: {
    running: "Inserting columns",
    success: "Inserted columns",
    failed: "Failed to insert columns",
  },
  spreadsheet_queryRange: {
    running: "Reading spreadsheet data",
    success: "Read spreadsheet data",
    failed: "Failed to read spreadsheet data",
  },
  spreadsheet_setIterativeMode: {
    running: "Updating iterative mode",
    success: "Updated iterative mode",
    failed: "Failed to update iterative mode",
  },
  spreadsheet_readDocument: {
    running: "Reading document",
    success: "Read document",
    failed: "Failed to read document",
  },
  spreadsheet_setRowColDimensions: {
    running: "Setting row/column dimensions",
    success: "Set row/column dimensions",
    failed: "Failed to set row/column dimensions",
  },
  spreadsheet_duplicateSheet: {
    running: "Duplicating sheet",
    success: "Duplicated sheet",
    failed: "Failed to duplicate sheet",
  },
  spreadsheet_deleteCells: {
    running: "Deleting cells",
    success: "Deleted cells",
    failed: "Failed to delete cells",
  },
  spreadsheet_clearFormatting: {
    running: "Clearing formatting",
    success: "Cleared formatting",
    failed: "Failed to clear formatting",
  },
  spreadsheet_applyFill: {
    running: "Applying fill",
    success: "Applied fill",
    failed: "Failed to apply fill",
  },
  spreadsheet_insertNote: {
    running: "Inserting note",
    success: "Inserted note",
    failed: "Failed to insert note",
  },
  spreadsheet_deleteRows: {
    running: "Deleting rows",
    success: "Deleted rows",
    failed: "Failed to delete rows",
  },
  spreadsheet_deleteColumns: {
    running: "Deleting columns",
    success: "Deleted columns",
    failed: "Failed to delete columns",
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isUnavailableToolArgs = (value: unknown) =>
  isRecord(value) && value[TOOL_INPUT_UNAVAILABLE_MARKER] === true;

const deepParseJsonValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return deepParseJsonValue(parsed);
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map(deepParseJsonValue);
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepParseJsonValue(val);
    }
    return result;
  }

  return value;
};

const getRangeFromParsedToolArgs = (value: unknown): string | null => {
  if (!isRecord(value)) return null;

  if (typeof value.range === "string" && value.range.trim().length > 0) {
    return value.range;
  }

  if (isRecord(value.input)) {
    const nestedRange = value.input.range;
    if (typeof nestedRange === "string" && nestedRange.trim().length > 0) {
      return nestedRange;
    }
  }

  return null;
};

const getSheetIdFromParsedToolArgs = (value: unknown): number | null => {
  if (!isRecord(value)) return null;

  if (typeof value.sheetId === "number" && Number.isFinite(value.sheetId)) {
    return value.sheetId;
  }

  if (isRecord(value.input)) {
    const nestedSheetId = value.input.sheetId;
    if (typeof nestedSheetId === "number" && Number.isFinite(nestedSheetId)) {
      return nestedSheetId;
    }
  }

  return null;
};

const getCreatedSheetIdFromToolResult = (value: unknown): number | null => {
  if (!isRecord(value)) return null;

  if (typeof value.sheetId === "number" && Number.isFinite(value.sheetId)) {
    return value.sheetId;
  }

  if (
    isRecord(value.sheet) &&
    typeof value.sheet.sheetId === "number" &&
    Number.isFinite(value.sheet.sheetId)
  ) {
    return value.sheet.sheetId;
  }

  return null;
};

type ParsedToolResult = {
  success?: boolean;
  error?: string;
  range?: string;
  [key: string]: unknown;
};

const extractParsedToolResult = (result: unknown): ParsedToolResult | null => {
  if (!result) return null;

  if (isRecord(result)) {
    const r = result;
    if (r.kwargs && typeof r.kwargs === "object") {
      const kwargs = r.kwargs as Record<string, unknown>;
      if (typeof kwargs.content === "string") {
        try {
          const parsed = JSON.parse(kwargs.content);
          return isRecord(parsed) ? (parsed as ParsedToolResult) : null;
        } catch {
          return { error: kwargs.content };
        }
      }
    }

    if ("success" in r) {
      return r as ParsedToolResult;
    }
  }

  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return isRecord(parsed) ? (parsed as ParsedToolResult) : null;
    } catch {
      return null;
    }
  }

  return null;
};

const formatToolNameFallback = (toolName: string) =>
  toolName
    .replace(/^spreadsheet_/, "")
    .replace(/_/g, " ")
    .trim();

const getToolCopy = (toolName: string): ToolCopy => {
  const mapped = TOOL_UI_COPY[toolName];
  if (mapped) return mapped;

  const fallbackName = formatToolNameFallback(toolName) || toolName;
  return {
    running: `Running ${fallbackName}`,
    success: `Completed ${fallbackName}`,
    failed: `Failed ${fallbackName}`,
  };
};

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

function MarkdownText() {
  return <MarkdownTextPrimitive remarkPlugins={MARKDOWN_REMARK_PLUGINS} />;
}

function AssistantTextPart() {
  const textPart = useMessagePartText();
  if (!textPart.text?.trim()) return null;

  return (
    <Card className="rnc-assistant-bubble-ai w-fit max-w-[92%] border-black/10 bg-[#fff7f1]">
      <CardContent className="py-2 px-3">
        <div className="prose overflow-hidden text-sm text-foreground">
          <MarkdownText />
        </div>
      </CardContent>
    </Card>
  );
}

function ReasoningBlock({
  children,
  forceOpen,
}: {
  children: React.ReactNode;
  forceOpen: boolean;
}) {
  const [isOpen, setIsOpen] = React.useState(forceOpen);

  React.useEffect(() => {
    setIsOpen(forceOpen);
  }, [forceOpen]);

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Trigger className="flex w-full items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-left text-xs font-medium text-purple-700 transition hover:bg-purple-100">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Thinking</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse data-[state=open]:animate-expand">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function ToolCallDisplay({
  toolName,
  args,
  result,
  onNavigateToRange,
}: {
  toolName: string;
  args: unknown;
  result?: unknown;
  onNavigateToRange?: (input: { range: string; sheetId: number | null }) => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [copiedTab, setCopiedTab] = React.useState<"input" | "output" | null>(
    null,
  );
  const hasResult = result !== undefined;

  const handleCopy = React.useCallback(
    async (content: string, tab: "input" | "output") => {
      try {
        await navigator.clipboard.writeText(content);
        setCopiedTab(tab);
        setTimeout(() => setCopiedTab(null), 2000);
      } catch {
        // Ignore clipboard errors.
      }
    },
    [],
  );

  const extractedResult = React.useMemo(
    () => extractParsedToolResult(result),
    [result],
  );

  const isParsedError =
    extractedResult?.success === false ||
    (typeof extractedResult?.error === "string" &&
      extractedResult.error.trim().length > 0 &&
      extractedResult.success !== true);
  const isError = isParsedError;
  const errorMessage = extractedResult?.error;
  const isComplete = hasResult && !isError;
  const isRunning = !hasResult;
  const toolCopy = React.useMemo(() => getToolCopy(toolName), [toolName]);
  const titleText = isRunning
    ? toolCopy.running
    : isError
      ? toolCopy.failed
      : toolCopy.success;
  const parsedArgs = React.useMemo(() => deepParseJsonValue(args), [args]);
  const rangeFromArgs = getRangeFromParsedToolArgs(parsedArgs);
  const rangeFromResult =
    typeof extractedResult?.range === "string" ? extractedResult.range : null;
  const sheetIdFromArgs = getSheetIdFromParsedToolArgs(parsedArgs);
  const sheetIdFromResult = getSheetIdFromParsedToolArgs(extractedResult);
  const rangeForNavigation = rangeFromArgs || rangeFromResult;
  const sheetIdForNavigation = sheetIdFromArgs ?? sheetIdFromResult ?? null;
  const canNavigateToRange = Boolean(onNavigateToRange && rangeForNavigation);

  const navigateToRange = React.useCallback(() => {
    if (!onNavigateToRange || !rangeForNavigation) return;
    onNavigateToRange({
      range: rangeForNavigation,
      sheetId: sheetIdForNavigation,
    });
  }, [
    onNavigateToRange,
    rangeForNavigation,
    sheetIdForNavigation,
  ]);

  const range =
    rangeFromArgs ||
    rangeFromResult ||
    (toolName === "spreadsheet_changeBatch" ? "cells" : "");
  const explanation = React.useMemo(() => {
    if (!isRecord(parsedArgs)) return null;

    const parsedInput = parsedArgs.input;
    if (
      isRecord(parsedInput) &&
      typeof parsedInput.explanation === "string" &&
      parsedInput.explanation.trim().length > 0
    ) {
      return parsedInput.explanation.trim();
    }

    if (
      typeof parsedArgs.explanation === "string" &&
      parsedArgs.explanation.trim().length > 0
    ) {
      return parsedArgs.explanation.trim();
    }

    return null;
  }, [parsedArgs]);

  const formattedArgs = React.useMemo(() => {
    if (isUnavailableToolArgs(parsedArgs)) {
      return "Input unavailable: tool call failed before execution and runtime did not emit tool arguments.";
    }

    try {
      const serialized = JSON.stringify(parsedArgs, null, 2);
      return typeof serialized === "string" ? serialized : String(args);
    } catch {
      return String(args);
    }
  }, [args, parsedArgs]);

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition",
          isRunning
            ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
            : isError
              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100",
        )}
      >
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isError ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        <Table2 className="h-3.5 w-3.5" />
        <div className="min-w-0 flex-1">
          <div>
            {titleText}
            {range && <span className="ml-1 text-[10px] opacity-70">({range})</span>}
            . {explanation}
          </div>
        </div>

        {isComplete && canNavigateToRange && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Navigate to affected range"
            title="Navigate to affected range"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              navigateToRange();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              navigateToRange();
            }}
            className="ml-auto shrink-0 cursor-pointer rounded p-1 text-green-600 hover:bg-green-100"
          >
            <Navigation className="h-3.5 w-3.5" />
          </span>
        )}

        <ChevronDown
          className={cn(
            "ml-1 h-3.5 w-3.5 shrink-0 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse data-[state=open]:animate-expand">
        {isError && (
          <div className="mt-1 rounded border border-red-200 bg-red-100 p-2 text-xs text-red-800">
            <div className="font-medium">Error</div>
            <div className="mt-1 font-mono text-[11px]">
              {errorMessage || "Unknown error"}
            </div>
          </div>
        )}
        <Tabs defaultValue="input" className="mt-1">
          <TabsList className="h-7 gap-1 bg-transparent p-0">
            <TabsTrigger
              value="input"
              className={cn(
                "h-6 rounded px-2 py-0.5 text-[10px] font-medium",
                isRunning
                  ? "data-[state=active]:bg-blue-100 data-[state=active]:text-blue-700"
                  : isError
                    ? "data-[state=active]:bg-red-100 data-[state=active]:text-red-700"
                    : "data-[state=active]:bg-green-100 data-[state=active]:text-green-700",
              )}
            >
              Input
            </TabsTrigger>
            <TabsTrigger
              value="output"
              className={cn(
                "h-6 rounded px-2 py-0.5 text-[10px] font-medium",
                isRunning
                  ? "data-[state=active]:bg-blue-100 data-[state=active]:text-blue-700"
                  : isError
                    ? "data-[state=active]:bg-red-100 data-[state=active]:text-red-700"
                    : "data-[state=active]:bg-green-100 data-[state=active]:text-green-700",
              )}
            >
              Output
            </TabsTrigger>
          </TabsList>
          <TabsContent value="input" className="mt-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => handleCopy(formattedArgs, "input")}
                className={cn(
                  "absolute right-1 top-1 rounded p-1 transition-colors",
                  isRunning
                    ? "text-blue-600 hover:bg-blue-100"
                    : isError
                      ? "text-red-600 hover:bg-red-100"
                      : "text-green-600 hover:bg-green-100",
                )}
                title="Copy to clipboard"
              >
                {copiedTab === "input" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <pre
                className={cn(
                  "max-h-64 overflow-y-auto overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-md p-2 pr-8 font-mono text-[11px] leading-relaxed",
                  isRunning
                    ? "bg-blue-50/70 text-blue-900"
                    : isError
                      ? "bg-red-50/70 text-red-900"
                      : "bg-green-50/70 text-green-900",
                )}
              >
                {formattedArgs}
              </pre>
            </div>
          </TabsContent>
          <TabsContent value="output" className="mt-1.5">
            <div className="relative">
              {hasResult && (
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(JSON.stringify(extractedResult, null, 2), "output")
                  }
                  className={cn(
                    "absolute right-1 top-1 rounded p-1 transition-colors",
                    isError
                      ? "text-red-600 hover:bg-red-100"
                      : "text-green-600 hover:bg-green-100",
                  )}
                  title="Copy to clipboard"
                >
                  {copiedTab === "output" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {hasResult ? (
                <pre
                  className={cn(
                    "max-h-64 overflow-y-auto overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-md p-2 pr-8 font-mono text-[11px] leading-relaxed",
                    isError
                      ? "bg-red-50/70 text-red-900"
                      : "bg-green-50/70 text-green-900",
                  )}
                >
                  {JSON.stringify(extractedResult, null, 2)}
                </pre>
              ) : (
                <div className="rounded-md bg-blue-50/70 p-2 text-[11px] italic text-blue-600">
                  Waiting for result...
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function ToolUIRegistration({
  toolName,
  onNavigateToRange,
}: {
  toolName: (typeof SPREADSHEET_TOOL_NAMES)[number];
  onNavigateToRange?: (input: { range: string; sheetId: number | null }) => void;
}) {
  function SpreadsheetCreateSheetSideEffect({ result }: { result?: unknown }) {
    const { runExcel, refreshSnapshot } = useExcelContext();
    const hasResult = result !== undefined;
    const parsedResult = React.useMemo(
      () => extractParsedToolResult(result),
      [result],
    );
    const createdSheetId = React.useMemo(
      () => getCreatedSheetIdFromToolResult(parsedResult),
      [parsedResult],
    );
    const hasResultRef = React.useRef(hasResult);

    React.useEffect(() => {
      const hadResult = hasResultRef.current;
      hasResultRef.current = hasResult;

      if (hadResult || !hasResult || createdSheetId === null) {
        return;
      }

      void runExcel(async (context) => {
        const worksheets = context.workbook.worksheets;
        worksheets.load("items/position");
        await context.sync();

        const target = worksheets.items.find(
          (sheet) => sheet.position + 1 === createdSheetId,
        );
        if (!target) return;

        target.activate();
        await context.sync();
      })
        .then(() => refreshSnapshot())
        .catch(() => {
          // Ignore side effect errors.
        });
    }, [createdSheetId, hasResult, refreshSnapshot, runExcel]);

    return null;
  }

  const toolUI = React.useMemo<
    AssistantToolUIProps<Record<string, unknown>, unknown>
  >(
    () => ({
      toolName,
      render(
        toolPartProps: ToolCallMessagePartProps<Record<string, unknown>, unknown>,
      ) {
        return (
          <div className="w-full maxx-w-md">
            {toolPartProps.toolName === "spreadsheet_createSheet" && (
              <SpreadsheetCreateSheetSideEffect result={toolPartProps.result} />
            )}
            <ToolCallDisplay
              toolName={toolPartProps.toolName}
              args={toolPartProps.args}
              result={toolPartProps.result}
              onNavigateToRange={onNavigateToRange}
            />
          </div>
        );
      },
    }),
    [onNavigateToRange, toolName],
  );

  useAssistantToolUI(toolUI);
  return null;
}

export function ToolUIRegistry({
  onNavigateToRange,
}: {
  onNavigateToRange?: (input: { range: string; sheetId: number | null }) => void;
}) {
  return SPREADSHEET_TOOL_NAMES.map((toolName) => (
    <ToolUIRegistration
      key={toolName}
      toolName={toolName}
      onNavigateToRange={onNavigateToRange}
    />
  ));
}

export function AssistantMessage() {
  const role = useMessage((message) => message.role);
  const userMessageText = useMessage((message) =>
    message.role !== "user"
      ? ""
      : message.content
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("")
          .trim(),
  );
  const isLastMessage = useAuiState(({ message }) => message.isLast);
  const isThreadRunning = useThread((thread) => thread.isRunning);
  const isComplete = useMessage(
    (message) => message.status?.type === "complete",
  );
  const hasAnyVisibleReasoning = useAuiState(({ message }) =>
    message.content.some(
      (part) =>
        part.type === "reasoning" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0,
    ),
  );
  const hasAnyToolCall = useAuiState(({ message }) =>
    message.content.some((part) => part.type === "tool-call"),
  );
  const hasAnyVisibleText = useAuiState(({ message }) =>
    message.content.some(
      (part) =>
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0,
    ),
  );
  const showTypingIndicatorBeforeText =
    role === "assistant" &&
    isLastMessage &&
    isThreadRunning &&
    !hasAnyVisibleReasoning &&
    !hasAnyToolCall &&
    !hasAnyVisibleText;
  const showRunningLoadingSpinner =
    role === "assistant" &&
    isLastMessage &&
    isThreadRunning &&
    !showTypingIndicatorBeforeText &&
    (hasAnyVisibleReasoning || hasAnyToolCall || hasAnyVisibleText);
  const [isUserCopySuccess, setIsUserCopySuccess] = React.useState(false);
  const handleCopyUserMessage = React.useCallback(async () => {
    if (!userMessageText) return;
    try {
      await navigator.clipboard.writeText(userMessageText);
      setIsUserCopySuccess(true);
      setTimeout(() => setIsUserCopySuccess(false), 1500);
    } catch {
      // Ignore clipboard failures.
    }
  }, [userMessageText]);

  return (
    <MessagePrimitive.Root
      className={
        role === "user" ? "ml-8 flex justify-end" : "mr-8 flex justify-start"
      }
    >
      <div
        className={cn(
          "flex w-full flex-col gap-2",
          role === "user" ? "items-end" : "",
        )}
      >
        {role === "assistant" &&
          (hasAnyVisibleReasoning || hasAnyVisibleText || hasAnyToolCall) && (
            <MessagePrimitive.Content
              components={{
                Text: AssistantTextPart,
                Reasoning: () => (
                  <div className="mt-2 rounded-lg border border-purple-100 bg-purple-50/50 p-3 text-xs text-purple-900/80">
                    <MarkdownText />
                  </div>
                ),
                ReasoningGroup: ({ children }: React.PropsWithChildren) => (
                  <div className="w-fit max-w-[92%]">
                    <ReasoningBlock forceOpen={!isComplete}>
                      {children}
                    </ReasoningBlock>
                  </div>
                ),
                ToolGroup: ({ children }: React.PropsWithChildren) => (
                  <div className="w-full space-y-2">{children}</div>
                ),
              }}
            />
          )}
        {role === "assistant" && showTypingIndicatorBeforeText && (
          <Card className="rnc-assistant-bubble-ai w-fit border-black/10 bg-[#fff7f1]">
            <CardContent className="py-2 px-3">
              <div className="prose overflow-hidden text-sm text-foreground">
                <TypingIndicator />
              </div>
            </CardContent>
          </Card>
        )}
        {role === "assistant" && showRunningLoadingSpinner && (
          <Card className="rnc-assistant-bubble-ai w-fit border-black/10 bg-[#fff7f1]">
            <CardContent className="py-2 px-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </CardContent>
          </Card>
        )}
        {role === "user" && (
          <div className="flex max-w-[85%] flex-col items-end gap-1">
            <Card className="rnc-assistant-bubble-user w-fit max-w-full border-black/10 bg-foreground text-white">
              <CardContent className="py-2 px-3">
                <div className="whitespace-normal break-words text-sm leading-6 text-white/90">
                  <MessagePrimitive.Content
                    components={{
                      Text: MarkdownText,
                    }}
                  />
                </div>
              </CardContent>
            </Card>
            <IconButton
              tooltip="Copy"
              type="button"
              onClick={handleCopyUserMessage}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-black/5 hover:text-foreground"
              title="Copy message"
              aria-label="Copy message"
            >
              {isUserCopySuccess ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </IconButton>
          </div>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

type QueuedComposerMessage = {
  id: string;
  text: string;
};

export type AssistantComposerProps = {
  selectedModel: string;
  selectedModelLabel: string;
  isModelPickerOpen: boolean;
  setIsModelPickerOpen: (open: boolean) => void;
  setSelectedModel: (model: string) => void;
  reasoningEnabled: boolean;
  setReasoningEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  reasoningEnabledRef: React.MutableRefObject<boolean>;
  forceCompactHeader?: boolean;
  remainingCredits: number | null;
  isUnlimitedCredits: boolean;
  isCreditsLoading: boolean;
};

const MODEL_PICKER_HIDE_WIDTH = 460;

export function AssistantComposer({
  selectedModel,
  selectedModelLabel,
  isModelPickerOpen,
  setIsModelPickerOpen,
  setSelectedModel,
  reasoningEnabled,
  setReasoningEnabled,
  reasoningEnabledRef,
  forceCompactHeader = false,
  remainingCredits,
  isUnlimitedCredits,
  isCreditsLoading,
}: AssistantComposerProps) {
  const composerFooterRef = React.useRef<HTMLDivElement | null>(null);
  const [isComposerCompact, setIsComposerCompact] =
    React.useState(forceCompactHeader);
  const handleSelectModel = React.useCallback(
    (model: string) => {
      setSelectedModel(model);
      setIsModelPickerOpen(false);
    },
    [setIsModelPickerOpen, setSelectedModel],
  );
  const composerRuntime = useComposerRuntime();
  const threadRuntime = useThreadRuntime();
  const isThreadRunning = useThread((thread) => thread.isRunning);
  const hasCredits =
    isUnlimitedCredits ||
    remainingCredits === null ||
    remainingCredits >= MIN_CREDITS_PER_RUN;
  const canSendFromComposer = useComposer(
    (composer) => composer.isEditing && !composer.isEmpty,
  );
  const [queuedMessages, setQueuedMessages] = React.useState<
    QueuedComposerMessage[]
  >([]);
  const queuedMessagesRef = React.useRef<QueuedComposerMessage[]>([]);
  const hasQueuedDispatchRef = React.useRef(false);

  React.useEffect(() => {
    queuedMessagesRef.current = queuedMessages;
  }, [queuedMessages]);

  React.useEffect(() => {
    if (forceCompactHeader) {
      setIsComposerCompact(true);
      return;
    }

    const footer = composerFooterRef.current;
    if (!footer) return;

    const updateComposerWidthState = () => {
      const { width } = footer.getBoundingClientRect();
      setIsComposerCompact(width < MODEL_PICKER_HIDE_WIDTH);
    };

    updateComposerWidthState();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateComposerWidthState);
      return () => {
        window.removeEventListener("resize", updateComposerWidthState);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateComposerWidthState();
    });
    resizeObserver.observe(footer);

    return () => {
      resizeObserver.disconnect();
    };
  }, [forceCompactHeader]);

  const enqueueCurrentComposerMessage = React.useCallback(() => {
    const message = composerRuntime.getState().text.trim();
    if (!message) return false;

    setQueuedMessages((previous) => [
      { id: uuidString(), text: message },
      ...previous,
    ]);
    composerRuntime.setText("");
    return true;
  }, [composerRuntime]);

  const handleRemoveQueuedMessage = React.useCallback((messageId: string) => {
    setQueuedMessages((previous) =>
      previous.filter((queuedMessage) => queuedMessage.id !== messageId),
    );
  }, []);

  const handleSendOrQueue = React.useCallback(() => {
    if (isThreadRunning) {
      enqueueCurrentComposerMessage();
      return;
    }

    if (!canSendFromComposer || !hasCredits) return;
    composerRuntime.send();
  }, [
    canSendFromComposer,
    composerRuntime,
    enqueueCurrentComposerMessage,
    hasCredits,
    isThreadRunning,
  ]);

  const handleStopRun = React.useCallback(() => {
    if (!isThreadRunning) return;
    threadRuntime.cancelRun();
  }, [isThreadRunning, threadRuntime]);

  const handleQueueOnEnter = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isThreadRunning) return;
      if (
        event.nativeEvent.isComposing ||
        event.key !== "Enter" ||
        event.shiftKey
      ) {
        return;
      }

      event.preventDefault();
      enqueueCurrentComposerMessage();
    },
    [enqueueCurrentComposerMessage, isThreadRunning],
  );

  React.useEffect(() => {
    if (isThreadRunning) {
      hasQueuedDispatchRef.current = false;
      return;
    }

    if (hasQueuedDispatchRef.current) return;

    const nextMessage = queuedMessagesRef.current.at(-1);
    if (!nextMessage) return;

    const remainingMessages = queuedMessagesRef.current.slice(0, -1);
    hasQueuedDispatchRef.current = true;
    queuedMessagesRef.current = remainingMessages;
    setQueuedMessages(remainingMessages);
    threadRuntime.append({
      content: [{ type: "text", text: nextMessage.text }],
      runConfig: composerRuntime.getState().runConfig,
      startRun: true,
    });
  }, [composerRuntime, isThreadRunning, threadRuntime]);

  return (
    <ComposerPrimitive.Root className="rnc-assistant-composer overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
      {queuedMessages.length > 0 && (
        <div className="rnc-assistant-muted-surface max-h-32 overflow-y-auto border-b border-black/8 bg-[#fff9f4] px-3 py-2">
          <div className="space-y-2">
            {queuedMessages.map((queuedMessage) => (
              <div
                key={queuedMessage.id}
                className="rnc-assistant-item flex items-center gap-2 rounded-lg border border-black/10 bg-white px-2 py-1.5"
              >
                <p className="flex-1 text-xs leading-5 text-foreground">
                  {queuedMessage.text}
                </p>
                <IconButton
                  tooltip="Remove queued message"
                  type="button"
                  onClick={() => handleRemoveQueuedMessage(queuedMessage.id)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-black/5 hover:text-foreground"
                  title="Remove queued message"
                  aria-label="Remove queued message"
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="px-4 pt-4">
        <ComposerPrimitive.Input
          rows={3}
          onKeyDown={handleQueueOnEnter}
          placeholder="Type to start sending a message"
          className="min-h-10 w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-foreground outline-none transition placeholder:text-[#7e8da7] focus-visible:ring-0 sm:min-h-14"
        />
      </div>
      <div
        ref={composerFooterRef}
        className="flex items-center justify-between border-t border-black/8 px-3 py-2"
      >
        <div className="flex items-center gap-2">
          {isComposerCompact ? (
            <Popover
              open={isModelPickerOpen}
              onOpenChange={setIsModelPickerOpen}
            >
              <PopoverTrigger asChild>
                <IconButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  role="combobox"
                  aria-expanded={isModelPickerOpen}
                  aria-label={`Select model. Current model: ${selectedModelLabel}`}
                  title={`Model: ${selectedModelLabel}`}
                  className="rnc-assistant-chip h-8 justify-between rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2]"
                >
                  <Cpu className="h-3.5 w-3.5" />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-0">
                <Command>
                  <CommandInput placeholder="Search model..." />
                  <CommandList>
                    <CommandEmpty>No model found.</CommandEmpty>
                    {MODEL_OPTION_GROUPS.map((group) => (
                      <CommandGroup key={group.label} heading={group.label}>
                        {group.options.map((option) => (
                          <CommandItem
                            key={option.value}
                            value={`${option.label} ${option.value} ${group.label}`}
                            onSelect={() => handleSelectModel(option.value)}
                            className="text-xs"
                          >
                            <Check
                              className={cn(
                                "h-3.5 w-3.5 shrink-0",
                                selectedModel === option.value
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <span className="truncate">{option.label}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          ) : (
            <label className="flex items-center gap-2 text-xs text-(--muted-foreground)">
              <span className="uppercase tracking-[0.16em]">Model</span>
              <Popover
                open={isModelPickerOpen}
                onOpenChange={setIsModelPickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    role="combobox"
                    aria-expanded={isModelPickerOpen}
                    aria-label="Select model"
                    className="rnc-assistant-chip h-8 min-w-40 justify-between rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-[#f6ede2]"
                  >
                    <span className="truncate">{selectedModelLabel}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-0">
                  <Command>
                    <CommandInput placeholder="Search model..." />
                    <CommandList>
                      <CommandEmpty>No model found.</CommandEmpty>
                      {MODEL_OPTION_GROUPS.map((group) => (
                        <CommandGroup key={group.label} heading={group.label}>
                          {group.options.map((option) => (
                            <CommandItem
                              key={option.value}
                              value={`${option.label} ${option.value} ${group.label}`}
                              onSelect={() => handleSelectModel(option.value)}
                              className="text-xs"
                            >
                              <Check
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0",
                                  selectedModel === option.value
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <span className="truncate">{option.label}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </label>
          )}
          <IconButton
            tooltip={reasoningEnabled ? "Reasoning On" : "Reasoning Off"}
            variant="unstyled"
            type="button"
            onClick={() =>
              setReasoningEnabled((previous) => {
                const next = !previous;
                reasoningEnabledRef.current = next;
                return next;
              })
            }
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-none transition",
              reasoningEnabled
                ? "border-(--panel-border-strong) bg-(--assistant-chip-hover) text-foreground hover:bg-(--assistant-suggestion-hover) hover:text-foreground"
                : "rnc-assistant-chip border-(--panel-border) bg-(--assistant-chip-bg) text-(--muted-foreground) hover:bg-(--assistant-chip-hover) hover:text-foreground",
            )}
            aria-label={`Reasoning ${reasoningEnabled ? "on" : "off"}`}
            title={reasoningEnabled ? "Reasoning On" : "Reasoning Off"}
          >
            <Sparkles
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                reasoningEnabled
                  ? "text-(--accent)"
                  : "text-(--muted-foreground)",
              )}
            />
          </IconButton>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rnc-assistant-chip inline-flex h-8 items-center rounded-lg border border-black/10 bg-[#faf6f0] px-2.5 text-[10px] uppercase tracking-[0.12em] text-(--muted-foreground)"
            title="Remaining credits"
          >
            {isCreditsLoading
              ? "Credits ..."
              : isUnlimitedCredits
                ? "Credits Unlimited"
                : `Credits ${remainingCredits ?? 0}/${INITIAL_CREDITS}`}
          </span>
          {isThreadRunning && (
            <IconButton
              tooltip="Stop"
              onClick={handleStopRun}
              className="rnc-assistant-stop inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-[#fff1ee] text-[#c23f2c] shadow-none transition hover:bg-[#ffe5df]"
              title="Stop"
              aria-label="Stop"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </IconButton>
          )}
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={handleSendOrQueue}
            aria-label={isThreadRunning ? "Queue message" : "Send message"}
            disabled={!canSendFromComposer || !hasCredits}
            className={cn(
              "h-9 w-9 rounded-xl bg-(--accent) p-0 text-(--accent-foreground) shadow-[0_8px_20px_rgba(255,109,52,0.22)] hover:bg-(--accent-strong) focus-visible:ring-(--ring)",
              "disabled:bg-(--assistant-chip-bg) disabled:text-(--muted-foreground) disabled:shadow-none disabled:opacity-100",
            )}
          >
            <SendHorizontal
              aria-hidden="true"
              className="h-4 w-4 shrink-0 stroke-[2.2]"
            />
          </Button>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}
