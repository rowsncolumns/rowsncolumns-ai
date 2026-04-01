"use client";

import { functionDescriptions, functions } from "@rowsncolumns/functions";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  useGetViewPort,
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
import {
  CircularLoader,
  IconButton,
  Separator as UiSeparator,
} from "@rowsncolumns/ui";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from "react-resizable-panels";

import { FileMenu } from "@/components/file-menu";
import { ShareDocumentButton } from "@/components/share-document-button";
import { SiteHeader } from "@/components/site-header";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HistorySidebar } from "@/components/history-sidebar";
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
import { useThread } from "@assistant-ui/react";
import { MagnifyingGlassIcon, TimerIcon } from "@rowsncolumns/icons";
import { Citation } from "@rowsncolumns/common-types";
import { addressToSelection, uuid } from "@rowsncolumns/utils";
import {
  ChartComponent,
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
import { ChevronRight, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

const appendShareDbQueryParam = (
  url: string,
  key: string,
  value: string,
): string => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
};

const getMcpTokenFromUrl = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const token = new URLSearchParams(window.location.search).get("mcpToken");
  const trimmed = token?.trim();
  return trimmed ? trimmed : null;
};

const getShareDbBaseUrl = () => {
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
type ShareDBSocketWithDiagnostics = ShareDBSocket & {
  connect: () => void;
  getLastCloseReason: () => string | null;
};
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

const describeWebSocketCloseCode = (code: number): string => {
  switch (code) {
    case 1000:
      return "Connection closed normally";
    case 1001:
      return "Connection closed (going away)";
    case 1006:
      return "Connection closed unexpectedly";
    case 1008:
      return "Connection rejected by policy";
    case 1009:
      return "Payload too large. Upload a smaller file or increase server payload limit.";
    case 1011:
      return "Server error while handling websocket message";
    default:
      return `Connection closed (code ${code})`;
  }
};

const normalizeShareDbReasonText = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined") {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (
    lowered.includes("max payload size exceeded") ||
    lowered.includes("unsupported message length")
  ) {
    return describeWebSocketCloseCode(1009);
  }
  if (lowered.includes("authentication required")) {
    return "Authentication required to access this document.";
  }

  return trimmed;
};

const formatShareDbReason = (reason: unknown): string | null => {
  if (!reason) return null;
  if (typeof reason === "string") {
    return normalizeShareDbReasonText(reason);
  }
  if (reason instanceof Error) {
    return normalizeShareDbReasonText(reason.message) ?? reason.name;
  }
  if (typeof reason === "object") {
    const value = reason as {
      message?: unknown;
      reason?: unknown;
      code?: unknown;
      type?: unknown;
    };
    if (
      typeof value.reason === "string" &&
      normalizeShareDbReasonText(value.reason)
    ) {
      return normalizeShareDbReasonText(value.reason);
    }
    if (
      typeof value.message === "string" &&
      normalizeShareDbReasonText(value.message)
    ) {
      return normalizeShareDbReasonText(value.message);
    }
    if (typeof value.code === "number") {
      return describeWebSocketCloseCode(value.code);
    }
    if (typeof value.type === "string" && value.type.trim()) {
      return value.type.trim();
    }
  }
  return null;
};

