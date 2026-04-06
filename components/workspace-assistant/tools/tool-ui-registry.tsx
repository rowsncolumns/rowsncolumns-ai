import type {
  AssistantToolUIProps,
  ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { useAssistantToolUI, useInlineRender } from "@assistant-ui/react";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
  useNavigateToSheetRange,
  useSpreadsheetApi,
} from "@rowsncolumns/spreadsheet";
import { addressToSheetRange } from "@rowsncolumns/utils";
import {
  Check,
  ChevronDown,
  Copy,
  FileText,
  Info,
  Loader2,
  Navigation,
  X,
} from "lucide-react";
import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
// import { useSetHighlights } from "@/hooks/use-highlights"; // TODO: Enable when highlight tool is working

import { getToolCopy } from "./tool-copy";
import {
  deepParseJsonValue,
  extractParsedToolResult,
  getCreatedSheetIdFromToolResult,
  getRangeFromParsedToolArgs,
  getSheetIdFromParsedToolArgs,
  isRecord,
  isUnavailableToolArgs,
  parseAskUserQuestionsFromArgs,
  parseConfirmPlanExecutionFromArgs,
} from "./tool-utils";
import {
  AskUserQuestionToolCard,
  ConfirmPlanExecutionToolCard,
} from "./tool-cards";

