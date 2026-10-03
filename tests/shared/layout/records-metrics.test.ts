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

  it("keeps the list pane between 320 and 640 px, opening at 380", () => {
    expect(RECORDS_LIST_WIDTH).toEqual({ min: 320, default: 380, max: 640 });
    expect(clampRecordsListWidth(1000)).toBe(640);
    expect(clampRecordsListWidth(100)).toBe(320);
    expect(clampRecordsListWidth(450.4)).toBe(450);
    expect(clampRecordsListWidth(Number.NaN)).toBe(380);
  });

  it("narrows the shown list so the detail pane keeps its minimum, and never below the list's own", () => {
    expect(recordsListDisplayWidth(600, null)).toBe(600);
    expect(recordsListDisplayWidth(600, 2000)).toBe(600);
    expect(recordsListDisplayWidth(600, 900)).toBe(900 - SPLITTER_WIDTH - RECORDS_DETAIL_MIN_WIDTH);
    expect(recordsListDisplayWidth(600, 500)).toBe(RECORDS_LIST_WIDTH.min);
  });
});