const createShareDbSocket = (
  urlProvider: ConstructorParameters<typeof ReconnectingWebSocket>[0],
): ShareDBSocketWithDiagnostics => {
  // Keep socket closed during render; open it from a committed effect only.
  const reconnectingSocket = new ReconnectingWebSocket(urlProvider, [], {
    startClosed: true,
  });
  let lastCloseReason: string | null = null;

  const socket: ShareDBSocketWithDiagnostics = {
    get readyState() {
      return reconnectingSocket.readyState;
    },
    connect() {
      reconnectingSocket.reconnect();
    },
    close(reason?: number) {
      reconnectingSocket.close(reason);
    },
    send(data: unknown) {
      reconnectingSocket.send(
        data as Parameters<typeof reconnectingSocket.send>[0],
      );
    },
    onmessage: () => {},
    onclose: () => {},
    onerror: () => {},
    onopen: () => {},
    getLastCloseReason() {
      return lastCloseReason;
    },
  };

  reconnectingSocket.onmessage = (event) => {
    socket.onmessage(event);
  };
  reconnectingSocket.onclose = (event) => {
    const parsedReason = formatShareDbReason(event);
    if (parsedReason) {
      lastCloseReason = parsedReason;
    }
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
const MOBILE_STARTER_PROMPT_COUNT = 2;

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

const ASSISTANT_PANEL_MIN_WIDTH = "25%";
const ASSISTANT_PANEL_DEFAULT_WIDTH = "50%";
const MOBILE_LAYOUT_MEDIA_QUERY = "(max-width: 767px)";
const APP_TITLE_SUFFIX = "RowsnColumns AI";

const toShortDocumentId = (documentId: string): string =>
  documentId.slice(0, 8);

const getFallbackDocumentTitle = (documentId: string): string =>
  `Document ${toShortDocumentId(documentId)}`;

type UpdateDocumentTitleResponse = {
  title?: string;
  error?: string;
};

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

export type WorkspaceUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

function SpreadsheetPane({
  documentId,
  currentUser,
  initialThemeMode,
  canManageShare,
  canEdit,
  canUseAuditHistory,
  onOpenHistorySidebar,
  locale,
  currency,
}: {
  documentId: string;
  currentUser: WorkspaceUser;
  initialThemeMode: ThemeMode;
  canManageShare: boolean;
  canEdit: boolean;
  canUseAuditHistory: boolean;
  onOpenHistorySidebar: () => void;
  locale: string;
  currency: string;
}) {
  const router = useRouter();
  const { data: sessionData } = authClient.useSession();
  const user = sessionData?.user ?? currentUser;
  const shareDbUserId = user.id;
  const shareDbUserTitle = user.name?.trim() || user.email || "User";
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
  const [citations, onChangeCitations] = useState<Citation[]>([]);
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

  const { connection, socket } = useMemo(() => {
    const urlProvider = async (): Promise<string> => {
      const url = getShareDbBaseUrl();

      const mcpToken = getMcpTokenFromUrl();
      if (mcpToken) {
        return appendShareDbQueryParam(url, "mcpToken", mcpToken);
      }

      try {
        const response = await fetch(
          `/api/sharedb/ws-token?docId=${encodeURIComponent(documentId)}`,
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          },
        );
        if (!response.ok) {
          return url;
        }
        const payload = (await response.json().catch(() => null)) as {
          token?: unknown;
        } | null;
        if (typeof payload?.token !== "string") {
          return url;
        }
        const refreshedToken = payload.token.trim();
        if (!refreshedToken) {
          return url;
        }
        return appendShareDbQueryParam(url, "wsToken", refreshedToken);
      } catch {
        return url;
      }
    };

    const nextSocket = createShareDbSocket(urlProvider);
    const nextConnection = new ShareDBClient.Connection(nextSocket);
    return {
      connection: nextConnection,
      socket: nextSocket,
    };
  }, [documentId]);

  useEffect(() => {
    try {
      socket.connect();
    } catch {
      // Ignore connect errors and let ShareDB state listeners surface issues.
    }
    return () => {
      try {
        connection.close();
      } catch {
        // Ignore close errors while unmounting.
      }
      try {
        socket.close(1000);
      } catch {
        // Ignore close errors while unmounting.
      }
    };
  }, [connection, socket]);

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

      const parsedReason =
        formatShareDbReason(reason) ?? socket.getLastCloseReason();
      setShareDbConnectionReason(parsedReason);
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
  }, [connection, socket]);

  const isShareDbConnected = shareDbConnectionState === "connected";
  const isShareDbConnecting =
    shareDbConnectionState === "connecting" ||
    (!hasSeenShareDbConnected && !isShareDbConnected);
  const shareDbStatusLabel = isShareDbConnected
    ? "Connected"
    : isShareDbConnecting
      ? hasSeenShareDbConnected
        ? "Reconnecting..."
        : "Connecting..."
      : "Connection lost";
  const shareDbStatusTitle = shareDbConnectionReason
    ? `${shareDbStatusLabel}: ${shareDbConnectionReason}`
    : shareDbStatusLabel;
  const shareDbIndicatorClass = isShareDbConnected
    ? "bg-emerald-500"
    : isShareDbConnecting
      ? "bg-amber-500 animate-pulse"
      : "bg-red-500";
  const shareDbServerUrl = useMemo(() => getShareDbBaseUrl(), []);
  const shareDbServerHost = useMemo(() => {
    try {
      return new URL(shareDbServerUrl).host;
    } catch {
      return shareDbServerUrl;
    }
  }, [shareDbServerUrl]);

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
      if (!canEdit) {
        return;
      }
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
    onChangeCitations,
    calculateNow,
    enqueueGraphOperation,
    onChangeIterativeCalculation: setIterativeEnabled,
  });
  const connectedClientCount = Math.max(1, users.length);

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

  // Viewport getter
  const getViewPort = useGetViewPort();

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
    <div
      className="rnc-workspace-spreadsheet-pane flex h-full min-h-0 flex-1 flex-col min-w-0"
      data-locale={locale}
      data-currency={currency}
    >
      <LoadingIndicator
        style={{
          transform: `translate3d(0,0,0)`,
        }}
      />
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
        charts={charts}
        getViewPort={getViewPort}
        namedRanges={namedRanges}
      />
      <Toolbar
        enableFloating
        className={`rnc-workspace-toolbar rounded-tl-xl rounded-tr-xl ${
          canEdit ? "" : "pointer-events-none opacity-70"
        }`}
      >
        <FileMenu
          onImportExcel={handleImportExcel}
          onImportCSV={handleImportCSV}
          onExportExcel={handleExportExcel}
          onExportCSV={handleExportCSV}
          onCreateNew={(newDocId) => router.push(`/sheets/${newDocId}`)}
        />
        <ToolbarSeparator />
        <ShareDocumentButton
          documentId={documentId}
          canManageShare={canManageShare}
        />
        {canUseAuditHistory ? (
          <IconButton onClick={onOpenHistorySidebar} tooltip="Version History">
            <TimerIcon />
          </IconButton>
        ) : null}
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
          onClick={async () => {
            const range = selections.length
              ? selections[selections.length - 1].range
              : selectionFromActiveCell(activeCell)[0].range;
            await api?.exportRange?.(
              {
                ...range,
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

      <FormulaBar
        className={`rnc-workspace-formula-bar ${
          canEdit ? "" : "pointer-events-none"
        }`}
      >
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

      <div className="rnc-workspace-grid-frame min-h-0 flex-1 flex relative overflow-hidden">
        <CanvasGrid
          {...spreadsheetColors}
          enableQuickEdit={false}
          enableMagicFill={false}
          locale={locale}
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
          readonly={!canEdit}
        />
      </div>

      <BottomBar className="rnc-workspace-bottom-bar rounded-bl-xl rounded-br-xl">
        {canEdit ? <NewSheetButton onClick={onCreateNewSheet} /> : null}

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
          readonly={!canEdit}
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
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-7 w-7 shrink-0 items-center gap-2 rounded-full border border-(--panel-border) bg-(--assistant-chip-bg) px-2 text-[11px] font-semibold text-(--muted-foreground) hover:bg-(--assistant-chip-hover)"
              title={shareDbStatusTitle}
              aria-label={shareDbStatusTitle}
              aria-live="polite"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${shareDbIndicatorClass}`}
                aria-hidden="true"
              />
              <span className="sr-only">{shareDbStatusTitle}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-(--muted-foreground)">
                  Status
                </span>
                <span className="inline-flex items-center gap-2 text-xs font-semibold">
                  <span
                    className={`h-2 w-2 rounded-full ${shareDbIndicatorClass}`}
                    aria-hidden="true"
                  />
                  {shareDbStatusLabel}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-(--muted-foreground)">
                  Server
                </span>
                <span
                  className="max-w-[11rem] truncate text-xs font-medium"
                  title={shareDbServerUrl}
                >
                  {shareDbServerHost}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-(--muted-foreground)">
                  Connected Clients
                </span>
                <span className="text-xs font-semibold tabular-nums">
                  {connectedClientCount}
                </span>
              </div>
              {shareDbConnectionReason ? (
                <div className="rounded-md border border-(--panel-border) bg-(--assistant-chip-bg) px-2 py-1.5 text-[11px] text-(--muted-foreground)">
                  {shareDbConnectionReason}
                </div>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
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
  initialDocumentTitle: string;
  currentUser: WorkspaceUser;
  initialThemeMode: ThemeMode;
  canManageShare: boolean;
  canEdit: boolean;
  canUseAuditHistory: boolean;
  initialIsMobileLayout: boolean;
  isAdmin: boolean;
  locale: string;
  currency: string;
};

type SpreadsheetOnlyWorkspaceProps = {
  documentId: string;
  currentUser: WorkspaceUser;
  initialThemeMode: ThemeMode;
  canManageShare: boolean;
  canEdit: boolean;
  canUseAuditHistory?: boolean;
  locale: string;
  currency: string;
};

type CollapsedAssistantButtonProps = {
  isRunningSignal: boolean;
  showAssistantBubbleEntrance: boolean;
  onOpen: () => void;
};

function CollapsedAssistantButton({
  isRunningSignal,
  showAssistantBubbleEntrance,
  onOpen,
}: CollapsedAssistantButtonProps) {
  const isThreadRunning = useThread((thread) => thread.isRunning);
  const isBusy = isThreadRunning || isRunningSignal;

  return (
    <button
      onClick={onOpen}
      className={`assistant-bubble rnc-workspace-assistant-bubble ${
        showAssistantBubbleEntrance ? "animate-bubble-entrance" : ""
      } fixed bottom-6 right-6 z-50 flex h-12 items-center gap-2 rounded-full bg-linear-to-br from-orange-400 to-orange-500 pl-4 pr-5 text-white transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2`}
      aria-label={
        isBusy ? "Open assistant (run in progress)" : "Open assistant"
      }
    >
      <MessageSquare className="bubble-icon h-5 w-5 transition-transform duration-300" />
      <span className="text-sm font-medium">Ask AI</span>
      {isBusy && (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
      )}
    </button>
  );
}

type DocumentTitleInlineEditorProps = {
  documentId: string;
  initialTitle: string;
  canEdit: boolean;
};

function DocumentTitleInlineEditor({
  documentId,
  initialTitle,
  canEdit,
}: DocumentTitleInlineEditorProps) {
  const fallbackTitle = useMemo(
    () => getFallbackDocumentTitle(documentId),
    [documentId],
  );
  const [title, setTitle] = useState(initialTitle.trim() || fallbackTitle);
  const [draftTitle, setDraftTitle] = useState(
    initialTitle.trim() || fallbackTitle,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurSaveRef = useRef(false);

  useEffect(() => {
    const normalizedInitialTitle = initialTitle.trim() || fallbackTitle;
    setTitle(normalizedInitialTitle);
    setDraftTitle(normalizedInitialTitle);
  }, [initialTitle, fallbackTitle]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.title = `${title} | ${APP_TITLE_SUFFIX}`;
  }, [title]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const startEditing = () => {
    if (!canEdit || isSaving) {
      return;
    }
    setDraftTitle(title);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    skipBlurSaveRef.current = true;
    setDraftTitle(title);
    setIsEditing(false);
  };

  const saveTitle = useCallback(async () => {
    if (!canEdit || isSaving) {
      return;
    }

    const normalizedTitle = draftTitle.trim() || fallbackTitle;
    if (normalizedTitle === title) {
      setDraftTitle(normalizedTitle);
      setIsEditing(false);
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/documents/title", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentId,
          title: normalizedTitle,
        }),
      });

      const payload = (await response
        .json()
        .catch(() => null)) as UpdateDocumentTitleResponse | null;
      if (!response.ok) {
        const message = payload?.error || "Failed to update document title.";
        throw new Error(message);
      }

      const savedTitle = payload?.title?.trim() || normalizedTitle;
      setTitle(savedTitle);
      setDraftTitle(savedTitle);
      setIsEditing(false);
      toast.success("Sheet title updated.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update document title.";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }, [canEdit, documentId, draftTitle, fallbackTitle, isSaving, title]);

  return (
    <div className="rnc-workspace-breadcrumbs mb-2 px-1 sm:px-2">
      <div className="flex h-11 items-center gap-1.5">
        <Link
          href="/sheets"
          className="shrink-0 text-xs text-(--muted-foreground) hover:text-foreground"
        >
          My Sheets
        </Link>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-(--muted-foreground)" />
        {isSaving ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-(--muted-foreground)"
            aria-hidden="true"
          />
        ) : null}
        <div className="min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveTitle();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditing();
                }
              }}
              onBlur={() => {
                if (skipBlurSaveRef.current) {
                  skipBlurSaveRef.current = false;
                  return;
                }
                void saveTitle();
              }}
              maxLength={160}
              disabled={isSaving}
              style={{ fieldSizing: "content" }}
              className="h-9 min-w-20 max-w-full rounded-lg border border-(--panel-border) bg-(--card-bg) px-3 text-lg font-semibold text-foreground outline-none transition focus:border-orange-400 sm:text-xl"
              aria-label="Document title"
            />
          ) : canEdit ? (
            <button
              type="button"
              onClick={startEditing}
              className="h-9 w-full cursor-text rounded-lg border border-transparent px-3 text-left text-lg font-semibold tracking-[-0.01em] text-foreground transition hover:border-(--panel-border) hover:text-orange-500 sm:text-xl"
              aria-label="Edit document title"
            >
              <span className="block truncate">{title}</span>
            </button>
          ) : (
            <h1 className="flex h-9 items-center truncate px-3 text-lg font-semibold tracking-[-0.01em] text-foreground sm:text-xl">
              {title}
            </h1>
          )}
        </div>
      </div>
    </div>
  );
}

export function SpreadsheetOnlyWorkspace({
  documentId,
  currentUser,
  initialThemeMode,
  canManageShare,
  canEdit,
  canUseAuditHistory = false,
  locale,
  currency,
}: SpreadsheetOnlyWorkspaceProps) {
  const [isHistorySidebarOpen, setIsHistorySidebarOpen] = useState(false);

  const activitySidebar =
    canUseAuditHistory && isHistorySidebarOpen ? (
      <div className="pointer-events-none absolute inset-y-0 right-0 z-40">
        <div className="pointer-events-auto h-full">
          <HistorySidebar
            documentId={documentId}
            isOpen={isHistorySidebarOpen}
            onClose={() => setIsHistorySidebarOpen(false)}
            canEdit={canEdit}
            currentUser={{
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
            }}
          />
        </div>
      </div>
    ) : null;

  const spreadsheetPane = (
    <SpreadsheetPane
      documentId={documentId}
      currentUser={currentUser}
      initialThemeMode={initialThemeMode}
      canManageShare={canManageShare}
      canEdit={canEdit}
      canUseAuditHistory={canUseAuditHistory}
      onOpenHistorySidebar={() => setIsHistorySidebarOpen(true)}
      locale={locale}
      currency={currency}
    />
  );

  return (
    <main className="flex h-[100svh] w-full flex-col overflow-hidden sm:h-dvh">
      <SpreadsheetProvider>
        <div className="relative min-h-0 flex-1 flex flex-col">
          {spreadsheetPane}
          {activitySidebar}
        </div>
      </SpreadsheetProvider>
    </main>
  );
}

export function NewWorkspace({
  defaultLayout,
  documentId,
  initialDocumentTitle,
  currentUser,
  initialThemeMode,
  canManageShare,
  canEdit,
  canUseAuditHistory,
  initialIsMobileLayout,
  isAdmin,
  locale,
  currency,
}: NewWorkspaceProps) {
  const isMobileLayout = useMediaQueryMatch(
    MOBILE_LAYOUT_MEDIA_QUERY,
    initialIsMobileLayout,
  );
  const [mobileTab, setMobileTab] = useState<"chat" | "sheet">("chat");
  const [isAssistantCollapsed, setIsAssistantCollapsed] = useState(false);
  const [isHistorySidebarOpen, setIsHistorySidebarOpen] = useState(false);
  const [showAssistantBubbleEntrance, setShowAssistantBubbleEntrance] =
    useState(false);
  // Create the assistant runtime at this level so both panes can use it
  const assistantRuntime = useSpreadsheetAssistantRuntime({
    docId: documentId,
  });
  const starterPrompts = useMemo(
    () =>
      pickSeededPrompts(
        FINANCE_STARTER_PROMPTS,
        isMobileLayout ? MOBILE_STARTER_PROMPT_COUNT : STARTER_PROMPT_COUNT,
        documentId,
      ),
    [documentId, isMobileLayout],
  );

  useEffect(() => {
    if (!isAssistantCollapsed) {
      setShowAssistantBubbleEntrance(false);
      return;
    }

    setShowAssistantBubbleEntrance(true);
    const timeoutId = window.setTimeout(() => {
      setShowAssistantBubbleEntrance(false);
    }, 400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isAssistantCollapsed]);

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
      canEdit={canEdit}
      canUseAuditHistory={canUseAuditHistory}
      onOpenHistorySidebar={() => setIsHistorySidebarOpen(true)}
      locale={locale}
      currency={currency}
    />
  );

  const activitySidebar =
    canUseAuditHistory && isHistorySidebarOpen ? (
      <div className="h-full w-100 ml-4">
        <HistorySidebar
          documentId={documentId}
          isOpen={isHistorySidebarOpen}
          onClose={() => setIsHistorySidebarOpen(false)}
          canEdit={canEdit}
          currentUser={{
            id: currentUser.id,
            name: currentUser.name,
            email: currentUser.email,
          }}
        />
      </div>
    ) : null;

  const assistantPane = (
    <WorkspaceAssistantUI
      prompts={starterPrompts}
      docId={documentId}
      isAdmin={isAdmin}
      threadId={assistantRuntime.threadId}
      onNewSession={assistantRuntime.startNewThread}
      onSelectSession={assistantRuntime.selectThread}
      onForkConversation={assistantRuntime.forkConversation}
      isForkingRef={assistantRuntime.isForkingRef}
      isHydratingSession={assistantRuntime.isHydratingSession}
      isResumingRun={assistantRuntime.isResumingRun}
      isReconnecting={assistantRuntime.isReconnecting}
      contextUsage={assistantRuntime.contextUsage}
      selectedModel={assistantRuntime.selectedModel}
      selectedModelLabel={assistantRuntime.selectedModelLabel}
      isModelPickerOpen={assistantRuntime.isModelPickerOpen}
      setIsModelPickerOpen={assistantRuntime.setIsModelPickerOpen}
      setSelectedModel={assistantRuntime.setSelectedModel}
      selectedMode={assistantRuntime.selectedMode}
      selectedModeLabel={assistantRuntime.selectedModeLabel}
      isModePickerOpen={assistantRuntime.isModePickerOpen}
      setIsModePickerOpen={assistantRuntime.setIsModePickerOpen}
      setSelectedMode={assistantRuntime.setSelectedMode}
      reasoningEnabled={assistantRuntime.reasoningEnabled}
      setReasoningEnabled={assistantRuntime.setReasoningEnabled}
      reasoningEnabledRef={assistantRuntime.reasoningEnabledRef}
      forceCompactHeader={isMobileLayout}
      onClose={() => setIsAssistantCollapsed(true)}
    />
  );

  return (
    <AssistantRuntimeProvider runtime={assistantRuntime.runtime}>
      <main className="rnc-workspace-page flex h-[100svh] w-full flex-col overflow-hidden px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:h-dvh sm:px-5 sm:pt-5 sm:pb-5">
        <div className="rnc-workspace-site-header mb-4">
          <SiteHeader
            initialUser={{
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
              image: currentUser.image,
            }}
          />
        </div>
        <DocumentTitleInlineEditor
          documentId={documentId}
          initialTitle={initialDocumentTitle}
          canEdit={canManageShare}
        />

        <SpreadsheetProvider>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {isMobileLayout ? (
              <Tabs
                value={mobileTab}
                onValueChange={(value) =>
                  setMobileTab(value === "sheet" ? "sheet" : "chat")
                }
                className="rnc-workspace-mobile-tabs flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border border-(--panel-border) bg-(--assistant-chip-bg) p-1">
                  <TabsTrigger
                    value="chat"
                    className="h-9 rounded-lg text-[15px] font-semibold tracking-[-0.01em] text-(--muted-foreground) data-[state=active]:bg-(--assistant-tabs-active-bg) data-[state=active]:text-foreground  data-[state=inactive]:hover:bg-(--assistant-chip-hover) data-[state=inactive]:hover:text-foreground data[state=active]:shadow-lg"
                  >
                    Chat
                  </TabsTrigger>
                  <TabsTrigger
                    value="sheet"
                    className="h-9 rounded-lg text-[15px] font-semibold tracking-[-0.01em] text-(--muted-foreground) data-[state=active]:bg-(--assistant-tabs-active-bg) data-[state=active]:text-foreground data-[state=inactive]:hover:bg-(--assistant-chip-hover) data-[state=inactive]:hover:text-foreground data[state=active]:shadow-lg"
                  >
                    Sheet
                  </TabsTrigger>
                </TabsList>
                <div className="relative mt-2 min-h-0 flex-1 overflow-hidden">
                  <TabsContent
                    value="chat"
                    forceMount
                    className={`rnc-workspace-mobile-chat absolute inset-0 min-h-0 ${
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
                    className={`rnc-workspace-mobile-sheet absolute inset-0 min-h-0 ${
                      mobileTab === "sheet"
                        ? "z-10 flex"
                        : "z-0 flex pointer-events-none select-none opacity-0"
                    }`}
                  >
                    <div className="relative flex min-h-0 flex-1 flex-row overflow-hidden">
                      {spreadsheetPane}
                      {activitySidebar}
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            ) : (
              <>
                <Group
                  id={PANEL_GROUP_ID}
                  orientation="horizontal"
                  defaultLayout={defaultLayout}
                  onLayoutChanged={handleLayoutChanged}
                  className="rnc-workspace-panels min-h-0 flex-1 flex"
                  resizeTargetMinimumSize={{ coarse: 32, fine: 16 }}
                >
                  <Panel
                    id={SPREADSHEET_PANEL_ID}
                    className="rnc-workspace-spreadsheet-panel min-w-0 flex flex-row relative"
                  >
                    {spreadsheetPane}
                    {activitySidebar}
                  </Panel>
                  {!isAssistantCollapsed && (
                    <>
                      <PanelSeparator className="rnc-workspace-assistant-separator group flex w-4 cursor-col-resize touch-none select-none items-center justify-center bg-transparent outline-none transition-colors hover:bg-black/5 focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0">
                        <div className="pointer-events-none flex h-12 w-1 items-center justify-center rounded-full bg-black/15 transition-colors duration-150 group-hover:bg-black/30" />
                      </PanelSeparator>
                      <Panel
                        id={ASSISTANT_PANEL_ID}
                        minSize={ASSISTANT_PANEL_MIN_WIDTH}
                        maxSize={ASSISTANT_PANEL_DEFAULT_WIDTH}
                        groupResizeBehavior="preserve-pixel-size"
                        className="rnc-workspace-assistant-panel min-w-0"
                      >
                        {assistantPane}
                      </Panel>
                    </>
                  )}
                </Group>
                {/* Floating bubble when assistant is collapsed */}
                {isAssistantCollapsed && (
                  <CollapsedAssistantButton
                    showAssistantBubbleEntrance={showAssistantBubbleEntrance}
                    isRunningSignal={
                      assistantRuntime.isHydratingSession ||
                      assistantRuntime.isResumingRun ||
                      assistantRuntime.isReconnecting
                    }
                    onOpen={() => setIsAssistantCollapsed(false)}
                  />
                )}
              </>
            )}
          </div>
        </SpreadsheetProvider>
      </main>
    </AssistantRuntimeProvider>
  );
}
