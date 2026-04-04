"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import {
  useCallbackRef,
  useSpreadsheetInstances,
} from "@rowsncolumns/spreadsheet";
import { addressToSelection } from "@rowsncolumns/utils";
import {
  SHEETS_URI_REGEX,
  TOOLS_URI_REGEX,
  type MentionKind,
} from "@/components/workspace-assistant/mention-config";
import { Table2, Wrench } from "lucide-react";

const SHEETS_PATH_REGEX = /^\/sheets\/([^/?#]+)\/?$/;

type MarkdownAnchorProps = React.ComponentPropsWithoutRef<"a"> & {
  node?: unknown;
  "data-mention-kind"?: string;
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

const getMentionKindFromHref = (
  href: string | undefined,
): MentionKind | null => {
  const normalizedHref = href?.trim();
  if (!normalizedHref) {
    return null;
  }

  if (TOOLS_URI_REGEX.test(normalizedHref)) {
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
  ...props
}: AssistantMarkdownLinkProps) {
  void node;
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
      ) ?? getMentionKindFromHref(href),
    [dataMentionKind, href],
  );
  const getInstance = useCallbackRef((docId: string) => {
    return instance.get(docId);
  });

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || !href) {
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

      const target = parseSpreadsheetLink(href);
      if (!target) {
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
      getInstance,
      href,
      mentionKind,
      onClick,
      onOpenInCurrentDocument,
    ],
  );

  return (
    <a {...props} href={href} onClick={handleClick}>
      <MentionLinkIcon mentionKind={mentionKind} />
      {props.children}
    </a>
  );
}
