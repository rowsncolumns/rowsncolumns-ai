import type { Citation } from "@rowsncolumns/common-types";
import { RangeBorderStyle } from "@rowsncolumns/spreadsheet";
import { useMemo } from "react";

type UseCitationsProps = {
  citations: Citation[];
  sheetId: number;
};
export const useCitations = ({ citations, sheetId }: UseCitationsProps) => {
  const citationBorderStyles = useMemo(() => {
    const borderStyle: RangeBorderStyle[] = [];
    for (const citation of citations) {
      const { range } = citation;

      if (!range || range.sheetId !== sheetId) {
        continue;
      }

      if (citation.active === false) {
        continue;
      }

      borderStyle.push({
        id: `citation-border-${citation.id}`,
        range: range,
        draggable: false,
        type: "citation",
        style: {
          stroke: "#D97706",
          strokeWidth: 1,
          strokeStyle: "dotted",
        },
        title: citation.id,
      });
    }

    return borderStyle;
  }, [citations, sheetId]);

  // By id
  const citationsById = useMemo(() => {
    const citationsById: Record<string, Citation> = {};
    for (const citation of citations) {
      citationsById[citation.id] = citation;
    }
    return citationsById;
  }, [citations]);

  return {
    citationBorderStyles,
    citationsById,
  };
};
