import { describe, expect, it } from "vitest";
import { defaultUiState, normalizeUiState } from "@shared/validation/state";

const normalBounds = { x: 89, y: 81, width: 1201, height: 749 };
const windowsNormalBounds = { left: 111, top: 101, right: 1613, bottom: 1038 };

describe("native placement state normalization", () => {
  it("preserves and clones a native rectangle beside the compatible logical record", () => {
    const record = { normalBounds, windowsNormalBounds, mode: "maximized" as const };
    const state = { ...defaultUiState(), windowPlacements: { main: record } };
    const parsed = normalizeUiState(state, defaultUiState()).state;
    expect(parsed.windowPlacements.main).toEqual(record);
    expect(parsed.windowPlacements.main?.windowsNormalBounds).not.toBe(windowsNormalBounds);
    const fallback = normalizeUiState({}, parsed).state;
    expect(fallback.windowPlacements.main).toEqual(record);
    expect(fallback.windowPlacements.main?.windowsNormalBounds).not.toBe(parsed.windowPlacements.main?.windowsNormalBounds);
  });
  it("discards only malformed native data and keeps mode, logical bounds, and pane state", () => {
    const record = { normalBounds, windowsNormalBounds: { ...windowsNormalBounds, right: "wide" }, mode: "maximized" };
    const parsed = normalizeUiState({ showHistogram: true, windowPlacements: { main: record } }, defaultUiState()).state;
    expect(parsed.showHistogram).toBe(true);
    expect(parsed.windowPlacements.main).toEqual({ normalBounds, windowsNormalBounds: null, mode: "maximized" });
  });
  it("keeps an absent legacy field omitted", () => {
    const record = { normalBounds, mode: "normal" };
    expect(normalizeUiState({ windowPlacements: { main: record } }, defaultUiState()).state.windowPlacements.main).toEqual(record);
  });
});
