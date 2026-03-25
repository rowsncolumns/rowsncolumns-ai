import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import ShareDBClient from "sharedb/lib/client";
import "@rowsncolumns/spreadsheet/dist/spreadsheet.min.css";
import { functionDescriptions, functions } from "@rowsncolumns/functions";
import { exportToCSV, exportToExcel } from "@rowsncolumns/toolkit";
import {
  ButtonBold,
  ButtonItalic,
  ButtonRedo,
  ButtonUndo,
  ButtonUnderline,
  BottomBar,
  CanvasGrid,
  FontFamilySelector,
  FontSizeSelector,
  NewSheetButton,
  SheetStatus,
  SheetSwitcher,
  SheetTabs,
  SpreadsheetProvider,
  Toolbar,
  ToolbarSeparator,
  createNewSheet,
  defaultSpreadsheetTheme,
  type CellData,
  type ColorMode,
  type ConditionalFormatRule,
  type DataValidationRuleRecord,
  type EmbeddedChart,
  type EmbeddedObject,
  type NamedRange,
  type PivotTable,
  type ProtectedRange,
  type Sheet,
  type SpreadsheetTheme,
  type TableView,
  SlicerComponentProps,
  SlicerComponent,
  Slicer,
  FormulaBar,
  RangeSelector,
  BackgroundColorSelector,
  BorderSelector,
  ButtonClearFormatting,
  ButtonCopyToClipboard,
  ButtonDecreaseDecimal,
  ButtonDecreaseIndent,
  ButtonFormatCurrency,
  ButtonFormatPercent,
  ButtonIncreaseDecimal,
  ButtonIncreaseIndent,
  ButtonInsertImage,
  ButtonPaintFormat,
  ButtonPrint,
  ButtonStrikethrough,
  ButtonSwitchColorMode,
  CellStyleSelector,
  FormulaBarInput,
  FormulaBarLabel,
  GridFooter,
  InsertMenu,
  MergeCellsSelector,
  ScaleSelector,
  TableStyleSelector,
  TextColorSelector,
  TextFormatSelector,
  TextHorizontalAlignSelector,
  TextVerticalAlignSelector,
  TextWrapSelector,
  ThemeSelector,
  SheetSearch,
  LoadingIndicator,
  useSpreadsheetApi,
  useLoadingIndicator,
} from "@rowsncolumns/spreadsheet";
import {
  selectionFromActiveCell,
  type CellInterface,
} from "@rowsncolumns/grid";
import {
  CellFormatEditor,
  CellFormatEditorDialog,
  ConditionalFormatDialog,
  ConditionalFormatEditor,
  DataValidationEditor,
  DataValidationEditorDialog,
  DeleteSheetConfirmation,
  EmbedEditor,
  EmbedEditorDialog,
  ErrorStateDialog,
  InsertImageDialog,
  InsertImageEditor,
  InsertLinkDialog,
  InsertLinkEditor,
  NamedRangeEditor,
  pattern_currency_decimal,
  pattern_percent_decimal,
  ResizeDimensionEditor,
  TableEditor,
  useSearch,
  useSpreadsheetState,
} from "@rowsncolumns/spreadsheet-state";
import type {
  CellXfs,
  SharedStrings,
  SheetData,
} from "@rowsncolumns/spreadsheet-state";
import { useShareDBSpreadsheet } from "@rowsncolumns/sharedb";
import {
  ChartEditor,
  ChartEditorDialog,
  useCharts,
  ChartComponent,
} from "@rowsncolumns/charts";
import { Citation } from "@rowsncolumns/common-types";
import {
  CircularLoader,
  IconButton,
  Separator,
  useIsomorphicLayoutEffect,
} from "@rowsncolumns/ui";
import { FileMenu } from "@/components/file-menu";
import { toggleThemeMode } from "@/lib/theme-preference";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";

type WidgetConfig = {
  shareDbUrl?: string | null;
  shareDbPort?: string | null;
  appBaseUrl?: string | null;
  locale?: string | null;
  currency?: string | null;
};

type ToolPayload = {
  docId?: string;
  sheetId?: number;
  url?: string;
  locale?: string;
  currency?: string;
};

type InitialDocState = {
  docId: string | null;
  docUrl: string | null;
  openUrl: string | null;
  meta: string;
  locale: string;
  currency: string;
};

type UiStateSyncPayload = {
  docId: string;
  activeSheetId?: number;
  activeCell?: { rowIndex: number; columnIndex: number };
  selections?: Array<{
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  }>;
  locale?: string;
  currency?: string;
};

type ShareDBSocket = ConstructorParameters<typeof ShareDBClient.Connection>[0];

declare global {
  interface Window {
    __RNC_MCP_WIDGET_CONFIG__?: WidgetConfig;
  }
}

const initialSheets = [
  createNewSheet(1, "Sheet1"),
  createNewSheet(2, "Sheet2"),
];

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readInteger = (value: unknown): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value as number);
};

const parseToolPayload = (value: unknown): ToolPayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const asRecord = value as Record<string, unknown>;
  return {
    docId: readString(asRecord.docId) ?? undefined,
    sheetId:
      asRecord.sheetId === undefined
        ? undefined
        : (readInteger(asRecord.sheetId) ?? undefined),
    url: readString(asRecord.url) ?? undefined,
    locale: readString(asRecord.locale) ?? undefined,
    currency: readString(asRecord.currency) ?? undefined,
  };
};

const serializeSelections = (
  selections: Array<{ range?: unknown }>,
): UiStateSyncPayload["selections"] => {
  const result: NonNullable<UiStateSyncPayload["selections"]> = [];
  for (const selection of selections) {
    const range = selection?.range as
      | {
          startRowIndex?: unknown;
          endRowIndex?: unknown;
          startColumnIndex?: unknown;
          endColumnIndex?: unknown;
        }
      | undefined;
    if (!range) continue;
    const startRowIndex = readInteger(range.startRowIndex);
    const endRowIndex = readInteger(range.endRowIndex);
    const startColumnIndex = readInteger(range.startColumnIndex);
    const endColumnIndex = readInteger(range.endColumnIndex);
    if (
      startRowIndex === null ||
      endRowIndex === null ||
      startColumnIndex === null ||
      endColumnIndex === null
    ) {
      continue;
    }
    result.push({
      startRowIndex,
      endRowIndex,
      startColumnIndex,
      endColumnIndex,
    });
  }
  return result;
};

