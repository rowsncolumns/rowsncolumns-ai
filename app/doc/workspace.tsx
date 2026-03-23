"use client";

import { functionDescriptions, functions } from "@rowsncolumns/functions";
import { exportToCSV, exportToExcel } from "@rowsncolumns/toolkit";
import type {
  CellData,
  Collaborator,
  ColorMode,
  ConditionalFormatRule,
  DataValidationRuleRecord,
  EmbeddedChart,
  EmbeddedObject,
  NamedRange,
  PivotTable,
  ProtectedRange,
  Sheet,
  Slicer,
  SlicerComponentProps,
  SpreadsheetTheme,
  TableView,
} from "@rowsncolumns/spreadsheet";
import {
  BackgroundColorSelector,
  ButtonBold,
  ButtonClearFormatting,
  ButtonDecreaseDecimal,
  ButtonFormatCurrency,
  ButtonFormatPercent,
  ButtonIncreaseDecimal,
  ButtonItalic,
  ButtonStrikethrough,
  ButtonUnderline,
  BottomBar,
  CanvasGrid,
  FontFamilySelector,
  FontSizeSelector,
  FormulaBar,
  FormulaBarInput,
  FormulaBarLabel,
  NewSheetButton,
  RangeSelector,
  SheetStatus,
  SheetSwitcher,
  SheetTabs,
  SpreadsheetProvider,
  TextColorSelector,
  TextFormatSelector,
  TextHorizontalAlignSelector,
  TextVerticalAlignSelector,
  TextWrapSelector,
  Toolbar,
  ToolbarSeparator,
  defaultSpreadsheetTheme,
  CellStyleSelector,
  TableStyleSelector,
  BorderSelector,
  ButtonCopyToClipboard,
  ButtonDecreaseIndent,
  ButtonIncreaseIndent,
  ButtonInsertImage,
  ButtonPaintFormat,
  ButtonPrint,
  ButtonRedo,
  ButtonSwitchColorMode,
  ButtonUndo,
  InsertMenu,
  MergeCellsSelector,
  ScaleSelector,
  ThemeSelector,
  useSpreadsheetApi,
  GridFooter,
  SlicerComponent,
  createNewSheet,
  SheetSearch,
  LoadingIndicator,
  useLoadingIndicator,
  useIsomorphicLayoutEffect,
} from "@rowsncolumns/spreadsheet";
import type {
  CellXfs,
  SharedStrings,
  SheetData,
} from "@rowsncolumns/spreadsheet-state";
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
  ResizeDimensionEditor,
  TableEditor,
  pattern_currency_decimal,
  pattern_percent_decimal,
  useSearch,
  useSpreadsheetState,
} from "@rowsncolumns/spreadsheet-state";
import { IconButton, Separator as UiSeparator } from "@rowsncolumns/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from "react-resizable-panels";

import { FileMenu } from "@/components/file-menu";
import { ShareDocumentButton } from "@/components/share-document-button";
import { SiteHeader } from "@/components/site-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth/client";
import {
  getThemeModeFromBodyClass,
  type ThemeMode,
  toggleThemeMode,
} from "@/lib/theme-preference";
import {
  AssistantRuntimeProvider,
  SheetsInstructions,
  useSpreadsheetAssistantRuntime,
  WorkspaceAssistantUI,
} from "@/components/workspace-assistant";
import { MagnifyingGlassIcon } from "@rowsncolumns/icons";
import { Citation } from "@rowsncolumns/common-types";
import { uuid } from "@rowsncolumns/utils";
import {
  ChartEditor,
  ChartEditorDialog,
  useCharts,
} from "@rowsncolumns/charts";
import {
  ASSISTANT_PANEL_ID,
  PANEL_GROUP_ID,
  PANEL_LAYOUT_COOKIE,
  SPREADSHEET_PANEL_ID,
  serializePanelLayoutCookie,
  type WorkspacePanelLayout,
} from "./panel-layout";
import { useShareDBSpreadsheet } from "@rowsncolumns/sharedb";
import ShareDBClient from "sharedb/lib/client";
import ReconnectingWebSocket from "reconnecting-websocket";
import { selectionFromActiveCell } from "@rowsncolumns/grid";

