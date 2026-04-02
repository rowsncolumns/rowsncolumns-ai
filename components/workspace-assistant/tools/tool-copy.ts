import type { ToolCopy } from "./tool-types";

const TOOL_UI_COPY: Record<string, ToolCopy> = {
  spreadsheet_changeBatch: {
    running: "Updating spreadsheet data",
    success: "Updated spreadsheet data",
    failed: "Failed to update spreadsheet data",
  },
  spreadsheet_getSheetMetadata: {
    running: "Reading sheet metadata",
    success: "Read sheet metadata",
    failed: "Failed to read sheet metadata",
  },
  spreadsheet_formatRange: {
    running: "Applying formatting",
    success: "Applied formatting",
    failed: "Failed to apply formatting",
  },
  spreadsheet_modifyRowsCols: {
    running: "Modifying rows/columns",
    success: "Modified rows/columns",
    failed: "Failed to modify rows/columns",
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
    running: "Reading spreadsheet",
    success: "Read spreadsheet",
    failed: "Failed to spreadsheet",
  },
  spreadsheet_getRowColMetadata: {
    running: "Reading row/column metadata",
    success: "Read row/column metadata",
    failed: "Failed to read row/column metadata",
  },
  spreadsheet_setRowColMetadata: {
    running: "Setting row/column dimensions",
    success: "Set row/column dimensions",
    failed: "Failed to set row/column dimensions",
  },
  spreadsheet_applyFill: {
    running: "Applying fill",
    success: "Applied fill",
    failed: "Failed to apply fill",
  },
  // Consolidated tools
  spreadsheet_clearCells: {
    running: "Clearing cells",
    success: "Cleared cells",
    failed: "Failed to clear cells",
  },
  spreadsheet_table: {
    running: "Managing table",
    success: "Table operation completed",
    failed: "Failed table operation",
  },
  spreadsheet_chart: {
    running: "Managing chart",
    success: "Chart operation completed",
    failed: "Failed chart operation",
  },
  spreadsheet_dataValidation: {
    running: "Managing data validation",
    success: "Data validation operation completed",
    failed: "Failed data validation operation",
  },
  spreadsheet_conditionalFormat: {
    running: "Managing conditional format",
    success: "Conditional format operation completed",
    failed: "Failed conditional format operation",
  },
  spreadsheet_getAuditSnapshot: {
    running: "Auditing spreadsheet",
    success: "Completed spreadsheet audit",
    failed: "Failed to audit spreadsheet",
  },
  assistant_requestModeSwitch: {
    running: "Requesting mode switch approval",
    success: "Approval requested",
    failed: "Failed to request approval",
  },
  web_search: {
    running: "Searching the web",
    success: "Completed web search",
    failed: "Failed web search",
  },
  assistant_askUserQuestion: {
    running: "Waiting for your answers",
    success: "Captured your answers",
    failed: "Failed to capture your answers",
  },
  assistant_confirmPlanExecution: {
    running: "Waiting for plan approval",
    success: "Captured plan approval",
    failed: "Failed to capture plan approval",
  },
};

const formatToolNameFallback = (toolName: string) =>
  toolName
    .replace(/^spreadsheet_/, "")
    .replace(/_/g, " ")
    .trim();

// Dynamic copy generators for consolidated tools based on action
const CONSOLIDATED_TOOL_COPY: Record<
  string,
  Record<string, { running: string; success: string; failed: string }>
