import type { SheetCoordinate } from "@rowsncolumns/common-types";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";

/**
 * Atom for storing cell highlights.
 * Used by the highlight tool to show which cells are being reviewed/modified.
 */
export const highlightsAtom = atom<SheetCoordinate[]>([]);

/**
 * Hook to get and set highlights.
 */
export const useHighlights = () => useAtom(highlightsAtom);

/**
 * Hook to only read highlights (no setter).
 */
export const useHighlightsValue = () => useAtomValue(highlightsAtom);

/**
 * Hook to only set highlights (no reader).
 */
export const useSetHighlights = () => useSetAtom(highlightsAtom);