const resolveDocOpenUrl = ({
  docId,
  sheetId,
  explicitUrl,
  appBaseUrl,
}: {
  docId: string;
  sheetId?: number;
  explicitUrl?: string | null;
  appBaseUrl?: string | null;
}): string | null => {
  const explicit = readString(explicitUrl ?? null);
  if (explicit) {
    return explicit;
  }

  const base = readString(appBaseUrl ?? null);
  if (!base) {
    return null;
  }

  try {
    const next = new URL(`/mcp/doc/${encodeURIComponent(docId)}`, base);
    if (sheetId !== undefined) {
      next.searchParams.set("sheetId", String(sheetId));
    }
    return next.toString();
  } catch {
    return null;
  }
};

const getInitialDocState = (config: WidgetConfig): InitialDocState => {
  const defaultLocale = readString(config.locale ?? null) ?? "en-US";
  const defaultCurrency = readString(config.currency ?? null) ?? "USD";

  if (typeof window === "undefined") {
    return {
      docId: null,
      docUrl: null,
      openUrl: null,
      meta: "Run open_spreadsheet to load a spreadsheet.",
      locale: defaultLocale,
      currency: defaultCurrency,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const docId = readString(params.get("docId"));
  const docUrl = readString(params.get("url"));
  const sheetParam = readString(params.get("sheetId"));
  const sheetId = sheetParam === null ? null : readInteger(Number(sheetParam));
  const locale = readString(params.get("locale")) ?? defaultLocale;
  const currency = readString(params.get("currency")) ?? defaultCurrency;
  if (!docId) {
    return {
      docId: null,
      docUrl: null,
      openUrl: null,
      meta: "Run open_spreadsheet to load a spreadsheet.",
      locale,
      currency,
    };
  }

  return {
    docId,
    docUrl,
    openUrl: resolveDocOpenUrl({
      docId,
      sheetId: sheetId ?? undefined,
      explicitUrl: docUrl,
      appBaseUrl: config.appBaseUrl ?? null,
    }),
    meta: `Document ${docId}`,
    locale,
    currency,
  };
};

const normalizeShareDbUrl = (value: string | null): string | null => {
  const trimmed = readString(value);
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
      return parsed.toString();
    }
    if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
      return parsed.toString();
    }
    if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
      return parsed.toString();
    }
  } catch {
    // Fall through to prefix handling.
  }

  const isLocalHost =
    trimmed.startsWith("localhost") ||
    trimmed.startsWith("127.0.0.1") ||
    trimmed.startsWith("[::1]");
  return `${isLocalHost ? "ws" : "wss"}://${trimmed}`;
};

const resolveShareDbUrl = (
  docUrl: string | null,
  config: WidgetConfig,
): string => {
  const configured = normalizeShareDbUrl(config.shareDbUrl ?? null);
  if (configured) {
    return configured;
  }

  const configuredPort = readString(config.shareDbPort ?? undefined) ?? "8080";

  if (!docUrl) {
    return `ws://localhost:${configuredPort}`;
  }

  try {
    const parsed = new URL(docUrl);
    const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${parsed.hostname}:${configuredPort}`;
  } catch {
    return `ws://localhost:${configuredPort}`;
  }
};

const createShareDbSocket = (url: string): ShareDBSocket => {
  return new WebSocket(url) as unknown as ShareDBSocket;
};

