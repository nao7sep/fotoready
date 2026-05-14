import type { UiState } from "../types/state";
import { assertBoolean, assertFiniteNumber, assertRecord, isRecord } from "./common";

export type UiStateNormalizationResult = {
  state: UiState;
  issues: string[];
};

export function defaultUiState(): UiState {
  return { showHistogram: false, histogramPosition: null };
}

export function normalizeUiState(input: unknown, fallback: UiState): UiStateNormalizationResult {
  const issues: string[] = [];
  if (!isRecord(input)) {
    return { state: { ...fallback }, issues: ["state must be a JSON object."] };
  }

  const state: UiState = {
    showHistogram: readBoolean(input, "showHistogram", fallback.showHistogram, issues),
    histogramPosition: readPoint(input.histogramPosition, fallback.histogramPosition, issues)
  };
  return { state, issues };
}

function readBoolean(source: Record<string, unknown>, key: string, fallback: boolean, issues: string[]): boolean {
  const value = source[key];
  if (value === undefined) return fallback;
  try {
    return assertBoolean(value, `state.${key}`);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

function readPoint(value: unknown, fallback: { x: number; y: number } | null, issues: string[]): { x: number; y: number } | null {
  if (value === undefined || value === null) return fallback === null ? null : { ...fallback };
  try {
    const record = assertRecord(value, "state.histogramPosition");
    return {
      x: assertFiniteNumber(record.x, "state.histogramPosition.x"),
      y: assertFiniteNumber(record.y, "state.histogramPosition.y")
    };
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return fallback === null ? null : { ...fallback };
  }
}
