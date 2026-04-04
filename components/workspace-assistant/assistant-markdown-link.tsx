"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import {
  useCallbackRef,
  useSpreadsheetInstances,
} from "@rowsncolumns/spreadsheet";
import { addressToSelection } from "@rowsncolumns/utils";
import {
  parseMentionUri,
  SHEETS_URI_REGEX,
  TOOLS_URI_REGEX,
  parseToolNameFromMentionUri,
  type MentionKind,
} from "@/components/workspace-assistant/mention-config";
import {
  getChatToolDescription,
  getChatToolDisplayName,
} from "@/lib/chat/tool-metadata";
import { Table2, Wrench } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const SHEETS_PATH_REGEX = /^\/sheets\/([^/?#]+)\/?$/;

type MarkdownAnchorProps = React.ComponentPropsWithoutRef<"a"> & {
  node?: unknown;
  "data-mention-kind"?: string;
  "data-mention-url"?: string;
};

export type SpreadsheetLinkTarget = {
  docId: string;
  range: string;
  sheetId: number;
  href: string;
};

type AssistantMarkdownLinkProps = MarkdownAnchorProps & {
  onOpenInCurrentDocument?: (target: SpreadsheetLinkTarget) => void;
};

const readMentionKindFromDataAttribute = (
  value: string | undefined,
): MentionKind | null => {
  if (value === "tool" || value === "sheet") {
    return value;
  }
  return null;
};

const readDocumentIdParam = (
  value: string | string[] | undefined,
): string | null => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && value[0]?.trim()) {
    return value[0].trim();
  }
  return null;
};

const parseSpreadsheetLink = (href: string): SpreadsheetLinkTarget | null => {
  if (typeof window === "undefined") {
    return null;
  }

  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return null;
  }

  if (url.origin !== window.location.origin) {
    return null;
  }

  const pathMatch = url.pathname.match(SHEETS_PATH_REGEX);
  if (!pathMatch?.[1]) {
    return null;
  }

  const docId = decodeURIComponent(pathMatch[1]).trim();
  const range = url.searchParams.get("range")?.trim() || "";
  const sheetIdValue = url.searchParams.get("sheetId")?.trim() || "";
  const sheetId = Number.parseInt(sheetIdValue, 10);

  if (!docId || !range || !Number.isInteger(sheetId)) {
    return null;
  }

  return {
    docId,
    range,
    sheetId,
    href: url.toString(),
  };
};

const parseSpreadsheetTargetFromMentionUri = (
  mentionUri: string | undefined,
): SpreadsheetLinkTarget | null => {
  const parsed = parseMentionUri(mentionUri);
  if (!parsed || parsed.kind !== "sheet") {
    return null;
  }
  const parsedSheetId = parsed.sheetId;
  if (!parsed.docId || !Number.isInteger(parsedSheetId)) {
    return null;
  }

  const sheetId = Number(parsedSheetId);
  const href = `/sheets/${encodeURIComponent(parsed.docId)}?sheetId=${sheetId}`;
  return {
    docId: parsed.docId,
    range: "",
    sheetId,
    href,
  };
};

const parseDocumentHrefFromMentionUri = (mentionUri: string | undefined) => {
  const parsed = parseMentionUri(mentionUri);
  if (!parsed || parsed.kind !== "document") {
    return null;
  }
  return `/sheets/${encodeURIComponent(parsed.docId)}`;
};

const getMentionKindFromHref = (
  href: string | undefined,
): MentionKind | null => {
  const normalizedHref = href?.trim();
  if (!normalizedHref) {
    return null;
  }

  const parsed = parseMentionUri(normalizedHref);
  if (parsed) {
    return parsed.kind === "tool" ? "tool" : "sheet";
  }

  if (parseToolNameFromMentionUri(normalizedHref)) {
    return "tool";
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const url = new URL(normalizedHref, window.location.origin);
    if (url.origin !== window.location.origin) {
      return null;
    }
    if (TOOLS_URI_REGEX.test(url.pathname)) {
      return "tool";
    }
    return SHEETS_URI_REGEX.test(url.pathname) ? "sheet" : null;
  } catch {
    return null;
  }
};

