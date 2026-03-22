export const PANEL_LAYOUT_COOKIE = "new-workspace-layout";
export const PANEL_GROUP_ID = "new-workspace-group";
export const SPREADSHEET_PANEL_ID = "spreadsheet-panel";
export const ASSISTANT_PANEL_ID = "assistant-panel";

export type WorkspacePanelLayout = {
  [SPREADSHEET_PANEL_ID]: number;
  [ASSISTANT_PANEL_ID]: number;
};

export const DEFAULT_PANEL_LAYOUT: WorkspacePanelLayout = {
  [SPREADSHEET_PANEL_ID]: 70,
  [ASSISTANT_PANEL_ID]: 30,
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function normalizePanelLayout(
  layout: WorkspacePanelLayout,
): WorkspacePanelLayout {
  const spreadsheet = Math.max(1, Math.min(99, layout[SPREADSHEET_PANEL_ID]));
  const assistant = Math.max(1, Math.min(99, layout[ASSISTANT_PANEL_ID]));
  const total = spreadsheet + assistant;

  return {
    [SPREADSHEET_PANEL_ID]: Number(((spreadsheet / total) * 100).toFixed(3)),
    [ASSISTANT_PANEL_ID]: Number(((assistant / total) * 100).toFixed(3)),
  };
}

export function parsePanelLayoutCookie(
  value: string | undefined,
): WorkspacePanelLayout | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Record<
      string,
      unknown
    >;
    const spreadsheet = parsed[SPREADSHEET_PANEL_ID];
    const assistant = parsed[ASSISTANT_PANEL_ID];

    if (!isFiniteNumber(spreadsheet) || !isFiniteNumber(assistant)) {
      return null;
    }

    return normalizePanelLayout({
      [SPREADSHEET_PANEL_ID]: spreadsheet,
      [ASSISTANT_PANEL_ID]: assistant,
    });
  } catch {
    return null;
  }
}

export function serializePanelLayoutCookie(
  layout: WorkspacePanelLayout,
): string {
  return encodeURIComponent(JSON.stringify(normalizePanelLayout(layout)));
}
