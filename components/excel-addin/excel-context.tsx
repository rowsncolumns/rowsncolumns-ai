"use client";

import * as React from "react";

type ExcelSheetSummary = {
  sheetId: number;
  excelSheetId: string;
  name: string;
};

export type ExcelContextSnapshot = {
  isReady: boolean;
  activeSheetId: number | null;
  activeCell: {
    rowIndex: number;
    columnIndex: number;
    a1Address: string;
  } | null;
  sheets: ExcelSheetSummary[];
};

type ExcelContextValue = ExcelContextSnapshot & {
  runExcel: <T>(
    callback: (context: Excel.RequestContext) => Promise<T>,
  ) => Promise<T>;
  refreshSnapshot: () => Promise<void>;
};

const ExcelContext = React.createContext<ExcelContextValue | null>(null);

const INITIAL_SNAPSHOT: ExcelContextSnapshot = {
  isReady: false,
  activeSheetId: null,
  activeCell: null,
  sheets: [],
};

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function ExcelProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = React.useState<ExcelContextSnapshot>(
    INITIAL_SNAPSHOT,
  );
  const isMountedRef = React.useRef(false);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const runExcel = React.useCallback(
    async <T,>(callback: (context: Excel.RequestContext) => Promise<T>) => {
      return Excel.run(callback);
    },
    [],
  );

  const refreshSnapshot = React.useCallback(async () => {
    if (typeof Office === "undefined" || typeof Excel === "undefined") {
      return;
    }

    try {
      await Excel.run(async (context) => {
        const worksheets = context.workbook.worksheets;
        const activeWorksheet = worksheets.getActiveWorksheet();
        const activeCell = context.workbook.getActiveCell();

        worksheets.load("items/id,items/name,items/position");
        activeWorksheet.load("position");
        activeCell.load("address,rowIndex,columnIndex");
        await context.sync();

        const sheets = worksheets.items
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((sheet) => ({
            sheetId: sheet.position + 1,
            excelSheetId: sheet.id,
            name: sheet.name,
          }));

        if (!isMountedRef.current) {
          return;
        }

        setSnapshot({
          isReady: true,
          activeSheetId: activeWorksheet.position + 1,
          activeCell: {
            rowIndex: activeCell.rowIndex + 1,
            columnIndex: activeCell.columnIndex + 1,
            a1Address: activeCell.address,
          },
          sheets,
        });
      });
    } catch (error) {
      console.error("[excel-context] Failed to refresh snapshot", {
        error: toErrorMessage(error),
      });
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const tryInitialize = async () => {
      if (cancelled) {
        return true;
      }

      if (typeof Office === "undefined" || typeof Excel === "undefined") {
        return false;
      }

      try {
        await Office.onReady();
        if (cancelled || !isMountedRef.current) {
          return true;
        }
        await refreshSnapshot();
        return true;
      } catch (error) {
        if (cancelled) {
          return true;
        }
        console.error("[excel-context] Office initialization failed", {
          error: toErrorMessage(error),
        });
        return;
      }
    };

    const initialize = async () => {
      const initialized = await tryInitialize();
      if (initialized || cancelled) {
        return;
      }

      intervalId = window.setInterval(() => {
        void tryInitialize().then((didInitialize) => {
          if (didInitialize && intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        });
      }, 400);
    };

    void initialize();

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [refreshSnapshot]);

  const value = React.useMemo<ExcelContextValue>(
    () => ({
      ...snapshot,
      runExcel,
      refreshSnapshot,
    }),
    [refreshSnapshot, runExcel, snapshot],
  );

  return <ExcelContext.Provider value={value}>{children}</ExcelContext.Provider>;
}

export const useExcelContext = () => {
  const context = React.useContext(ExcelContext);
  if (!context) {
    throw new Error("useExcelContext must be used inside ExcelProvider.");
  }
  return context;
};