const getShareDbUrl = () => {
  const configured = process.env.NEXT_PUBLIC_SHAREDB_URL?.trim();
  if (configured) return configured;

  const port = process.env.NEXT_PUBLIC_SHAREDB_PORT?.trim() || "8080";
  if (typeof window === "undefined") {
    return `ws://localhost:${port}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.hostname}:${port}`;
};

type ShareDBSocket = ConstructorParameters<typeof ShareDBClient.Connection>[0];
type ShareDbConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "stopped"
  | "closed";

const normalizeShareDbConnectionState = (
  state: unknown,
): ShareDbConnectionState => {
  switch (state) {
    case "connected":
      return "connected";
    case "disconnected":
      return "disconnected";
    case "stopped":
      return "stopped";
    case "closed":
      return "closed";
    default:
      return "connecting";
  }
};

const formatShareDbReason = (reason: unknown): string | null => {
  if (!reason) return null;
  if (typeof reason === "string") {
    const value = reason.trim();
    return value.length > 0 ? value : null;
  }
  if (reason instanceof Error) {
    return reason.message.trim() || reason.name;
  }
  if (typeof reason === "object") {
    const value = reason as {
      message?: unknown;
      reason?: unknown;
      code?: unknown;
      type?: unknown;
    };
    if (typeof value.reason === "string" && value.reason.trim()) {
      return value.reason.trim();
    }
    if (typeof value.message === "string" && value.message.trim()) {
      return value.message.trim();
    }
    if (typeof value.code === "number") {
      return `code ${value.code}`;
    }
    if (typeof value.type === "string" && value.type.trim()) {
      return value.type.trim();
    }
  }
  return null;
};

const createShareDbSocket = (): ShareDBSocket => {
  const reconnectingSocket = new ReconnectingWebSocket(getShareDbUrl());

  const socket: ShareDBSocket = {
    get readyState() {
      return reconnectingSocket.readyState;
    },
    close(reason?: number) {
      reconnectingSocket.close(reason);
    },
    send(data: any) {
      reconnectingSocket.send(data);
    },
    onmessage: () => {},
    onclose: () => {},
    onerror: () => {},
    onopen: () => {},
  };

  reconnectingSocket.onmessage = (event) => {
    socket.onmessage(event);
  };
  reconnectingSocket.onclose = (event) => {
    socket.onclose(event);
  };
  reconnectingSocket.onerror = (event) => {
    socket.onerror(event);
  };
  reconnectingSocket.onopen = (event) => {
    socket.onopen(event);
  };

  return socket;
};

// Create ShareDB connection
const socket = createShareDbSocket();
const connection = new ShareDBClient.Connection(socket);

const initialSheets: Sheet[] = [
  createNewSheet(1, "Sheet1"),
  createNewSheet(uuid(), "Sheet2"),
];

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

const FINANCE_STARTER_PROMPTS = [
  "Build a 3-statement financial model (P&L, balance sheet, cash flow) from this trial balance and link all statements correctly.",
  "Create a SaaS operating model with drivers for ARR, new bookings, churn, expansion, and gross margin by month.",
  "Build a monthly cash runway model with base, upside, and downside scenarios through the next 24 months.",
  "Create a driver-based revenue model by product, region, and channel with assumptions separated from calculations.",
  "Build a headcount and compensation model by department with hiring plan, fully loaded cost, and monthly burn impact.",
  "Create a cohort retention and LTV model from customer-level data, including payback period and CAC:LTV ratio.",
  "Build a subscription waterfall model: opening ARR, new, expansion, contraction, churn, and ending ARR by month.",
  "Create a budget vs actual variance model with volume/price/mix bridges and executive commentary fields.",
  "Build a project finance model with capex schedule, debt drawdown, interest, DSCR, and covenant checks.",
  "Create a debt schedule with amortization, optional prepayments, floating-rate assumptions, and sensitivity tables.",
  "Build a DCF valuation model with WACC assumptions, terminal value methods, and scenario/sensitivity outputs.",
  "Create a working capital model for AR, AP, and inventory days, and show cash impact from policy changes.",
  "Build a unit economics model by segment with gross margin, contribution margin, and breakeven analysis.",
  "Create a monthly forecasting model that rolls forward actuals and updates full-year outlook automatically.",
  "Audit this financial model for hardcoded values, broken links, circular references, and formula consistency.",
];

const STARTER_PROMPT_COUNT = 3;

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pickSeededPrompts = (
  prompts: string[],
  count: number,
  seedKey: string,
) => {
  if (prompts.length <= count) {
    return [...prompts];
  }

  const random = createSeededRandom(hashString(seedKey));
  const shuffled = [...prompts];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex]!,
      shuffled[index]!,
    ];
  }

  return shuffled.slice(0, count);
};

