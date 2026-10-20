// The Records window's layout: a list pane the user can widen (filters above the record list), a
// splitter, and the detail pane, which takes the rest. The window's minimum is derived from the
// panes' content, and the stylesheet takes the lengths it shares with them from the variables the
// renderer sets on the document root, so the two cannot drift.

import { CONTROL_GAP, CONTROL_HEIGHT } from "./controls";
import { SPLITTER_WIDTH } from "./workspace-metrics";

/** The list pane's bounds and opening width. `min` still fits two filter selects side by side. */
export const RECORDS_LIST_WIDTH = { min: 320, default: 380, max: 640 } as const;

/** The detail pane's minimum: its header's title and level marks, and the field grid below. */
export const RECORDS_DETAIL_MIN_WIDTH = 420;

/** The padding around the filter band's controls. */
export const RECORDS_FILTERS_PADDING = 10;

/**
 * The filter band: its padding above and below a search field and two rows of selects (three
 * controls, a control gap apart), and the line below it.
 */
export const RECORDS_FILTERS_HEIGHT = RECORDS_FILTERS_PADDING * 2 + CONTROL_HEIGHT * 3 + CONTROL_GAP * 2 + 1;

/** The record list's smallest useful height: a few rows. */
export const RECORDS_LIST_MIN_HEIGHT = 160;

/** The size the window opens at the first time, before it has a placement of its own. */
export const RECORDS_WINDOW_FIRST_RUN = { width: 1240, height: 820 } as const;

// Derived — do not hand-edit.
export const RECORDS_WINDOW_MIN_WIDTH = RECORDS_LIST_WIDTH.min + SPLITTER_WIDTH + RECORDS_DETAIL_MIN_WIDTH;

// Derived — do not hand-edit.
export const RECORDS_WINDOW_MIN_HEIGHT = RECORDS_FILTERS_HEIGHT + RECORDS_LIST_MIN_HEIGHT;

/** The stored list width (the user's drag intent), held to the pane's own bounds. */
export function clampRecordsListWidth(value: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : RECORDS_LIST_WIDTH.default;
  return Math.min(RECORDS_LIST_WIDTH.max, Math.max(RECORDS_LIST_WIDTH.min, rounded));
}

/**
 * The list pane's displayed width: the intent, narrowed so the detail pane keeps its minimum in a
 * window of `available` pixels, and never below the list's own minimum. Derived on every resize and
 * never saved.
 */
export function recordsListDisplayWidth(intent: number, available: number | null): number {
  const width = clampRecordsListWidth(intent);
  if (available === null) return width;
  const room = available - SPLITTER_WIDTH - RECORDS_DETAIL_MIN_WIDTH;
  return Math.max(RECORDS_LIST_WIDTH.min, Math.min(width, room));
}
