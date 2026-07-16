import type { UiState } from "../types/state";
import { PANE_DEFAULTS, PANE_MAXES, PANE_MINS, type WorkspacePaneKey } from "../layout/workspace-metrics";
import { assertBoolean, assertFiniteNumber, assertRecord, isRecord } from "./common";

export type UiStateNormalizationResult = {
  state: UiState;
  issues: string[];
};

const WORKSPACE_PANE_KEYS: WorkspacePaneKey[] = ["originals", "tasks", "ops", "addOps"];

export function defaultUiState(): UiState {
  return {
    showHistogram: false,
    histogramPosition: null,
    workspaceWidths: { ...PANE_DEFAULTS },
    windowSize: null
  };
}

export function normalizeUiState(input: unknown, fallback: UiState): UiStateNormalizationResult {
  const issues: string[] = [];
  if (!isRecord(input)) {
    return { state: { ...fallback }, issues: ["state must be a JSON object."] };
  }

  const state: UiState = {
    showHistogram: readBoolean(input, "showHistogram", fallback.showHistogram, issues),
    histogramPosition: readPoint(input.histogramPosition, fallback.histogramPosition, issues),
    workspaceWidths: readWorkspaceWidths(input.workspaceWidths, fallback.workspaceWidths, issues),
    windowSize: readWindowSize(input.windowSize, fallback.windowSize, issues)
  };
  return { state, issues };
}

// Each pane width is clamped to its own [min, max] on read: a hand-edited or older value can't strand
// a pane below usability or push a sibling out. This is the persisted INTENT — the container clamp
// (clampWidthsToContainer) is a separate, display-only concern applied at render time. A non-finite
// or missing entry falls back to that pane's default.
function readWorkspaceWidths(
  value: unknown,
  fallback: Record<WorkspacePaneKey, number>,
  issues: string[]
): Record<WorkspacePaneKey, number> {
  if (value === undefined) return { ...fallback };
  if (!isRecord(value)) {
    issues.push("state.workspaceWidths must be an object.");
    return { ...fallback };
  }
  const result = {} as Record<WorkspacePaneKey, number>;
  for (const key of WORKSPACE_PANE_KEYS) {
    try {
      const n = assertFiniteNumber(value[key], `state.workspaceWidths.${key}`);
      result[key] = Math.min(PANE_MAXES[key], Math.max(PANE_MINS[key], Math.round(n)));
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      result[key] = fallback[key];
    }
  }
  return result;
}

function readWindowSize(
  value: unknown,
  fallback: { width: number; height: number } | null,
  issues: string[]
): { width: number; height: number } | null {
  if (value === undefined || value === null) return fallback === null ? null : { ...fallback };
  try {
    const record = assertRecord(value, "state.windowSize");
    return {
      width: assertFiniteNumber(record.width, "state.windowSize.width"),
      height: assertFiniteNumber(record.height, "state.windowSize.height")
    };
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return fallback === null ? null : { ...fallback };
  }
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