> = {
  spreadsheet_sheet: {
    create: {
      running: "Creating sheet",
      success: "Created sheet",
      failed: "Failed to create sheet",
    },
    update: {
      running: "Updating sheet",
      success: "Updated sheet",
      failed: "Failed to update sheet",
    },
    delete: {
      running: "Deleting sheet",
      success: "Deleted sheet",
      failed: "Failed to delete sheet",
    },
    duplicate: {
      running: "Duplicating sheet",
      success: "Duplicated sheet",
      failed: "Failed to duplicate sheet",
    },
  },
  spreadsheet_note: {
    set: {
      running: "Setting note",
      success: "Set note",
      failed: "Failed to set note",
    },
    delete: {
      running: "Deleting note",
      success: "Deleted note",
      failed: "Failed to delete note",
    },
  },
  spreadsheet_table: {
    create: {
      running: "Creating table",
      success: "Created table",
      failed: "Failed to create table",
    },
    update: {
      running: "Updating table",
      success: "Updated table",
      failed: "Failed to update table",
    },
    delete: {
      running: "Deleting table",
      success: "Deleted table",
      failed: "Failed to delete table",
    },
  },
  spreadsheet_chart: {
    create: {
      running: "Creating chart",
      success: "Created chart",
      failed: "Failed to create chart",
    },
    update: {
      running: "Updating chart",
      success: "Updated chart",
      failed: "Failed to update chart",
    },
    delete: {
      running: "Deleting chart",
      success: "Deleted chart",
      failed: "Failed to delete chart",
    },
  },
  spreadsheet_dataValidation: {
    create: {
      running: "Creating data validation",
      success: "Created data validation",
      failed: "Failed to create data validation",
    },
    update: {
      running: "Updating data validation",
      success: "Updated data validation",
      failed: "Failed to update data validation",
    },
    delete: {
      running: "Deleting data validation",
      success: "Deleted data validation",
      failed: "Failed to delete data validation",
    },
    query: {
      running: "Querying data validations",
      success: "Queried data validations",
      failed: "Failed to query data validations",
    },
  },
  spreadsheet_conditionalFormat: {
    create: {
      running: "Creating conditional format",
      success: "Created conditional format",
      failed: "Failed to create conditional format",
    },
    update: {
      running: "Updating conditional format",
      success: "Updated conditional format",
      failed: "Failed to update conditional format",
    },
    delete: {
      running: "Deleting conditional format",
      success: "Deleted conditional format",
      failed: "Failed to delete conditional format",
    },
    query: {
      running: "Querying conditional formats",
      success: "Queried conditional formats",
      failed: "Failed to query conditional formats",
    },
  },
  spreadsheet_clearCells: {
    values: {
      running: "Clearing cell values",
      success: "Cleared cell values",
      failed: "Failed to clear cell values",
    },
    formatting: {
      running: "Clearing cell formatting",
      success: "Cleared cell formatting",
      failed: "Failed to clear cell formatting",
    },
    all: {
      running: "Clearing cells",
      success: "Cleared cells",
      failed: "Failed to clear cells",
    },
  },
  spreadsheet_modifyRowsCols: {
    insert_row: {
      running: "Inserting rows",
      success: "Inserted rows",
      failed: "Failed to insert rows",
    },
    insert_column: {
      running: "Inserting columns",
      success: "Inserted columns",
      failed: "Failed to insert columns",
    },
    delete_row: {
      running: "Deleting rows",
      success: "Deleted rows",
      failed: "Failed to delete rows",
    },
    delete_column: {
      running: "Deleting columns",
      success: "Deleted columns",
      failed: "Failed to delete columns",
    },
  },
};

export const getToolCopy = (
  toolName: string,
  parsedArgs?: Record<string, unknown>,
): ToolCopy => {
  // Check for consolidated tools with dynamic copy based on action
  const consolidatedCopy = CONSOLIDATED_TOOL_COPY[toolName];
  if (consolidatedCopy && parsedArgs) {
    // Args might be nested under 'input' property
    const args =
      typeof parsedArgs.input === "object" && parsedArgs.input !== null
        ? (parsedArgs.input as Record<string, unknown>)
        : parsedArgs;

    // For spreadsheet_clearCells, use the 'clear' field
    if (toolName === "spreadsheet_clearCells") {
      const clear = args.clear as string | undefined;
      if (clear && consolidatedCopy[clear]) {
        return consolidatedCopy[clear];
      }
    }
    // For spreadsheet_modifyRowsCols, combine action + dimension
    else if (toolName === "spreadsheet_modifyRowsCols") {
      const action = args.action as string | undefined;
      const dimension = args.dimension as string | undefined;
      if (action && dimension) {
        const key = `${action}_${dimension}`;
        if (consolidatedCopy[key]) {
          return consolidatedCopy[key];
        }
      }
    }
    // For other consolidated tools, use 'action' field
    else {
      const action = args.action as string | undefined;
      if (action && consolidatedCopy[action]) {
        return consolidatedCopy[action];
      }
    }
  }

  const mapped = TOOL_UI_COPY[toolName];
  if (mapped) {
    return mapped;
  }

  const fallbackName = formatToolNameFallback(toolName) || toolName;
  return {
    running: `Running ${fallbackName}`,
    success: `Completed ${fallbackName}`,
    failed: `Failed ${fallbackName}`,
  };
};