function SpreadsheetDocumentView({
  docId,
  docUrl,
  locale,
  currency,
  onSyncUiState,
}: {
  docId: string;
  docUrl: string | null;
  locale: string;
  currency: string;
  onSyncUiState?: (payload: UiStateSyncPayload) => void;
}) {
  const config = window.__RNC_MCP_WIDGET_CONFIG__ ?? {};
  const shareDbUrl = resolveShareDbUrl(docUrl, config);
  const connection = useMemo(
    () => new ShareDBClient.Connection(createShareDbSocket(shareDbUrl)),
    [shareDbUrl],
  );
  const [sheets, onChangeSheets] = useState<Sheet[]>(initialSheets);
  const [sheetData, onChangeSheetData] = useState<SheetData<CellData>>({});
  const [tables, onChangeTables] = useState<TableView[]>([]);
  const [charts, onChangeCharts] = useState<EmbeddedChart[]>([]);
  const [embeds, onChangeEmbeds] = useState<EmbeddedObject[]>([]);
  const [slicers, onChangeSlicers] = useState<Slicer[]>([]);
  const [scale, onChangeScale] = useState(1);
  const [namedRanges, onChangeNamedRanges] = useState<NamedRange[]>([]);
  const [protectedRanges, onChangeProtectedRanges] = useState<ProtectedRange[]>(
    [],
  );
  const [citations, onChangeCitations] = useState<Citation[]>([]);
  const [conditionalFormats, onChangeConditionalFormats] = useState<
    ConditionalFormatRule[]
  >([]);
  const [dataValidations, onChangeDataValidations] = useState<
    DataValidationRuleRecord[]
  >([]);
  const [pivotTables, onChangePivotTables] = useState<PivotTable[]>([]);
  const [cellXfs, onChangeCellXfs] = useState<CellXfs | null | undefined>(
    new Map(),
  );
  const [sharedStrings, onChangeSharedStrings] = useState<SharedStrings>(
    new Map(),
  );
  const [theme, onChangeTheme] = useState<SpreadsheetTheme>(
    defaultSpreadsheetTheme,
  );
  const [userDefinedColors, setUserDefinedColors] = useState<string[]>([]);
  const [colorMode, onChangeColorMode] = useState<ColorMode>("light");
  const [iterativeEnabled, setIterativeEnabled] = useState(false);

  const user = useMemo(
    () => ({
      id: "mcp-user",
      title: "MCP User",
    }),
    [],
  );

  // Loading
  const [showLoader, hideLoader] = useLoadingIndicator();

  const {
    activeCell,
    activeSheetId,
    selections,
    rowCount,
    getDataRowCount,
    columnCount,
    frozenColumnCount,
    frozenRowCount,
    rowMetadata,
    columnMetadata,
    showGridLines,
    merges,
    bandedRanges,
    basicFilter,
    isDarkMode,
    spreadsheetColors,
    canRedo,
    canUndo,
    onUndo,
    onRedo,
    getCellData,
    getSheetName,
    getSheetId,
    getEffectiveFormat,
    onRequestCalculate,
    onChangeActiveCell,
    onChangeActiveSheet,
    onSelectNextSheet,
    onSelectPreviousSheet,
    onChangeSelections,
    onChange,
    onChangeBatch,
    onDelete,
    onChangeFormatting,
    onRepeatFormatting,
    onClearFormatting,
    onUnMergeCells,
    onMergeCells,
    onResize,
    onChangeBorder,
    onChangeDecimals,
    onChangeSheetTabColor,
    onRenameSheet,
    onRequestDeleteSheet,
    onDeleteSheet,
    onShowSheet,
    onHideSheet,
    onProtectSheet,
    onUnProtectSheet,
    onMoveSheet,
    onCreateNewSheet,
    onUpdateSheet,
    onDuplicateSheet,
    onHideColumn,
    onShowColumn,
    onHideRow,
    onShowRow,
    onFill,
    onFillRange,
    onMoveEmbed,
    onResizeEmbed,
    onDeleteEmbed,
    onRequestEditEmbed,
    onMoveSlicer,
    onResizeSlicer,
    onDeleteSlicer,
    onUpdateSlicer,
    onRequestEditSlicer,
    onDeleteRow,
    onDeleteColumn,
    onDeleteCellsShiftUp,
    onDeleteCellsShiftLeft,
    onInsertCellsShiftRight,
    onInsertCellsShiftDown,
    onInsertRow,
    onInsertColumn,
    onMoveColumns,
    onMoveRows,
    onMoveSelection,
    onSortColumn,
    onSortTable,
    onFilterTable,
    onResizeTable,
    onCopy,
    onPaste,
    onCreateBasicFilter,
    onCreateTable,
    onRemoveTable,
    onRequestEditTable,
    onUpdateTable,
    onDragOver,
    onDrop,
    onInsertFile,
    onFreezeColumn,
    onFreezeRow,
    onFindReplace,
    onChangeSpreadsheetTheme,
    onUpdateNote,
    onSortRange,
    onProtectRange,
    onUnProtectRange,
    onRequestDefineNamedRange,
    onRequestUpdateNamedRange,
    onCreateNamedRange,
    onUpdateNamedRange,
    onDeleteNamedRange,
    getSeriesValuesFromRange,
    getDomainValuesFromRange,
    getNonEmptyColumnCount,
    getNonEmptyRowCount,
    getEffectiveValue,
    getSheetRowCount,
    getSheetColumnCount,
    createHistory,
    enqueueCalculation,
    enqueueGraphOperation,
    onIncreaseIndent,
    onDecreaseIndent,
    onRequestResize,
    onAutoResize,
    getColumnarDataFromRange,
    onInsertTime,
    onInsertDate,
    onInsertDateTime,
    onInsertLink,
    onInsertImage,
    onInsertCheckbox,
    onRequestInsertImage,
    onRequestInsertLink,
    onRequestFormatCells,
    onRequestConditionalFormat,
    onRequestDataValidation,
    onCreateConditionalFormattingRule,
    onUpdateConditionalFormattingRule,
    onDeleteConditionalFormattingRule,
    onPreviewConditionalFormattingRule,

    onDeleteDataValidationRules,
    onDeleteDataValidationRule,
    onCreateDataValidationRule,
    onUpdateDataValidationRule,
    calculateNow,

    onInsertTableColumn,
    onDeleteTableColumn,
    onInsertTableRow,
    onDeleteTableRow,

    onInsertAutoSum,

    // Excel
    importExcelFile,
    generateStatePatches,

    // CSV
    importCSVFile,

    // Floating editor
    getUserEnteredValue,
    getFormattedValue,
    getErrorValue,
    getTextFormatRuns,
    getEffectiveExtendedValue,
    getUserEnteredExtendedValue,

    // Paint format,
    onSavePaintFormat,
    isPaintFormatActive,
    onApplyPaintFormat,
    paintFormat,
    applyPatch,

    onCreateEmbed,
    onRemoveLink,
    onSelectLink,

    // Split
    onSplitTextToColumns,

    onRequestAddRows,

    cellXfsRegistry,
    sharedStringRegistry,
    getDependents,
    getPrecedents,

    arrows,
    onRemoveArrows,
    onTraceDependents,
    onTracePrecedents,
    getDataValidation,
    getDataColumnCount,
    onChangeBatchStream,

    onRemoveDuplicates,

    // Locale change
    onChangeLocale,

    // For shared strings
    getSheetProperties,
  } = useSpreadsheetState({
    onIterativeCalculationEnabled: setIterativeEnabled,
    recalculateOnOpen: false,
    preserveFormattingOnPaste: true,
    enableExcelImportHistory: true,
    sheets,
    sheetData,
    tables,
    functions,
    namedRanges,
    conditionalFormats,
    dataValidations,
    theme,
    colorMode,
    locale,
    cellXfs,
    sharedStrings,
    onDemandFormulaPattern: "HELLO\\(",
    citations,
    onChangeCitations,
    onChangeSharedStrings,
    onChangeCellXfs,
    onChangeSheets,
    onChangeSheetData,
    onChangeEmbeds,
    onChangeCharts,
    onChangeTables,
    onChangeNamedRanges,
    onChangeTheme,
    onChangeProtectedRanges,
    onChangeConditionalFormats,
    onChangeDataValidations,
    onChangePivotTables,
    onChangeSlicers,
    onChangeHistory(patches) {
      onBroadcastPatch(patches);
    },
    iterativeCalculation: {
      enabled: iterativeEnabled,
      maxChange: 0.001,
      maxIterations: 100,
    },
  });

  const { onBroadcastPatch, users, synced } = useShareDBSpreadsheet({
    connection,
    collection: "spreadsheets",
    documentId: docId,
    userId: user.id,
    title: user.title,
    sheetId: activeSheetId,
    activeCell: activeCell as CellInterface,
    initialSheets,
    onChangeSheetData,
    onChangeCellXfs,
    onChangeCharts,
    onChangeConditionalFormats,
    onChangeDataValidations,
    onChangeEmbeds,
    onChangeNamedRanges,
    onChangeProtectedRanges,
    onChangeSharedStrings,
    onChangeSheets,
    onChangeTables,
    onChangeActiveSheet,
    calculateNow,
    enqueueGraphOperation,
    onChangeIterativeCalculation: setIterativeEnabled,
    onChangePivotTables,
  });

  // sycjed
  useIsomorphicLayoutEffect(() => {
    if (synced) {
      hideLoader();
    } else {
      showLoader("Loading document...");
    }
  }, [synced]);

  // Charts module
  const {
    onRequestEditChart,
    onDeleteChart,
    onMoveChart,
    onResizeChart,
    onUpdateChart,
    onCreateChart,
    selectedChart,
  } = useCharts({
    createHistory,
    onChangeCharts,
    getFormattedValue,
    getEffectiveValue,
  });

  const {
    onSearch,
    onResetSearch,
    onFocusNextResult,
    onFocusPreviousResult,
    hasNextResult,
    hasPreviousResult,
    borderStyles,
    isSearchActive,
    onRequestSearch,
    totalResults,
    currentResult,
    searchQuery,
  } = useSearch({
    getCellData,
    sheetId: activeSheetId,
    getNonEmptyColumnCount,
    getNonEmptyRowCount,
    getFormattedValue,
  });

  // Spreadsheet Api
  const api = useSpreadsheetApi<CellData>();

  const currentCellFormat = useMemo(
    () =>
      getEffectiveFormat(
        activeSheetId,
        activeCell.rowIndex,
        activeCell.columnIndex,
      ),
    [activeCell, activeSheetId, getEffectiveFormat],
  );

  const handleExportExcel = useCallback(async () => {
    await exportToExcel({
      filename: `spreadsheet-${docId}`,
      sheets,
      sheetData,
      tables,
      charts,
      embeds,
      slicers,
      namedRanges,
      conditionalFormats,
      dataValidations,
      theme,
      cellXfs,
      sharedStrings,
    });
  }, [
    docId,
    sheets,
    sheetData,
    tables,
    charts,
    embeds,
    slicers,
    namedRanges,
    conditionalFormats,
    dataValidations,
    theme,
    cellXfs,
    sharedStrings,
  ]);

  const handleExportCSV = useCallback(async () => {
    await exportToCSV({
      filename: `spreadsheet-${docId}-${activeSheetId}`,
      rowData: sheetData[activeSheetId] ?? [],
      sharedStrings,
    });
  }, [docId, activeSheetId, sheetData, sharedStrings]);

  useEffect(() => {
    return () => {
      connection.close();
    };
  }, [connection]);

  useEffect(() => {
    if (!onSyncUiState) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const payload: UiStateSyncPayload = {
        docId,
        activeSheetId,
        activeCell: {
          rowIndex: activeCell.rowIndex,
          columnIndex: activeCell.columnIndex,
        },
        selections: serializeSelections(
          selections as Array<{ range?: unknown }>,
        ),
        locale,
        currency,
      };
      onSyncUiState(payload);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeCell,
    activeSheetId,
    currency,
    docId,
    locale,
    onSyncUiState,
    selections,
  ]);

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-locale={locale}
      data-currency={currency}
    >
      <LoadingIndicator
        style={{
          transform: `translate3d(0,0,0)`,
        }}
      />
      {/* Remove rounded class */}
      <Toolbar enableFloating>
        <FileMenu
          onExportExcel={handleExportExcel}
          onExportCSV={handleExportCSV}
          allowCreateNew={false}
          allowImport={false}
        />
        <ToolbarSeparator />
        <ButtonUndo onClick={onUndo} disabled={!canUndo} />
        <ButtonRedo onClick={onRedo} disabled={!canRedo} />
        <ButtonPrint onClick={() => window.print()} />
        <ButtonPaintFormat
          isActive={isPaintFormatActive}
          onClick={() =>
            onSavePaintFormat(activeSheetId, activeCell, selections)
          }
        />
        <ButtonCopyToClipboard
          isActive={isPaintFormatActive}
          onClick={async () => {
            const range = selections.length
              ? selections[selections.length - 1].range
              : selectionFromActiveCell(activeCell)[0].range;
            const blob = await api?.exportRange?.(
              {
                ...range,
                startColumnIndex: range.startColumnIndex,
                endColumnIndex: 10,
                startRowIndex: 1,
                endRowIndex: 50,
                sheetId: activeSheetId,
              },
              {
                format: "clipboard",
                includeHeaders: true,
              },
            );
          }}
        />
        <ButtonClearFormatting
          onClick={() => {
            onClearFormatting(activeSheetId, activeCell, selections);
          }}
        />
        <ToolbarSeparator />
        <ScaleSelector value={scale} onChange={onChangeScale} />
        <ToolbarSeparator />
        <ButtonFormatCurrency
          onClick={() => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "numberFormat",
              {
                type: "CURRENCY",
                pattern: pattern_currency_decimal,
              },
            );
          }}
        />
        <ButtonFormatPercent
          onClick={() => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "numberFormat",
              {
                type: "PERCENT",
                pattern: pattern_percent_decimal,
              },
            );
          }}
        />
        <ButtonDecreaseDecimal
          onClick={() =>
            onChangeDecimals(activeSheetId, activeCell, selections, "decrement")
          }
        />
        <ButtonIncreaseDecimal
          onClick={() =>
            onChangeDecimals(activeSheetId, activeCell, selections, "increment")
          }
        />
        <TextFormatSelector
          locale={locale}
          currency={currency}
          cellFormat={currentCellFormat}
          onChangeFormatting={(type, value) => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              type,
              value,
            );
          }}
          onRequestFormatCells={onRequestFormatCells}
        />
        <ToolbarSeparator />
        <FontFamilySelector
          value={currentCellFormat?.textFormat?.fontFamily}
          theme={theme}
          onChange={(value) => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "textFormat",
              {
                fontFamily: value,
              },
            );
          }}
        />
        <ToolbarSeparator />
        <FontSizeSelector
          value={currentCellFormat?.textFormat?.fontSize}
          onChange={(value) => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "textFormat",
              {
                fontSize: Number(value),
              },
            );
          }}
        />
        <ToolbarSeparator />
        <ButtonBold
          isActive={currentCellFormat?.textFormat?.bold}
          onClick={() => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "textFormat",
              {
                bold: !currentCellFormat?.textFormat?.bold,
              },
            );
          }}
        />
        <ButtonItalic
          isActive={currentCellFormat?.textFormat?.italic}
          onClick={() => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "textFormat",
              {
                italic: !currentCellFormat?.textFormat?.italic,
              },
            );
          }}
        />
        <ButtonUnderline
          isActive={currentCellFormat?.textFormat?.underline}
          onClick={() => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "textFormat",
              {
                underline: !currentCellFormat?.textFormat?.underline,
              },
            );
          }}
        />
        <ButtonStrikethrough
          isActive={currentCellFormat?.textFormat?.strikethrough}
          onClick={() => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "textFormat",
              {
                strikethrough: !currentCellFormat?.textFormat?.strikethrough,
              },
            );
          }}
        />

        <TextColorSelector
          color={currentCellFormat?.textFormat?.color}
          theme={theme}
          isDarkMode={isDarkMode}
          onChange={(color) => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "textFormat",
              {
                color,
              },
            );
          }}
          userDefinedColors={userDefinedColors}
          onAddUserDefinedColor={(color) =>
            setUserDefinedColors((prev) => prev.concat(color))
          }
        />

        <ToolbarSeparator />
        <BackgroundColorSelector
          color={currentCellFormat?.backgroundColor}
          theme={theme}
          onChange={(color) => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "backgroundColor",
              color,
            );
          }}
          userDefinedColors={userDefinedColors}
          onAddUserDefinedColor={(color) =>
            setUserDefinedColors((prev) => prev.concat(color))
          }
        />

        <BorderSelector
          borders={currentCellFormat?.borders}
          onChange={(location, color, style) => {
            onChangeBorder(
              activeSheetId,
              activeCell,
              selections,
              location,
              color,
              style,
            );
          }}
          theme={theme}
          isDarkMode={isDarkMode}
          userDefinedColors={userDefinedColors}
          onAddUserDefinedColor={(color) =>
            setUserDefinedColors((prev) => prev.concat(color))
          }
        />
        <MergeCellsSelector
          activeCell={activeCell}
          selections={selections}
          sheetId={activeSheetId}
          merges={merges}
          onUnMerge={onUnMergeCells}
          onMerge={onMergeCells}
        />
        <ToolbarSeparator />
        <TextHorizontalAlignSelector
          value={currentCellFormat?.horizontalAlignment}
          onChange={(value) => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "horizontalAlignment",
              value,
            );
          }}
        />

        <ButtonInsertImage
          onInsertFile={(file) => {
            onInsertFile?.(file, activeSheetId, activeCell, {
              insertOverCells: true,
            });
          }}
        />

        <TextVerticalAlignSelector
          value={currentCellFormat?.verticalAlignment}
          onChange={(value) => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "verticalAlignment",
              value,
            );
          }}
        />

        <TextWrapSelector
          value={currentCellFormat?.wrapStrategy}
          onChange={(value) => {
            onChangeFormatting(
              activeSheetId,
              activeCell,
              selections,
              "wrapStrategy",
              value,
            );
          }}
        />

        <ButtonDecreaseIndent
          onClick={() => {
            onDecreaseIndent(activeSheetId, activeCell, selections);
          }}
        />

        <ButtonIncreaseIndent
          onClick={() => {
            onIncreaseIndent(activeSheetId, activeCell, selections);
          }}
        />
        <ToolbarSeparator />

        <InsertMenu
          sheetId={activeSheetId}
          activeCell={activeCell}
          selections={selections}
          onCreateNewSheet={onCreateNewSheet}
          onCreateChart={onCreateChart}
          onRequestInsertImage={onRequestInsertImage}
          onRequestInsertLink={onRequestInsertLink}
          onInsertCellsShiftDown={onInsertCellsShiftDown}
          onInsertCellsShiftRight={onInsertCellsShiftRight}
          onInsertColumn={onInsertColumn}
          onInsertRow={onInsertRow}
          onRequestDataValidation={onRequestDataValidation}
          // onRequestCreatePivotTable={onRequestCreatePivotTable}
        />

        <ToolbarSeparator />

        <TableStyleSelector
          theme={theme}
          tables={tables}
          activeCell={activeCell}
          selections={selections}
          sheetId={activeSheetId}
          onCreateTable={onCreateTable}
          onUpdateTable={onUpdateTable}
        />

        <CellStyleSelector
          locale={locale}
          currency={currency}
          selectedFormat={currentCellFormat}
          onChangeFormatting={(...args) => {
            onChangeFormatting(activeSheetId, activeCell, selections, ...args);
          }}
          onClearFormatting={() =>
            onClearFormatting(activeSheetId, activeCell, selections)
          }
          theme={theme}
        />

        <ThemeSelector theme={theme} onChangeTheme={onChangeSpreadsheetTheme} />

        <ToolbarSeparator />

        <ButtonSwitchColorMode
          colorMode={colorMode}
          onClick={() => onChangeColorMode(toggleThemeMode())}
        />
        <IconButton onClick={onRequestSearch}>
          <MagnifyingGlassIcon />
        </IconButton>
      </Toolbar>

      <FormulaBar>
        <RangeSelector
          selections={selections}
          activeCell={activeCell}
          onChangeActiveCell={onChangeActiveCell}
          onChangeSelections={onChangeSelections}
          sheets={sheets}
          rowCount={rowCount}
          columnCount={columnCount}
          onChangeActiveSheet={onChangeActiveSheet}
          onRequestDefineNamedRange={onRequestDefineNamedRange}
          onRequestUpdateNamedRange={onRequestUpdateNamedRange}
          onDeleteNamedRange={onDeleteNamedRange}
          namedRanges={namedRanges}
          tables={tables}
          sheetId={activeSheetId}
          merges={merges}
        />
        <Separator orientation="vertical" />
        <FormulaBarLabel>fx</FormulaBarLabel>
        <FormulaBarInput
          sheetId={activeSheetId}
          activeCell={activeCell}
          functionDescriptions={functionDescriptions}
        />
      </FormulaBar>
      <div className="rnc-canvas-wrapper min-h-0 flex-1 flex">
        <CanvasGrid
          {...spreadsheetColors}
          locale={locale}
          users={users}
          onRemoveDuplicates={onRemoveDuplicates}
          onRequestInsertComment={console.log}
          pivotTables={pivotTables}
          getEffectiveExtendedValue={getEffectiveExtendedValue}
          getUserEnteredExtendedValue={getUserEnteredExtendedValue}
          onChangeBorder={onChangeBorder}
          onSplitTextToColumns={onSplitTextToColumns}
          onRemoveLink={onRemoveLink}
          onSelectLink={onSelectLink}
          onDuplicateSheet={onDuplicateSheet}
          onCreateConditionalFormattingRule={onCreateConditionalFormattingRule}
          onDeleteConditionalFormattingRule={onDeleteConditionalFormattingRule}
          onUpdateConditionalFormattingRule={onUpdateConditionalFormattingRule}
          onCreateDataValidationRule={onCreateDataValidationRule}
          onUpdateDataValidationRule={onUpdateDataValidationRule}
          onDeleteDataValidationRule={onDeleteDataValidationRule}
          onCreateChart={onCreateChart}
          onDeleteSheet={onDeleteSheet}
          onCreateEmbed={onCreateEmbed}
          onDecreaseIndent={onDecreaseIndent}
          onIncreaseIndent={onIncreaseIndent}
          onChangeTheme={onChangeTheme}
          onChangeDecimals={onChangeDecimals}
          enableDataBoundaryNavigation
          enableMagicFill={true}
          showSelectionResizeHandles
          stickyEditor={true}
          showGridLines={showGridLines}
          borderStyles={borderStyles}
          scale={scale}
          conditionalFormats={conditionalFormats}
          sheetId={activeSheetId}
          rowCount={rowCount}
          getDataValidation={getDataValidation}
          getFormattedValue={getFormattedValue}
          getDataRowCount={getDataRowCount}
          columnCount={columnCount}
          frozenColumnCount={frozenColumnCount}
          frozenRowCount={frozenRowCount}
          rowMetadata={rowMetadata}
          columnMetadata={columnMetadata}
          activeCell={activeCell}
          selections={selections}
          theme={theme}
          merges={merges}
          charts={charts}
          embeds={embeds}
          slicers={slicers}
          tables={tables}
          basicFilter={basicFilter}
          protectedRanges={protectedRanges}
          bandedRanges={bandedRanges}
          functionDescriptions={functionDescriptions}
          getSheetName={getSheetName}
          getSheetId={getSheetId}
          getCellData={getCellData}
          getEffectiveFormat={getEffectiveFormat}
          onChangeActiveCell={onChangeActiveCell}
          onChangeSelections={onChangeSelections}
          onChangeActiveSheet={onChangeActiveSheet}
          onRequestCalculate={onRequestCalculate}
          onSelectNextSheet={onSelectNextSheet}
          onSelectPreviousSheet={onSelectPreviousSheet}
          onChangeFormatting={onChangeFormatting}
          onRepeatFormatting={onRepeatFormatting}
          onHideColumn={onHideColumn}
          onShowColumn={onShowColumn}
          onHideRow={onHideRow}
          onShowRow={onShowRow}
          onDelete={onDelete}
          onClearContents={onDelete}
          onFill={onFill}
          onFillRange={onFillRange}
          onResize={onResize}
          onMoveChart={onMoveChart}
          onRequestEditEmbed={onRequestEditEmbed}
          onMoveEmbed={onMoveEmbed}
          onResizeChart={onResizeChart}
          onDeleteChart={onDeleteChart}
          onResizeEmbed={onResizeEmbed}
          onDeleteEmbed={onDeleteEmbed}
          onMoveSlicer={onMoveSlicer}
          onResizeSlicer={onResizeSlicer}
          onDeleteSlicer={onDeleteSlicer}
          onRequestEditSlicer={onRequestEditSlicer}
          onDeleteRow={onDeleteRow}
          onDeleteColumn={onDeleteColumn}
          onDeleteCellsShiftUp={onDeleteCellsShiftUp}
          onDeleteCellsShiftLeft={onDeleteCellsShiftLeft}
          onInsertCellsShiftRight={onInsertCellsShiftRight}
          onInsertCellsShiftDown={onInsertCellsShiftDown}
          onInsertRow={onInsertRow}
          onInsertColumn={onInsertColumn}
          onMoveColumns={onMoveColumns}
          onMoveRows={onMoveRows}
          onMoveSelection={onMoveSelection}
          onCreateNewSheet={onCreateNewSheet}
          onUpdateSheet={onUpdateSheet}
          onChange={onChange}
          onChangeBatch={onChangeBatch}
          onChangeBatchStream={onChangeBatchStream}
          onUndo={onUndo}
          onRedo={onRedo}
          onSortColumn={onSortColumn}
          onSortTable={onSortTable}
          onFilterTable={onFilterTable}
          onResizeTable={onResizeTable}
          onClearFormatting={onClearFormatting}
          onCopy={onCopy}
          onPaste={onPaste}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onCreateBasicFilter={onCreateBasicFilter}
          onCreateTable={onCreateTable}
          onRemoveTable={onRemoveTable}
          onRequestEditTable={onRequestEditTable}
          onRequestDefineNamedRange={onRequestDefineNamedRange}
          onFreezeColumn={onFreezeColumn}
          onFreezeRow={onFreezeRow}
          onUpdateNote={onUpdateNote}
          onSortRange={onSortRange}
          onProtectRange={onProtectRange}
          onUnProtectRange={onUnProtectRange}
          namedRanges={namedRanges}
          getSlicerComponent={(props: SlicerComponentProps) => {
            return <SlicerComponent {...props} />;
          }}
          licenseKey="evaluation-license"
          onRequestSearch={onRequestSearch}
          onRequestResize={onRequestResize}
          onAutoResize={onAutoResize}
          onChangeScale={onChangeScale}
          onInsertTime={onInsertTime}
          onInsertDate={onInsertDate}
          onInsertDateTime={onInsertDateTime}
          onRequestFormatCells={onRequestFormatCells}
          getSheetRowCount={getSheetRowCount}
          getSheetColumnCount={getSheetColumnCount}
          onRequestConditionalFormat={onRequestConditionalFormat}
          onRequestDataValidation={onRequestDataValidation}
          onInsertTableColumn={onInsertTableColumn}
          onDeleteTableColumn={onDeleteTableColumn}
          onInsertTableRow={onInsertTableRow}
          onDeleteTableRow={onDeleteTableRow}
          onInsertAutoSum={onInsertAutoSum}
          footerHeight={80}
          footerComponent={
            <GridFooter
              onRequestAddRows={onRequestAddRows}
              sheetId={activeSheetId}
            />
          }
          arrowComponents={arrows}
          getChartComponent={(props) => (
            <Suspense fallback={<CircularLoader />}>
              <ChartComponent
                {...props}
                isDarkMode={isDarkMode}
                getSeriesValuesFromRange={getSeriesValuesFromRange}
                getDomainValuesFromRange={getDomainValuesFromRange}
                onRequestEdit={onRequestEditChart}
                onRequestCalculate={onRequestCalculate}
              />
            </Suspense>
          )}
        />
      </div>
      {/* Remove rounded class */}
      <BottomBar>
        <NewSheetButton onClick={onCreateNewSheet} />

        <SheetSwitcher
          sheets={sheets}
          activeSheetId={activeSheetId}
          onChangeActiveSheet={onChangeActiveSheet}
          onShowSheet={onShowSheet}
        />
        <SheetTabs
          enableNavigationButton
          sheets={sheets}
          protectedRanges={protectedRanges}
          activeSheetId={activeSheetId}
          theme={theme}
          onChangeActiveSheet={onChangeActiveSheet}
          onRenameSheet={onRenameSheet}
          onChangeSheetTabColor={onChangeSheetTabColor}
          onDeleteSheet={onRequestDeleteSheet}
          onHideSheet={onHideSheet}
          onMoveSheet={onMoveSheet}
          onProtectSheet={onProtectSheet}
          onUnProtectSheet={onUnProtectSheet}
          onDuplicateSheet={onDuplicateSheet}
        />
        <SheetStatus
          sheetId={activeSheetId}
          activeCell={activeCell}
          selections={selections}
          onRequestCalculate={onRequestCalculate}
          rowCount={rowCount}
          columnCount={columnCount}
          merges={merges}
        />
      </BottomBar>

      <ConditionalFormatDialog>
        <ConditionalFormatEditor
          sheetId={activeSheetId}
          theme={theme}
          conditionalFormats={conditionalFormats}
          functionDescriptions={functionDescriptions}
          onCreateRule={onCreateConditionalFormattingRule}
          onDeleteRule={onDeleteConditionalFormattingRule}
          onUpdateRule={onUpdateConditionalFormattingRule}
          onPreviewRule={onPreviewConditionalFormattingRule}
        />
      </ConditionalFormatDialog>

      <TableEditor
        sheetId={activeSheetId}
        onSubmit={onUpdateTable}
        theme={theme}
        onRemoveTable={onRemoveTable}
      />
      <DeleteSheetConfirmation onDeleteSheet={onDeleteSheet} />
      <NamedRangeEditor
        sheetId={activeSheetId}
        onCreateNamedRange={onCreateNamedRange}
        onUpdateNamedRange={onUpdateNamedRange}
      />

      <SheetSearch
        isActive={isSearchActive}
        onSubmit={onSearch}
        onReset={onResetSearch}
        onNext={onFocusNextResult}
        onPrevious={onFocusPreviousResult}
        disableNext={!hasNextResult}
        disablePrevious={!hasPreviousResult}
        currentResult={currentResult}
        totalResults={totalResults}
        searchQuery={searchQuery}
      />

      <CellFormatEditorDialog>
        <CellFormatEditor
          sheetId={activeSheetId}
          activeCell={activeCell}
          selections={selections}
          onChangeFormatting={onChangeFormatting}
          cellFormat={currentCellFormat}
          getEffectiveValue={getEffectiveValue}
          onMergeCells={onMergeCells}
          theme={theme}
          isDarkMode={isDarkMode}
          onChangeBorder={onChangeBorder}
        />
      </CellFormatEditorDialog>

      <DataValidationEditorDialog>
        <DataValidationEditor
          dataValidations={dataValidations}
          sheetId={activeSheetId}
          functionDescriptions={functionDescriptions}
          onDeleteRules={onDeleteDataValidationRules}
          onDeleteRule={onDeleteDataValidationRule}
          onCreateRule={onCreateDataValidationRule}
          onUpdateRule={onUpdateDataValidationRule}
        />
      </DataValidationEditorDialog>

      <ChartEditorDialog>
        <ChartEditor
          sheetId={activeSheetId}
          chart={selectedChart}
          onSubmit={onUpdateChart}
        />
      </ChartEditorDialog>

      <InsertImageDialog>
        <InsertImageEditor
          sheetId={activeSheetId}
          activeCell={activeCell}
          selections={selections}
          onInsertImage={onInsertImage}
        />
      </InsertImageDialog>

      <EmbedEditorDialog>
        <EmbedEditor
          sheetId={activeSheetId}
          activeCell={activeCell}
          selections={selections}
          onInsertImage={onInsertImage}
        />
      </EmbedEditorDialog>

      <InsertLinkDialog>
        <InsertLinkEditor
          sheetId={activeSheetId}
          activeCell={activeCell}
          selections={selections}
          onInsertLink={onInsertLink}
        />
      </InsertLinkDialog>

      <ResizeDimensionEditor onResize={onResize} onAutoResize={onAutoResize} />

      <ErrorStateDialog />
    </div>
  );
}

