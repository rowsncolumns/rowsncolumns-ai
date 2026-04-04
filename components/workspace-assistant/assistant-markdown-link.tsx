"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import {
  useCallbackRef,
  useSpreadsheetInstances,
} from "@rowsncolumns/spreadsheet";
import { addressToSelection } from "@rowsncolumns/utils";

const SHEETS_PATH_REGEX = /^\/sheets\/([^/?#]+)\/?$/;

type MarkdownAnchorProps = React.ComponentPropsWithoutRef<"a"> & {
  node?: unknown;
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

export function AssistantMarkdownLink({
  href,
  onClick,
  onOpenInCurrentDocument,
  node,
  ...props
}: AssistantMarkdownLinkProps) {
  void node;
  const params = useParams<{ documentId?: string | string[] }>();
  const currentDocId = React.useMemo(
    () => readDocumentIdParam(params?.documentId),
    [params],
  );
  const instance = useSpreadsheetInstances();
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
    [currentDocId, getInstance, href, onClick, onOpenInCurrentDocument],
  );

  return <a {...props} href={href} onClick={handleClick} />;
}
