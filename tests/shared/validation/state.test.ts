import { describe, expect, it } from "vitest";
import { defaultUiState, normalizeUiState } from "@shared/validation/state";
import { PANE_DEFAULTS } from "@shared/layout/workspace-metrics";

describe("normalizeUiState", () => {
  it("round-trips a valid state with no issues", () => {
    const input = {
      showHistogram: true,
      histogramPosition: { x: 10, y: 20 },
      workspaceWidths: { originals: 180, tasks: 220, ops: 280, addOps: 240 },
      windowSize: { width: 1400, height: 900 }
    };
    const { state, issues } = normalizeUiState(input, defaultUiState());
    expect(issues).toEqual([]);
    expect(state).toEqual(input);
  });

  it("returns the fallback for a non-object input", () => {
    const { state, issues } = normalizeUiState(42, defaultUiState());
    expect(issues).toContain("state must be a JSON object.");
    expect(state).toEqual(defaultUiState());
  });

  it("falls back per-field on a bad showHistogram and records an issue", () => {
    const { state, issues } = normalizeUiState({ showHistogram: "yes" }, defaultUiState());
    expect(state.showHistogram).toBe(false);
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });

  it("treats a missing histogramPosition as the fallback (null)", () => {
    const { state, issues } = normalizeUiState({ showHistogram: true }, defaultUiState());
    expect(state.histogramPosition).toBeNull();
    expect(issues).toEqual([]);
  });

  it("rejects a malformed point and falls back", () => {
    const fallback = { ...defaultUiState(), histogramPosition: { x: 1, y: 2 } };
    const { state, issues } = normalizeUiState({ histogramPosition: { x: "bad", y: 2 } }, fallback);
    expect(state.histogramPosition).toEqual({ x: 1, y: 2 });
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });

  describe("workspaceWidths (the pane-width intent, moved here from localStorage)", () => {
    it("defaults to PANE_DEFAULTS when absent", () => {
      const { state, issues } = normalizeUiState({ showHistogram: false }, defaultUiState());
      expect(state.workspaceWidths).toEqual(PANE_DEFAULTS);
      expect(issues).toEqual([]);
    });

    it("clamps each pane width to its own [min, max]", () => {
      const { state } = normalizeUiState(
        { workspaceWidths: { originals: 9999, tasks: 0, ops: 300, addOps: 200 } },
        defaultUiState()
      );
      // originals over its max (360) clamps down; tasks under its min (170) clamps up; the rest pass.
      expect(state.workspaceWidths).toEqual({ originals: 360, tasks: 170, ops: 300, addOps: 200 });
    });

    it("falls back per-pane on a non-numeric width and records an issue", () => {
      const { state, issues } = normalizeUiState(
        { workspaceWidths: { originals: "wide", tasks: 220, ops: 280, addOps: 240 } },
        defaultUiState()
      );
      expect(state.workspaceWidths.originals).toBe(PANE_DEFAULTS.originals);
      expect(state.workspaceWidths.tasks).toBe(220);
      expect(issues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("windowSize (remembered so the window reopens at its last size)", () => {
    it("defaults to null so the first run opens at a derived size", () => {
      expect(defaultUiState().windowSize).toBeNull();
    });

    it("keeps a valid { width, height }", () => {
      const { state, issues } = normalizeUiState({ windowSize: { width: 1500, height: 950 } }, defaultUiState());
      expect(state.windowSize).toEqual({ width: 1500, height: 950 });
      expect(issues).toEqual([]);
    });

    it("rejects a malformed windowSize and falls back", () => {
      const { state, issues } = normalizeUiState({ windowSize: { width: "big", height: 950 } }, defaultUiState());
      expect(state.windowSize).toBeNull();
      expect(issues.length).toBeGreaterThanOrEqual(1);
    });
  });
});