function ToolCallDisplay({
  toolCallId,
  toolName,
  args,
  result,
  addResult,
}: {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  addResult?: ToolCallMessagePartProps<
    Record<string, unknown>,
    unknown
  >["addResult"];
}) {
  const openStateKey = React.useMemo(() => `tool:${toolCallId}`, [toolCallId]);
  const [isOpen, setIsOpen] = React.useState(() => {
    return TOOL_CALL_OPEN_STATE.get(openStateKey) ?? false;
  });
  const [copiedTab, setCopiedTab] = React.useState<"input" | "output" | null>(
    null,
  );
  const hasResult = result !== undefined;
  const navigateToSheetRange = useNavigateToSheetRange();

  const handleCopy = React.useCallback(
    async (content: string, tab: "input" | "output") => {
      try {
        await navigator.clipboard.writeText(content);
        setCopiedTab(tab);
        setTimeout(() => setCopiedTab(null), 2000);
      } catch {
        // Ignore clipboard errors
      }
    },
    [],
  );

  // Extract the actual content from various result formats
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
  const parsedArgs = React.useMemo(() => deepParseJsonValue(args), [args]);
  const askUserQuestions = React.useMemo(
    () =>
      toolName === "assistant_askUserQuestion"
        ? parseAskUserQuestionsFromArgs(parsedArgs)
        : null,
    [parsedArgs, toolName],
  );
  const confirmPlanExecution = React.useMemo(
    () =>
      toolName === "assistant_confirmPlanExecution"
        ? parseConfirmPlanExecutionFromArgs(parsedArgs)
        : null,
    [parsedArgs, toolName],
  );
  const toolCopy = React.useMemo(
    () => getToolCopy(toolName, parsedArgs as Record<string, unknown>),
    [toolName, parsedArgs],
  );
  const titleText = isRunning
    ? toolCopy.running
    : isError
      ? toolCopy.failed
      : toolCopy.success;
  const rangeFromArgs = getRangeFromParsedToolArgs(parsedArgs);
  const rangeFromResult =
    typeof extractedResult?.range === "string" ? extractedResult.range : null;
  const sheetIdFromArgs = getSheetIdFromParsedToolArgs(parsedArgs);
  const sheetIdFromResult = getSheetIdFromParsedToolArgs(extractedResult);
  const sheetRange = React.useMemo(() => {
    const rangeForNavigation = rangeFromArgs || rangeFromResult;
    const sheetId = sheetIdFromArgs ?? sheetIdFromResult;

    if (!rangeForNavigation || sheetId === null) {
      return null;
    }

    return addressToSheetRange(rangeForNavigation, sheetId) ?? null;
  }, [rangeFromArgs, rangeFromResult, sheetIdFromArgs, sheetIdFromResult]);

  const canNavigateToRange = Boolean(navigateToSheetRange && sheetRange);

  const navigateToRange = React.useCallback(() => {
    if (!navigateToSheetRange || !sheetRange) {
      return;
    }

    navigateToSheetRange(sheetRange, {
      allowSelection: false,
      enableFlash: true,
    });
  }, [navigateToSheetRange, sheetRange]);
  const handleNavigateInlineClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      navigateToRange();
    },
    [navigateToRange],
  );
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
      TOOL_CALL_OPEN_STATE.set(openStateKey, nextOpen);
    },
    [openStateKey],
  );

  React.useEffect(() => {
    setIsOpen(TOOL_CALL_OPEN_STATE.get(openStateKey) ?? false);
  }, [openStateKey]);

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

  if (
    toolName === "assistant_askUserQuestion" &&
    !hasResult &&
    askUserQuestions &&
    askUserQuestions.length > 0
  ) {
    return (
      <AskUserQuestionToolCard
        toolCallId={toolCallId}
        questions={askUserQuestions}
        addResult={addResult}
      />
    );
  }

  if (
    toolName === "assistant_confirmPlanExecution" &&
    !hasResult &&
    confirmPlanExecution
  ) {
    return (
      <ConfirmPlanExecutionToolCard
        toolCallId={toolCallId}
        plan={confirmPlanExecution}
        addResult={addResult}
      />
    );
  }

  return (
    <Collapsible.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Collapsible.Trigger asChild>
        <div
          className={cn(
            "inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors",
            isRunning
              ? "border-(--card-border) bg-(--assistant-chip-bg) text-foreground hover:bg-(--assistant-chip-hover)"
              : isError
                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                : "border-(--card-border) bg-(--assistant-chip-bg) text-foreground hover:bg-(--assistant-chip-hover)",
          )}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-violet-500" />
          <div className="min-w-0 flex-1 truncate">{titleText}</div>
          {range && (
            <span
              className="max-w-28 shrink-0 truncate rounded border border-(--card-border) bg-(--assistant-chip-hover) px-1.5 py-0.5 font-mono text-[10px] text-(--muted-foreground)"
              title={`Range: ${range}`}
            >
              {range}
            </span>
          )}
          {explanation && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-(--muted-foreground)">
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                className="max-w-xs text-xs whitespace-pre-wrap break-words"
              >
                {explanation}
              </TooltipContent>
            </Tooltip>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-(--muted-foreground) transition-transform",
              isOpen && "rotate-180",
            )}
          />
          <span className="h-3.5 w-px shrink-0 bg-(--card-border)" />
          {isComplete && canNavigateToRange && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleNavigateInlineClick}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-(--muted-foreground) transition-colors hover:bg-(--assistant-chip-hover) hover:text-foreground"
                  aria-label="Go to range"
                >
                  <Navigation className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" align="center" className="text-xs">
                Go to range
              </TooltipContent>
            </Tooltip>
          )}
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-(--muted-foreground)" />
          ) : isError ? (
            <X className="h-3.5 w-3.5 shrink-0 text-red-600" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          )}
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse data-[state=open]:animate-expand">
        {explanation && (
          <div className="mt-1.5 rounded-md border border-(--panel-border) bg-(--assistant-suggestion-bg) px-2 py-1.5">
            <p className="text-xs leading-relaxed text-foreground">
              {explanation}
            </p>
          </div>
        )}
        {isError && (
          <div className="mt-1 rounded border border-red-200 bg-red-100 p-2 text-red-800 text-xs">
            <div className="font-medium">Error</div>
            <div className="mt-1 font-mono text-[11px]">
              {errorMessage || "Unknown error"}
            </div>
          </div>
        )}
        <Tabs defaultValue="input" className="mt-2">
          <TabsList className="inline-flex h-7 gap-1 rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) p-0.5">
            <TabsTrigger
              value="input"
              className="h-6 rounded-md px-2.5 py-0.5 text-[10px] font-medium text-(--muted-foreground) transition-colors data-[state=active]:bg-(--assistant-tabs-active-bg) data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_2px_var(--card-shadow)]"
            >
              Input
            </TabsTrigger>
            <TabsTrigger
              value="output"
              className="h-6 rounded-md px-2.5 py-0.5 text-[10px] font-medium text-(--muted-foreground) transition-colors data-[state=active]:bg-(--assistant-tabs-active-bg) data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_2px_var(--card-shadow)]"
            >
              Output
            </TabsTrigger>
          </TabsList>
          <TabsContent value="input" className="mt-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => handleCopy(formattedArgs, "input")}
                className="absolute right-1 top-1 rounded p-1 text-(--muted-foreground) transition-colors hover:bg-(--assistant-chip-hover) hover:text-foreground"
                title="Copy to clipboard"
              >
                {copiedTab === "input" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-md border border-(--card-border) bg-(--card-bg-subtle) p-2 pr-8 font-mono text-[11px] leading-relaxed text-foreground">
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
                    handleCopy(
                      JSON.stringify(extractedResult, null, 2),
                      "output",
                    )
                  }
                  className={cn(
                    "absolute right-1 top-1 rounded p-1 transition-colors",
                    "text-(--muted-foreground) hover:bg-(--assistant-chip-hover) hover:text-foreground",
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
                <pre className="max-h-64 overflow-y-auto overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-md border border-(--card-border) bg-(--card-bg-subtle) p-2 pr-8 font-mono text-[11px] leading-relaxed text-foreground">
                  {JSON.stringify(extractedResult, null, 2)}
                </pre>
              ) : (
                <div className="rounded-md border border-(--card-border) bg-(--card-bg-subtle) p-2 text-[11px] text-(--muted-foreground) italic">
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

function SpreadsheetCreateSheetSideEffect({ result }: { result?: unknown }) {
  const spreadsheetApi = useSpreadsheetApi();
  const hasResult = result !== undefined;
  const parsedResult = React.useMemo(
    () => extractParsedToolResult(result),
    [result],
  );
  const createdSheetId = React.useMemo(
    () => getCreatedSheetIdFromToolResult(parsedResult),
    [parsedResult],
  );
  // Start with false so first effect run with a result will execute
  const hasResultRef = React.useRef(false);

  React.useEffect(() => {
    const hadResult = hasResultRef.current;
    hasResultRef.current = hasResult;

    if (hadResult || !hasResult || createdSheetId === null) {
      return;
    }

    spreadsheetApi?.setActiveSheet(createdSheetId);
  }, [createdSheetId, hasResult, spreadsheetApi]);

  return null;
}

/* TODO: Enable when highlight tool is working
function SpreadsheetHighlightSideEffect({ result }: { result?: unknown }) {
  const setHighlights = useSetHighlights();
  const hasResult = result !== undefined;
  const parsedResult = React.useMemo(
    () => extractParsedToolResult(result),
    [result],
  );
  // Start with false so first effect run with a result will execute
  const hasResultRef = React.useRef(false);

  React.useEffect(() => {
    const hadResult = hasResultRef.current;
    hasResultRef.current = hasResult;

    if (hadResult || !hasResult || !parsedResult?.success) {
      return;
    }

    if (parsedResult.action === "clear") {
      setHighlights([]);
      return;
    }

    if (
      parsedResult.action === "create" &&
      Array.isArray(parsedResult.highlights)
    ) {
      setHighlights(parsedResult.highlights);
    }
  }, [hasResult, parsedResult, setHighlights]);

  return null;
}
*/

export const SPREADSHEET_TOOL_NAMES = [
  "spreadsheet_changeBatch",
  "spreadsheet_sheet", // Consolidated: create/update/delete sheet
  "spreadsheet_getSheetMetadata",
  "spreadsheet_formatRange",
  "spreadsheet_modifyRowsCols",
  "spreadsheet_queryRange",
  "spreadsheet_setIterativeMode",
  "spreadsheet_readDocument",
  "spreadsheet_getRowColMetadata",
  "spreadsheet_setRowColMetadata",
  "spreadsheet_applyFill",
  // Consolidated tools
  "spreadsheet_note",
  "spreadsheet_clearCells",
  "spreadsheet_table",
  "spreadsheet_chart",
  "spreadsheet_dataValidation",
  "spreadsheet_conditionalFormat",
  "spreadsheet_getAuditSnapshot",
  // "spreadsheet_highlight", // TODO: Enable when highlight tool is working
  "assistant_requestModeSwitch",
  "assistant_askUserQuestion",
  "assistant_confirmPlanExecution",
  "web_search",
] as const;

const TOOL_CALL_OPEN_STATE = new Map<string, boolean>();

function SpreadsheetToolUIRegistration({
  toolName,
}: {
  toolName: (typeof SPREADSHEET_TOOL_NAMES)[number];
}) {
  const renderToolPart = useInlineRender(
    ({
      toolName: renderedToolName,
      args,
      result,
      toolCallId,
      addResult,
    }: ToolCallMessagePartProps<Record<string, unknown>, unknown>) => {
      // Parse args (handles JSON strings in 'input' field)
      const parsedArgs = deepParseJsonValue(args);
      const resolvedArgs =
        isRecord(parsedArgs) && isRecord(parsedArgs.input)
          ? parsedArgs.input
          : parsedArgs;
      const action = isRecord(resolvedArgs) ? resolvedArgs.action : undefined;

      return (
        <div className="w-full maxx-w-md">
          {renderedToolName === "spreadsheet_sheet" && action === "create" && (
            <SpreadsheetCreateSheetSideEffect result={result} />
          )}
          {/* TODO: Enable when highlight tool is working
          {renderedToolName === "spreadsheet_highlight" && (
            <SpreadsheetHighlightSideEffect result={result} />
          )}
          */}
          <ToolCallDisplay
            toolCallId={toolCallId}
            toolName={renderedToolName}
            args={args}
            result={result}
            addResult={addResult}
          />
        </div>
      );
    },
  );

  const toolUI = React.useMemo<
    AssistantToolUIProps<Record<string, unknown>, unknown>
  >(
    () => ({
      toolName,
      render: renderToolPart,
    }),
    [renderToolPart, toolName],
  );

  useAssistantToolUI(toolUI);
  return null;
}

export function SpreadsheetToolUIRegistry() {
  return SPREADSHEET_TOOL_NAMES.map((toolName) => (
    <SpreadsheetToolUIRegistration key={toolName} toolName={toolName} />
  ));
}