const MentionLinkIcon = ({
  mentionKind,
}: {
  mentionKind: MentionKind | null;
}) => {
  switch (mentionKind) {
    case "tool":
      return (
        <Wrench aria-hidden="true" className="mr-1 inline-block h-3 w-3" />
      );
    case "sheet":
      return (
        <Table2 aria-hidden="true" className="mr-1 inline-block h-3 w-3" />
      );
    default:
      return null;
  }
};

export function AssistantMarkdownLink({
  href,
  onClick,
  onOpenInCurrentDocument,
  node,
  "data-mention-kind": dataMentionKind,
  "data-mention-url": dataMentionUrl,
  className,
  children,
  ...props
}: AssistantMarkdownLinkProps) {
  const params = useParams<{ documentId?: string | string[] }>();
  const currentDocId = React.useMemo(
    () => readDocumentIdParam(params?.documentId),
    [params],
  );
  const instance = useSpreadsheetInstances();
  const mentionKind = React.useMemo(
    () =>
      readMentionKindFromDataAttribute(
        typeof dataMentionKind === "string" ? dataMentionKind : undefined,
      ) ??
      getMentionKindFromHref(href) ??
      (typeof dataMentionUrl === "string"
        ? getMentionKindFromHref(dataMentionUrl)
        : null),
    [dataMentionKind, dataMentionUrl, href],
  );
  const effectiveMentionUrl = React.useMemo(() => {
    const candidate = href?.trim() || "";
    if (candidate.length > 0) {
      return candidate;
    }
    if (typeof dataMentionUrl === "string" && dataMentionUrl.trim()) {
      return dataMentionUrl.trim();
    }
    return undefined;
  }, [dataMentionUrl, href]);
  const toolName = React.useMemo(
    () => parseToolNameFromMentionUri(effectiveMentionUrl),
    [effectiveMentionUrl],
  );
  const getInstance = useCallbackRef((docId: string) => {
    return instance.get(docId);
  });

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) {
        return;
      }

      // Preserve native behavior for new-tab/window and non-primary clicks.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      if (mentionKind === "tool") {
        event.preventDefault();
        return;
      }

      const target =
        (effectiveMentionUrl
          ? parseSpreadsheetLink(effectiveMentionUrl)
          : null) ??
        parseSpreadsheetTargetFromMentionUri(effectiveMentionUrl);
      if (!target) {
        const docHref = parseDocumentHrefFromMentionUri(effectiveMentionUrl);
        if (docHref) {
          event.preventDefault();
          window.open(docHref, "_blank", "noopener,noreferrer");
        }
        return;
      }

      if (target.docId === currentDocId) {
        event.preventDefault();
        if (onOpenInCurrentDocument) {
          onOpenInCurrentDocument(target);
          return;
        }

        const instance = getInstance(currentDocId);
        if (instance) {
          const sheetRange = addressToSelection(target.range);
          if (sheetRange) {
            // Navigate to sheet range inside the current document.
            instance.navigateToSheetRange?.(
              {
                ...sheetRange.range,
                sheetId: target.sheetId,
              },
              { enableFlash: true },
            );
            return;
          }
        }

        // Fallback: keep navigation in the same tab for current-document links.
        window.location.assign(target.href);
        return;
      }

      event.preventDefault();
      window.open(target.href, "_blank", "noopener,noreferrer");
    },
    [
      currentDocId,
      effectiveMentionUrl,
      getInstance,
      mentionKind,
      onClick,
      onOpenInCurrentDocument,
    ],
  );
  if (mentionKind === "tool" && toolName) {
    const toolTitle = getChatToolDisplayName(toolName);
    const toolDescription = getChatToolDescription(toolName);

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex cursor-pointer items-center text-left",
              className,
            )}
            aria-label={`${toolTitle} tool details`}
          >
            <MentionLinkIcon mentionKind={mentionKind} />
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-80 p-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{toolTitle}</p>
            <p className="text-xs leading-relaxed text-(--muted-foreground)">
              {toolDescription}
            </p>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <a
      {...props}
      className={className}
      href={href}
      onClick={handleClick}
      data-mention-kind={dataMentionKind}
      data-mention-url={dataMentionUrl}
    >
      <MentionLinkIcon mentionKind={mentionKind} />
      {children}
    </a>
  );
}
