export type MentionCategory = "sheet" | "document" | "tool";
export type MentionKind = "sheet" | "tool";

type MentionVisualConfig = {
  label: string;
};

export const TOOLS_URI_PREFIX = "tools://";
export const TOOLS_URI_REGEX = /^tools:\/\/[a-z0-9._-]+$/i;
export const SHEETS_URI_REGEX = /^\/sheets\/[^/\s?#]+\/?(?:[?#].*)?$/i;

const SHEET_VISUAL: MentionVisualConfig = {
  label: "Sheets",
};

const TOOL_VISUAL: MentionVisualConfig = {
  label: "Tools",
};

export const SHEET_MENTION_PILL_GLYPH = "▦";
export const TOOL_WRENCH_ICON_PATH_D =
  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z";

export const MENTION_CATEGORY_ORDER: MentionCategory[] = [
  "sheet",
  "document",
  "tool",
];

const MENTION_VISUAL_CONFIG: Record<MentionCategory, MentionVisualConfig> = {
  sheet: SHEET_VISUAL,
  document: {
    ...SHEET_VISUAL,
    label: "Documents",
  },
  tool: TOOL_VISUAL,
};

export const getMentionCategoryLabel = (category: MentionCategory): string =>
  MENTION_VISUAL_CONFIG[category].label;

export const getMentionCategoryIconKind = (
  category: MentionCategory,
): MentionKind => (category === "tool" ? "tool" : "sheet");

export const getMentionKindFromMentionId = (mentionId: string): MentionKind =>
  mentionId.trim().toLowerCase().startsWith(TOOLS_URI_PREFIX)
    ? "tool"
    : "sheet";

export const getMentionKindFromPathOrUri = (
  value: string,
): MentionKind | null => {
  const normalized = value.trim();
  if (TOOLS_URI_REGEX.test(normalized)) {
    return "tool";
  }
  if (SHEETS_URI_REGEX.test(normalized)) {
    return "sheet";
  }
  return null;
};
