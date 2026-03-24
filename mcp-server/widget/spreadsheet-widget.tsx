import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ShareDBClient from "sharedb/lib/client";
import {
  BottomBar,
  CanvasGrid,
  NewSheetButton,
  SheetStatus,
  SheetSwitcher,
  SheetTabs,
  SpreadsheetProvider,
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
} from "@rowsncolumns/spreadsheet";
import type { CellInterface } from "@rowsncolumns/grid";
import { useSpreadsheetState } from "@rowsncolumns/spreadsheet-state";
import type {
  CellXfs,
  SharedStrings,
  SheetData,
} from "@rowsncolumns/spreadsheet-state";
import { useShareDBSpreadsheet } from "@rowsncolumns/sharedb";

type WidgetConfig = {
  shareDbUrl?: string | null;
  shareDbPort?: string | null;
  appBaseUrl?: string | null;
};

type ToolPayload = {
  docId?: string;
  sheetId?: number;
  url?: string;
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
}: {
  docId: string;
  docUrl: string | null;
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
  const [namedRanges, onChangeNamedRanges] = useState<NamedRange[]>([]);
  const [protectedRanges, onChangeProtectedRanges] = useState<ProtectedRange[]>(
    [],
  );
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
  const [colorMode] = useState<ColorMode>("light");
  const [iterativeEnabled, setIterativeEnabled] = useState(false);

  const user = useMemo(
    () => ({
      id: "mcp-user",
      title: "MCP User",
    }),
    [],
  );

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
    spreadsheetColors,
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
    onResize,
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
    onDragOver,
    onDrop,
    onFreezeColumn,
    onFreezeRow,
    onUpdateNote,
    onSortRange,
    onProtectRange,
    onUnProtectRange,
    enqueueGraphOperation,
    getDataValidation,
    getSheetRowCount,
    getSheetColumnCount,
    onChangeBatchStream,
    calculateNow,
    onCreateNewSheet,
    onUpdateSheet,
    onDeleteSheet,
    onDuplicateSheet,
    onShowSheet,
    onHideSheet,
    onRenameSheet,
    onChangeSheetTabColor,
    onMoveSheet,
    onProtectSheet,
    onUnProtectSheet,
    onShowColumn,
    onHideColumn,
    onShowRow,
    onHideRow,
  } = useSpreadsheetState({
    onIterativeCalculationEnabled: setIterativeEnabled,
    recalculateOnOpen: false,
    preserveFormattingOnPaste: true,
    sheets,
    sheetData,
    tables,
    namedRanges,
    conditionalFormats,
    dataValidations,
    theme,
    colorMode,
    locale: "en-US",
    cellXfs,
    sharedStrings,
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
    onChangeHistory(patches) {
      onBroadcastPatch(patches);
    },
    citations: [],
    onChangeCitations: () => {},
    iterativeCalculation: {
      enabled: iterativeEnabled,
      maxChange: 0.001,
      maxIterations: 100,
    },
  });

  const { onBroadcastPatch, users } = useShareDBSpreadsheet({
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

  useEffect(() => {
    return () => {
      connection.close();
    };
  }, [connection]);

  return (
    <SpreadsheetProvider>
      <div className="rnc-widget-sheet">
        <CanvasGrid
          {...spreadsheetColors}
          licenseKey="evaluation-license"
          instanceId={docId}
          users={users}
          userId={user.id}
          sheetId={activeSheetId}
          rowCount={rowCount}
          columnCount={columnCount}
          frozenColumnCount={frozenColumnCount}
          frozenRowCount={frozenRowCount}
          rowMetadata={rowMetadata}
          columnMetadata={columnMetadata}
          activeCell={activeCell}
          selections={selections}
          theme={theme}
          merges={merges}
          tables={tables}
          charts={charts}
          embeds={embeds}
          pivotTables={pivotTables}
          basicFilter={basicFilter}
          protectedRanges={protectedRanges}
          bandedRanges={bandedRanges}
          conditionalFormats={conditionalFormats}
          getCellData={getCellData}
          getDataValidation={getDataValidation}
          getDataRowCount={getDataRowCount}
          getSheetRowCount={getSheetRowCount}
          getSheetColumnCount={getSheetColumnCount}
          getSheetName={getSheetName}
          getSheetId={getSheetId}
          getEffectiveFormat={getEffectiveFormat}
          showGridLines={showGridLines}
          onRequestCalculate={onRequestCalculate}
          onChangeActiveCell={onChangeActiveCell}
          onChangeSelections={onChangeSelections}
          onChangeActiveSheet={onChangeActiveSheet}
          onSelectNextSheet={onSelectNextSheet}
          onSelectPreviousSheet={onSelectPreviousSheet}
          onChange={onChange}
          onChangeBatch={onChangeBatch}
          onChangeBatchStream={onChangeBatchStream}
          onDelete={onDelete}
          onClearContents={onDelete}
          onChangeFormatting={onChangeFormatting}
          onRepeatFormatting={onRepeatFormatting}
          onClearFormatting={onClearFormatting}
          onResize={onResize}
          onDeleteRow={onDeleteRow}
          onDeleteColumn={onDeleteColumn}
          onDeleteCellsShiftUp={onDeleteCellsShiftUp}
          onDeleteCellsShiftLeft={onDeleteCellsShiftLeft}
          onInsertCellsShiftDown={onInsertCellsShiftDown}
          onInsertCellsShiftRight={onInsertCellsShiftRight}
          onInsertRow={onInsertRow}
          onInsertColumn={onInsertColumn}
          onMoveColumns={onMoveColumns}
          onMoveRows={onMoveRows}
          onMoveSelection={onMoveSelection}
          onSortColumn={onSortColumn}
          onSortTable={onSortTable}
          onFilterTable={onFilterTable}
          onResizeTable={onResizeTable}
          onCopy={onCopy}
          onPaste={onPaste}
          onCreateBasicFilter={onCreateBasicFilter}
          onCreateTable={onCreateTable}
          onRemoveTable={onRemoveTable}
          onRequestEditTable={onRequestEditTable}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onFreezeColumn={onFreezeColumn}
          onFreezeRow={onFreezeRow}
          onUpdateNote={onUpdateNote}
          onSortRange={onSortRange}
          onProtectRange={onProtectRange}
          onUnProtectRange={onUnProtectRange}
          onCreateNewSheet={onCreateNewSheet}
          onUpdateSheet={onUpdateSheet}
          onDeleteSheet={onDeleteSheet}
          onDuplicateSheet={onDuplicateSheet}
          onShowColumn={onShowColumn}
          onHideColumn={onHideColumn}
          onShowRow={onShowRow}
          onHideRow={onHideRow}
        />
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
        </BottomBar>
      </div>
    </SpreadsheetProvider>
  );
}

function App() {
  const [docId, setDocId] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState(
    "Run open_spreadsheet to load a spreadsheet.",
  );
  const [openUrl, setOpenUrl] = useState<string | null>(null);
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
          setOpenUrl(payload.url ?? null);
          setMeta(`Document ${payload.docId}`);
        }
      }

      if (message.method === "ui/notifications/tool-result") {
        const payload = parseToolPayload(message.params?.structuredContent);
        if (payload?.docId) {
          setDocId(payload.docId);
          setDocUrl(payload.url ?? null);
          setOpenUrl(payload.url ?? null);
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
  }, [docId]);

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

  return <SpreadsheetDocumentView key={docId} docId={docId} docUrl={docUrl} />;
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
