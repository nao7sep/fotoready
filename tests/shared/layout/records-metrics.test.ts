import { describe, expect, it } from "vitest";
import {
  RECORDS_DETAIL_MIN_WIDTH,
  RECORDS_FILTERS_HEIGHT,
  RECORDS_LIST_MIN_HEIGHT,
  RECORDS_LIST_WIDTH,
  RECORDS_WINDOW_FIRST_RUN,
  RECORDS_WINDOW_MIN_HEIGHT,
  RECORDS_WINDOW_MIN_WIDTH,
  clampRecordsListWidth,
  recordsListDisplayWidth
} from "@shared/layout/records-metrics";
import { SPLITTER_WIDTH } from "@shared/layout/workspace-metrics";

describe("Records window layout", () => {
  it("derives the window minimum from its panes", () => {
    expect(RECORDS_WINDOW_MIN_WIDTH).toBe(RECORDS_LIST_WIDTH.min + SPLITTER_WIDTH + RECORDS_DETAIL_MIN_WIDTH);
    expect(RECORDS_WINDOW_MIN_HEIGHT).toBe(RECORDS_FILTERS_HEIGHT + RECORDS_LIST_MIN_HEIGHT);
    expect(RECORDS_WINDOW_FIRST_RUN.width).toBeGreaterThanOrEqual(RECORDS_WINDOW_MIN_WIDTH);
    expect(RECORDS_WINDOW_FIRST_RUN.height).toBeGreaterThanOrEqual(RECORDS_WINDOW_MIN_HEIGHT);
  });

  it("keeps the list pane within its bounds, opening at its default", () => {
    const { min, max } = RECORDS_LIST_WIDTH;
    expect(clampRecordsListWidth(max + 1)).toBe(max);
    expect(clampRecordsListWidth(min - 1)).toBe(min);
    expect(clampRecordsListWidth(min + 0.4)).toBe(min);
    expect(clampRecordsListWidth(Number.NaN)).toBe(RECORDS_LIST_WIDTH.default);
  });

  it("narrows the shown list so the detail pane keeps its minimum, and never below the list's own", () => {
    expect(recordsListDisplayWidth(600, null)).toBe(600);
    expect(recordsListDisplayWidth(600, 2000)).toBe(600);
    expect(recordsListDisplayWidth(600, 900)).toBe(900 - SPLITTER_WIDTH - RECORDS_DETAIL_MIN_WIDTH);
    expect(recordsListDisplayWidth(600, 500)).toBe(RECORDS_LIST_WIDTH.min);
  });
});