const ASSISTANT_PANEL_MIN_WIDTH = 350;
const ASSISTANT_PANEL_DEFAULT_WIDTH = 840;
const MOBILE_LAYOUT_MEDIA_QUERY = "(max-width: 767px)";

const useMediaQueryMatch = (query: string, initialValue = false) => {
  const [matches, setMatches] = useState(initialValue);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQueryList = window.matchMedia(query);
    const updateMatches = () => {
      setMatches(mediaQueryList.matches);
    };

    updateMatches();

    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", updateMatches);
      return () => {
        mediaQueryList.removeEventListener("change", updateMatches);
      };
    }

    mediaQueryList.addListener(updateMatches);
    return () => {
      mediaQueryList.removeListener(updateMatches);
    };
  }, [query]);

  return matches;
};

type WorkspaceUser = {
  id: string;
  name?: string | null;
  email?: string | null;
};

function SpreadsheetPane({
  documentId,
  currentUser,
  initialThemeMode,
  canManageShare,
}: {
  documentId: string;
  currentUser: WorkspaceUser;
  initialThemeMode: ThemeMode;
  canManageShare: boolean;
}) {
  const { data: sessionData } = authClient.useSession();
  const user = sessionData?.user ?? currentUser;
  const shareDbUserId = user.id;
  const shareDbUserTitle = user.name?.trim() || user.email || "User";

  const locale = "en-US";
  const currency = "USD";
  const [sheets, onChangeSheets] = useState<Sheet[]>(initialSheets);
  const [cellXfs, onChangeCellXfs] = useState<CellXfs | null | undefined>(
    new Map(),
  );
  const [sharedStrings, onChangeSharedStrings] = useState<SharedStrings>(
    new Map(),
  );
  const [sheetData, onChangeSheetData] = useState<SheetData<CellData>>({});
  const [scale, onChangeScale] = useState(1);
  const [colorMode, onChangeColorMode] = useState<ColorMode>(initialThemeMode);
  const [charts, onChangeCharts] = useState<EmbeddedChart[]>([]);
  const [embeds, onChangeEmbeds] = useState<EmbeddedObject[]>([]);
  const [slicers, onChangeSlicers] = useState<Slicer[]>([]);
  const [tables, onChangeTables] = useState<TableView[]>([]);
  const [pivotTables, onChangePivotTables] = useState<PivotTable[]>([]);
  const [conditionalFormats, onChangeConditionalFormats] = useState<
    ConditionalFormatRule[]
  >([]);
  const [dataValidations, onChangeDataValidations] = useState<
    DataValidationRuleRecord[]
  >([]);
  const [protectedRanges, onChangeProtectedRanges] = useState<ProtectedRange[]>(
    [],
  );
  const [citations, onChangeCitations] = useState<Citation[]>([
    {
      id: "citation-id",
      citation_string: "asdasd",
      range: {
        sheetId: 1,
        endRowIndex: 1,
        startRowIndex: 1,
        startColumnIndex: 3,
        endColumnIndex: 3,
      },
    },
  ]);
  const [agents, setAgents] = useState<Collaborator[]>([]);
  const [userDefinedColors, setUserDefinedColors] = useState<string[]>([]);
  const [namedRanges, onChangeNamedRanges] = useState<NamedRange[]>([]);
  const [theme, onChangeTheme] = useState<SpreadsheetTheme>(
    defaultSpreadsheetTheme,
  );
  const [iterativeEnabled, setIterativeEnabled] = useState(false);
  const [shareDbConnectionState, setShareDbConnectionState] =
    useState<ShareDbConnectionState>("connecting");
  const [shareDbConnectionReason, setShareDbConnectionReason] = useState<
    string | null
  >(null);
  const [hasSeenShareDbConnected, setHasSeenShareDbConnected] =
    useState<boolean>(false);

  useEffect(() => {
    const handleStateChange = (state: unknown, reason?: unknown) => {
      const normalizedState = normalizeShareDbConnectionState(state);
      setShareDbConnectionState(normalizedState);

      if (normalizedState === "connected") {
        setHasSeenShareDbConnected(true);
      }

      if (normalizedState === "connected" || normalizedState === "connecting") {
        setShareDbConnectionReason(null);
        return;
      }

      const parsedReason = formatShareDbReason(reason);
      if (parsedReason) {
        setShareDbConnectionReason(parsedReason);
      }
    };

    const handleConnectionError = (error: unknown) => {
      const parsedError = formatShareDbReason(error);
      if (parsedError) {
        setShareDbConnectionReason(parsedError);
      }
    };

    connection.on("state", handleStateChange);
    connection.on("connection error", handleConnectionError);
    connection.on("error", handleConnectionError);

    handleStateChange(connection.state);

    return () => {
      connection.removeListener("state", handleStateChange);
      connection.removeListener("connection error", handleConnectionError);
      connection.removeListener("error", handleConnectionError);
    };
  }, []);

  const isShareDbConnected = shareDbConnectionState === "connected";
  const shouldShowShareDbStatus =
    !isShareDbConnected &&
    (shareDbConnectionState !== "connecting" || hasSeenShareDbConnected);
  const shareDbStatusLabel =
    shareDbConnectionState === "connecting"
      ? "Reconnecting..."
      : "Connection lost";
  const shareDbStatusTitle = shareDbConnectionReason
    ? `${shareDbStatusLabel}: ${shareDbConnectionReason}`
    : shareDbStatusLabel;

  useEffect(() => {
    if (typeof document === "undefined") return;

    const syncColorMode = () => {
      onChangeColorMode(getThemeModeFromBodyClass());
    };

    syncColorMode();

    if (typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver(syncColorMode);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

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
    documentId,
    userId: shareDbUserId,
    title: shareDbUserTitle,
    sheetId: activeSheetId,
    activeCell,
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
  });

  // sycjed
  useIsomorphicLayoutEffect(() => {
    if (synced) {
      hideLoader();
    } else {
      showLoader("Loading document...");
    }
  }, [synced]);

  useEffect(() => {
    if (synced) {
      setHasSeenShareDbConnected(true);
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

  const currentCellFormat = useMemo(
    () =>
      getEffectiveFormat(
        activeSheetId,
        activeCell.rowIndex,
        activeCell.columnIndex,
      ),
    [activeCell, activeSheetId, getEffectiveFormat],
  );

  // Spreadsheet Api
  const api = useSpreadsheetApi<CellData>();

  const handleExportExcel = useCallback(async () => {
    await exportToExcel({
      filename: `spreadsheet-${documentId}`,
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
    documentId,
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
      filename: `spreadsheet-${documentId}-${activeSheetId}`,
      rowData: sheetData[activeSheetId] ?? [],
      sharedStrings,
    });
  }, [documentId, activeSheetId, sheetData, sharedStrings]);

  const handleImportExcel = useCallback(
    async (file: File) => {
      await importExcelFile(file, {
        enableCellXfsRegistry: true,
        enabledSharedStrings: true,
        enableBackpressure: true,
      });
    },
    [importExcelFile],
  );

  const handleImportCSV = useCallback(
    async (file: File) => {
      await importCSVFile(file, activeSheetId, activeCell, {
        enableCellXfsRegistry: true,
        enabledSharedStrings: true,
      });
    },
    [importCSVFile, activeSheetId, activeCell],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <LoadingIndicator />
      {/* Inject sheets context into assistant instructions */}
      <SheetsInstructions
        sheets={sheets}
        activeSheetId={activeSheetId}
        activeCell={activeCell}
        documentId={documentId}
        cellXfs={cellXfs}
        tables={tables}
        getSheetProperties={getSheetProperties}
        getSheetName={getSheetName}
      />
      <Toolbar enableFloating>
        <FileMenu
          onImportExcel={handleImportExcel}
          onImportCSV={handleImportCSV}
          onExportExcel={handleExportExcel}
          onExportCSV={handleExportCSV}
        />
        <ToolbarSeparator />
        <ShareDocumentButton
          documentId={documentId}
          canManageShare={canManageShare}
        />
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
        <UiSeparator orientation="vertical" />
        <FormulaBarLabel>fx</FormulaBarLabel>
        <FormulaBarInput
          sheetId={activeSheetId}
          activeCell={activeCell}
          functionDescriptions={functionDescriptions}
        />
      </FormulaBar>

      <div className="min-h-0 flex-1 flex">
        <CanvasGrid
          {...spreadsheetColors}
          instanceId={documentId}
          users={users}
          userId={shareDbUserId}
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
          locale={locale}
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
        />
      </div>

      <BottomBar>
        <NewSheetButton onClick={onCreateNewSheet} />

        <SheetSwitcher
          sheets={sheets}
          activeSheetId={activeSheetId}
          onChangeActiveSheet={onChangeActiveSheet}
          onShowSheet={onShowSheet}
        />
        <SheetTabs
          sheets={sheets}
          protectedRanges={protectedRanges}
          activeSheetId={activeSheetId}
          theme={theme}
          onChangeActiveSheet={onChangeActiveSheet}
          onRenameSheet={onRenameSheet}
          onChangeSheetTabColor={onChangeSheetTabColor}
          onDeleteSheet={onDeleteSheet}
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
        {shouldShowShareDbStatus && (
          <span
            className={`inline-flex h-8 items-center rounded-lg border px-2.5 text-[11px] font-semibold ${
              shareDbConnectionState === "connecting"
                ? "border-(--panel-border) bg-(--assistant-chip-bg) text-(--muted-foreground)"
                : "border-(--panel-border) bg-(--assistant-stop-bg) text-(--assistant-stop-fg)"
            }`}
            title={shareDbStatusTitle}
            aria-live="polite"
          >
            {shareDbStatusLabel}
          </span>
        )}
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

type NewWorkspaceProps = {
  defaultLayout: WorkspacePanelLayout;
  documentId: string;
  currentUser: WorkspaceUser;
  initialThemeMode: ThemeMode;
  canManageShare: boolean;
  initialIsMobileLayout: boolean;
  isAdmin: boolean;
};

export function NewWorkspace({
  defaultLayout,
  documentId,
  currentUser,
  initialThemeMode,
  canManageShare,
  initialIsMobileLayout,
  isAdmin,
}: NewWorkspaceProps) {
  const isMobileLayout = useMediaQueryMatch(
    MOBILE_LAYOUT_MEDIA_QUERY,
    initialIsMobileLayout,
  );
  const [mobileTab, setMobileTab] = useState<"chat" | "sheet">("chat");
  // Create the assistant runtime at this level so both panes can use it
  const assistantRuntime = useSpreadsheetAssistantRuntime({
    docId: documentId,
  });
  const starterPrompts = useMemo(
    () =>
      pickSeededPrompts(
        FINANCE_STARTER_PROMPTS,
        STARTER_PROMPT_COUNT,
        documentId,
      ),
    [documentId],
  );

  const handleLayoutChanged = (layout: Record<string, number>) => {
    const spreadsheet = layout[SPREADSHEET_PANEL_ID];
    const assistant = layout[ASSISTANT_PANEL_ID];

    if (!Number.isFinite(spreadsheet) || !Number.isFinite(assistant)) {
      return;
    }

    document.cookie = [
      `${PANEL_LAYOUT_COOKIE}=${serializePanelLayoutCookie({
        [SPREADSHEET_PANEL_ID]: spreadsheet,
        [ASSISTANT_PANEL_ID]: assistant,
      })}`,
      "Path=/",
      "Max-Age=31536000",
      "SameSite=Lax",
    ].join("; ");
  };

  const spreadsheetPane = (
    <SpreadsheetPane
      documentId={documentId}
      currentUser={currentUser}
      initialThemeMode={initialThemeMode}
      canManageShare={canManageShare}
    />
  );

  const assistantPane = (
    <WorkspaceAssistantUI
      prompts={starterPrompts}
      docId={documentId}
      isAdmin={isAdmin}
      onNewSession={assistantRuntime.startNewThread}
      selectedModel={assistantRuntime.selectedModel}
      selectedModelLabel={assistantRuntime.selectedModelLabel}
      isModelPickerOpen={assistantRuntime.isModelPickerOpen}
      setIsModelPickerOpen={assistantRuntime.setIsModelPickerOpen}
      setSelectedModel={assistantRuntime.setSelectedModel}
      reasoningEnabled={assistantRuntime.reasoningEnabled}
      setReasoningEnabled={assistantRuntime.setReasoningEnabled}
      reasoningEnabledRef={assistantRuntime.reasoningEnabledRef}
      forceCompactHeader={isMobileLayout}
    />
  );

  return (
    <AssistantRuntimeProvider runtime={assistantRuntime.runtime}>
      <main className="flex min-h-dvh w-full flex-col overflow-hidden px-4 py-4 sm:px-5 sm:py-5 max-h-full">
        <div className="mb-4">
          <SiteHeader
            initialUser={{
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
            }}
          />
        </div>

        <SpreadsheetProvider>
          <div className="flex min-h-0 flex-1 flex-col">
            {isMobileLayout ? (
              <Tabs
                value={mobileTab}
                onValueChange={(value) =>
                  setMobileTab(value === "sheet" ? "sheet" : "chat")
                }
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border border-(--panel-border) bg-(--assistant-chip-bg) p-1">
                  <TabsTrigger
                    value="chat"
                    className="h-9 rounded-lg text-[15px] font-semibold tracking-[-0.01em] text-(--muted-foreground) data-[state=active]:bg-(--assistant-tabs-active-bg) data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_2px_var(--card-shadow)] data-[state=inactive]:hover:bg-(--assistant-chip-hover) data-[state=inactive]:hover:text-foreground"
                  >
                    Chat
                  </TabsTrigger>
                  <TabsTrigger
                    value="sheet"
                    className="h-9 rounded-lg text-[15px] font-semibold tracking-[-0.01em] text-(--muted-foreground) data-[state=active]:bg-(--assistant-tabs-active-bg) data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_2px_var(--card-shadow)] data-[state=inactive]:hover:bg-(--assistant-chip-hover) data-[state=inactive]:hover:text-foreground"
                  >
                    Sheet
                  </TabsTrigger>
                </TabsList>
                <div className="relative mt-2 min-h-0 flex-1 overflow-hidden">
                  <TabsContent
                    value="chat"
                    forceMount
                    className={`absolute inset-0 min-h-0 ${
                      mobileTab === "chat"
                        ? "z-10 flex"
                        : "z-0 flex pointer-events-none select-none opacity-0"
                    }`}
                  >
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      {assistantPane}
                    </div>
                  </TabsContent>
                  <TabsContent
                    value="sheet"
                    forceMount
                    className={`absolute inset-0 min-h-0 ${
                      mobileTab === "sheet"
                        ? "z-10 flex"
                        : "z-0 flex pointer-events-none select-none opacity-0"
                    }`}
                  >
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      {spreadsheetPane}
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            ) : (
              <Group
                id={PANEL_GROUP_ID}
                orientation="horizontal"
                defaultLayout={defaultLayout}
                onLayoutChanged={handleLayoutChanged}
                className="min-h-0 flex-1 flex"
                resizeTargetMinimumSize={{ coarse: 32, fine: 16 }}
              >
                <Panel
                  id={SPREADSHEET_PANEL_ID}
                  className="min-w-0 flex flex-col relative"
                >
                  {spreadsheetPane}
                </Panel>
                <PanelSeparator className="group flex w-4 cursor-col-resize touch-none select-none items-center justify-center bg-transparent outline-none transition-colors hover:bg-black/5 focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0">
                  <div className="pointer-events-none flex h-12 w-1 items-center justify-center rounded-full bg-black/15 transition-colors duration-150 group-hover:bg-black/30" />
                </PanelSeparator>
                <Panel
                  id={ASSISTANT_PANEL_ID}
                  minSize={`${ASSISTANT_PANEL_MIN_WIDTH}px`}
                  maxSize={`${ASSISTANT_PANEL_DEFAULT_WIDTH}px`}
                  groupResizeBehavior="preserve-pixel-size"
                  className="min-w-0"
                >
                  {assistantPane}
                </Panel>
              </Group>
            )}
          </div>
        </SpreadsheetProvider>
      </main>
    </AssistantRuntimeProvider>
  );
}