function App() {
  const config = window.__RNC_MCP_WIDGET_CONFIG__ ?? {};
  const initialState = getInitialDocState(config);
  const [docId, setDocId] = useState<string | null>(initialState.docId);
  const [docUrl, setDocUrl] = useState<string | null>(initialState.docUrl);
  const [meta, setMeta] = useState(initialState.meta);
  const [openUrl, setOpenUrl] = useState<string | null>(initialState.openUrl);
  const [locale, setLocale] = useState(initialState.locale);
  const [currency, setCurrency] = useState(initialState.currency);
  const requestIdRef = useRef(0);
  const pendingRequestsRef = useRef(
    new Map<
      number,
      { resolve: (result: unknown) => void; reject: (error: unknown) => void }
    >(),
  );
  const hostInitializedRef = useRef(false);

  const sendNotification = (
    method: string,
    params: Record<string, unknown> = {},
  ) => {
    window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  };

  const sendRequest = (
    method: string,
    params: Record<string, unknown> = {},
  ) => {
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    return new Promise((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
      window.setTimeout(() => {
        if (!pendingRequestsRef.current.has(id)) return;
        pendingRequestsRef.current.delete(id);
        reject(new Error(`${method} timed out`));
      }, 4000);
    });
  };

  const onSyncUiState = (payload: UiStateSyncPayload) => {
    sendRequest("tools/call", {
      name: "spreadsheet_syncUiState",
      arguments: payload,
    }).catch(() => {
      // Ignore host/tool sync failures to keep UI responsive.
    });
  };

  useEffect(() => {
    const notifySize = () => {
      const root = document.documentElement;
      const body = document.body;
      const width = Math.ceil(
        Math.max(root.scrollWidth, body.scrollWidth, root.clientWidth, 320),
      );
      const height = Math.ceil(
        Math.max(root.scrollHeight, body.scrollHeight, docId ? 680 : 120),
      );
      sendNotification("ui/notifications/size-changed", { width, height });
    };

    const onMessage = (event: MessageEvent) => {
      const message = event.data as
        | {
            jsonrpc?: string;
            id?: number;
            method?: string;
            params?: { arguments?: unknown; structuredContent?: unknown };
            error?: unknown;
            result?: unknown;
          }
        | undefined;

      if (!message || message.jsonrpc !== "2.0") {
        return;
      }

      if (
        message.id !== undefined &&
        pendingRequestsRef.current.has(message.id)
      ) {
        const pending = pendingRequestsRef.current.get(message.id);
        pendingRequestsRef.current.delete(message.id);
        if (!pending) return;
        if (Object.prototype.hasOwnProperty.call(message, "error")) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
        return;
      }

      if (typeof message.method !== "string") {
        return;
      }

      if (
        message.method === "ui/notifications/tool-input" ||
        message.method === "ui/notifications/tool-input-partial"
      ) {
        const payload = parseToolPayload(message.params?.arguments);
        if (payload?.docId) {
          setDocId(payload.docId);
          setDocUrl(payload.url ?? null);
          if (payload.locale) {
            setLocale(payload.locale);
          }
          if (payload.currency) {
            setCurrency(payload.currency);
          }
          setOpenUrl(
            resolveDocOpenUrl({
              docId: payload.docId,
              sheetId: payload.sheetId,
              explicitUrl: payload.url ?? null,
              appBaseUrl: config.appBaseUrl ?? null,
            }),
          );
          setMeta(`Document ${payload.docId}`);
        }
      }

      if (message.method === "ui/notifications/tool-result") {
        const payload = parseToolPayload(message.params?.structuredContent);
        if (payload?.docId) {
          setDocId(payload.docId);
          setDocUrl(payload.url ?? null);
          if (payload.locale) {
            setLocale(payload.locale);
          }
          if (payload.currency) {
            setCurrency(payload.currency);
          }
          setOpenUrl(
            resolveDocOpenUrl({
              docId: payload.docId,
              sheetId: payload.sheetId,
              explicitUrl: payload.url ?? null,
              appBaseUrl: config.appBaseUrl ?? null,
            }),
          );
          setMeta(`Document ${payload.docId}`);
        }
      }

      notifySize();
    };

    window.addEventListener("message", onMessage);

    const ro = new ResizeObserver(() => notifySize());
    ro.observe(document.documentElement);
    ro.observe(document.body);
    notifySize();

    if (!hostInitializedRef.current) {
      hostInitializedRef.current = true;
      sendRequest("ui/initialize", {
        appInfo: {
          name: "rowsncolumns-spreadsheet-app",
          version: "1.0.0",
        },
        appCapabilities: {
          tools: {},
          availableDisplayModes: ["inline", "fullscreen"],
        },
        protocolVersion: "2026-01-26",
      })
        .then(() => {
          sendNotification("ui/notifications/initialized", {});
          notifySize();
        })
        .catch(() => {
          notifySize();
        });
    }

    return () => {
      ro.disconnect();
      window.removeEventListener("message", onMessage);
    };
  }, [docId, config.appBaseUrl]);

  if (!docId) {
    return (
      <div className="rnc-widget-placeholder">
        <div className="rnc-widget-meta">{meta}</div>
        {openUrl ? (
          <a href={openUrl} target="_blank" rel="noopener noreferrer">
            Open In New Tab
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <SpreadsheetProvider>
      <SpreadsheetDocumentView
        key={`${docId}-${locale}-${currency}`}
        docId={docId}
        docUrl={docUrl}
        locale={locale}
        currency={currency}
        onSyncUiState={onSyncUiState}
      />
    </SpreadsheetProvider>
  );
}

function bootstrap() {
  const rootElement = document.getElementById("app");
  if (!rootElement) {
    return;
  }

  const root = createRoot(rootElement);
  root.render(<App />);
}

bootstrap();
