import { describe, expect, it } from "vitest";
import { defaultUiState, normalizeUiState } from "@shared/validation/state";

describe("normalizeUiState", () => {
  it("round-trips a valid state with no issues", () => {
    const input = { showHistogram: true, histogramPosition: { x: 10, y: 20 } };
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
    const { state, issues } = normalizeUiState(
      { showHistogram: "yes", histogramPosition: null },
      defaultUiState()
    );
    expect(state.showHistogram).toBe(false);
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });

  it("treats a missing histogramPosition as the fallback (null)", () => {
    const { state, issues } = normalizeUiState({ showHistogram: true }, defaultUiState());
    expect(state.histogramPosition).toBeNull();
    expect(issues).toEqual([]);
  });

  it("rejects a malformed point and falls back", () => {
    const fallback = { showHistogram: false, histogramPosition: { x: 1, y: 2 } };
    const { state, issues } = normalizeUiState(
      { showHistogram: false, histogramPosition: { x: "bad", y: 2 } },
      fallback
    );
    expect(state.histogramPosition).toEqual({ x: 1, y: 2 });
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });
});
