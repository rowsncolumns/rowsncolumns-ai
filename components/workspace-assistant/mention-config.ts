export type MentionCategory =
  | "sheet"
  | "document"
  | "template"
  | "skill"
  | "tool";
export type MentionKind = "sheet" | "tool" | "skill";

type MentionVisualConfig = {
  label: string;
};

export type ParsedMentionUri =
  | { kind: "tool"; name: string; raw: string }
  | { kind: "skill"; id: string; raw: string }
  | { kind: "sheet"; docId: string; sheetId: number | null; raw: string }
  | { kind: "document"; docId: string; raw: string };

export const MENTION_URI_PREFIX = "mention://";
export const MENTION_URI_REGEX =
  /^mention:\/\/(?:tool|skill|sheet|document)\?[^#\s]+$/i;
export const SHEETS_APP_BASE_URL = "https://rowsncolumns.ai";

// Legacy compatibility
const LEGACY_TOOLS_URI_PREFIX_A = "tools://";
const LEGACY_TOOLS_URI_PREFIX_B = "tool://";
export const TOOLS_URI_REGEX =
  /^(?:mention:\/\/tool\?[^#\s]+|\/tools\/|tools:\/\/|tool:\/\/)[a-z0-9._=%&?-]*$/i;
export const SHEETS_URI_REGEX =
  /^(?:mention:\/\/(?:sheet|document)\?[^#\s]+|\/sheets\/[^/\s?#]+\/?(?:[?#].*)?)$/i;

const SHEET_VISUAL: MentionVisualConfig = {
  label: "Sheets",
};

const TOOL_VISUAL: MentionVisualConfig = {
  label: "Tools",
};

const SKILL_VISUAL: MentionVisualConfig = {
  label: "Skills",
};

export const SHEET_MENTION_PILL_GLYPH = "▦";
export const TOOL_WRENCH_ICON_PATH_D =
  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z";

export const MENTION_CATEGORY_ORDER: MentionCategory[] = [
  "sheet",
  "document",
  "template",
  "skill",
  "tool",
];

const MENTION_VISUAL_CONFIG: Record<MentionCategory, MentionVisualConfig> = {
  sheet: SHEET_VISUAL,
  document: {
    ...SHEET_VISUAL,
    label: "Documents",
  },
  template: {
    ...SHEET_VISUAL,
    label: "Templates",
  },
  skill: SKILL_VISUAL,
  tool: TOOL_VISUAL,
};

const parseLegacyToolName = (value: string): string | null => {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (lower.startsWith("/tools/")) {
    return decodeURIComponent(normalized.slice("/tools/".length)).trim() || null;
  }
  if (lower.startsWith(LEGACY_TOOLS_URI_PREFIX_A)) {
    return (
      decodeURIComponent(normalized.slice(LEGACY_TOOLS_URI_PREFIX_A.length)).trim() ||
      null
    );
  }
  if (lower.startsWith(LEGACY_TOOLS_URI_PREFIX_B)) {
    return (
      decodeURIComponent(normalized.slice(LEGACY_TOOLS_URI_PREFIX_B.length)).trim() ||
      null
    );
  }
  return null;
};

const parseMentionUrlLike = (value: string): ParsedMentionUri | null => {
  try {
    const fallbackOrigin =
      typeof window !== "undefined"
        ? window.location.origin
        : SHEETS_APP_BASE_URL;
    const url = new URL(value, fallbackOrigin);

    const pathname = url.pathname.trim();
    const pathMatch = pathname.match(/^\/sheets\/([^/?#]+)\/?$/);
    if (!pathMatch?.[1]) {
      return null;
    }

    const docId = decodeURIComponent(pathMatch[1]).trim();
    if (!docId) {
      return null;
    }

    const sheetIdRaw = url.searchParams.get("sheetId")?.trim() || "";
    const sheetId = Number.parseInt(sheetIdRaw, 10);

    if (Number.isInteger(sheetId)) {
      return { kind: "sheet", docId, sheetId, raw: value };
    }

    return { kind: "document", docId, raw: value };
  } catch {
    return null;
  }
};

export const parseMentionUri = (
  value: string | undefined | null,
): ParsedMentionUri | null => {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const parsedUrlLike = parseMentionUrlLike(normalized);
  if (parsedUrlLike) {
    return parsedUrlLike;
  }

  const legacyToolName = parseLegacyToolName(normalized);
  if (legacyToolName) {
    return { kind: "tool", name: legacyToolName, raw: normalized };
  }

  if (!MENTION_URI_REGEX.test(normalized)) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();

    if (host === "tool") {
      const name = url.searchParams.get("name")?.trim() || "";
      if (!name) return null;
      return { kind: "tool", name, raw: normalized };
    }

    if (host === "skill") {
      const id = url.searchParams.get("id")?.trim() || "";
      if (!id) return null;
      return { kind: "skill", id, raw: normalized };
    }

    if (host === "sheet") {
      const docId = url.searchParams.get("docId")?.trim() || "";
      if (!docId) return null;
      const sheetIdRaw = url.searchParams.get("sheetId")?.trim() || "";
      const sheetId = Number.parseInt(sheetIdRaw, 10);
      return {
        kind: "sheet",
        docId,
        sheetId: Number.isInteger(sheetId) ? sheetId : null,
        raw: normalized,
      };
    }

    if (host === "document") {
      const docId = url.searchParams.get("docId")?.trim() || "";
      if (!docId) return null;
      return { kind: "document", docId, raw: normalized };
    }

    return null;
  } catch {
    return null;
  }
};

export const buildToolMentionUri = (toolName: string): string =>
  `${MENTION_URI_PREFIX}tool?name=${encodeURIComponent(toolName.trim())}`;

export const buildSkillMentionUri = (skillId: string): string =>
  `${MENTION_URI_PREFIX}skill?id=${encodeURIComponent(skillId.trim())}`;

export const buildSheetMentionUri = (input: {
  docId: string;
  sheetId: number;
}): string =>
  `${SHEETS_APP_BASE_URL}/sheets/${encodeURIComponent(
    input.docId.trim(),
  )}?sheetId=${encodeURIComponent(String(input.sheetId))}`;

export const buildDocumentMentionUri = (docId: string): string =>
  `${SHEETS_APP_BASE_URL}/sheets/${encodeURIComponent(docId.trim())}`;

export const parseToolNameFromMentionUri = (
  value: string | undefined | null,
): string | null => {
  const parsed = parseMentionUri(value);
  return parsed?.kind === "tool" ? parsed.name : null;
};

export const parseSkillIdFromMentionUri = (
  value: string | undefined | null,
): string | null => {
  const parsed = parseMentionUri(value);
  return parsed?.kind === "skill" ? parsed.id : null;
};

export const getMentionCategoryLabel = (category: MentionCategory): string =>
  MENTION_VISUAL_CONFIG[category].label;

export const getMentionCategoryIconKind = (
  category: MentionCategory,
): MentionKind => {
  if (category === "tool") return "tool";
  if (category === "skill") return "skill";
  return "sheet";
};

export const getMentionKindFromMentionId = (mentionId: string): MentionKind => {
  const parsed = parseMentionUri(mentionId);
  if (parsed?.kind === "tool") return "tool";
  if (parsed?.kind === "skill") return "skill";
  return "sheet";
};

export const getMentionKindFromPathOrUri = (
  value: string,
): MentionKind | null => {
  const parsed = parseMentionUri(value);
  if (!parsed) {
    return null;
  }
  if (parsed.kind === "tool") return "tool";
  if (parsed.kind === "skill") return "skill";
  return "sheet";
};
