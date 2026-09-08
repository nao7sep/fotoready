import type { UiState, WindowBounds, WindowPlacementRecord } from "../types/state";
import { PANE_DEFAULTS, PANE_MAXES, PANE_MINS, type WorkspacePaneKey } from "../layout/workspace-metrics";
import { DEFAULT_MAIN_WINDOW_MODE } from "../window-placement";
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
    windowPlacements: { main: null }
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
    windowPlacements: readWindowPlacements(input.windowPlacements, fallback.windowPlacements, issues)
  };
  return { state, issues };
}

function readWindowPlacements(
  value: unknown,
  fallback: UiState["windowPlacements"],
  issues: string[]
): UiState["windowPlacements"] {
  if (value === undefined) return { main: cloneWindowPlacement(fallback.main) };
  if (!isRecord(value)) {
    issues.push("state.windowPlacements must be an object.");
    return { main: cloneWindowPlacement(fallback.main) };
  }

  return { main: readWindowPlacement(value.main, fallback.main, issues) };
}

function readWindowPlacement(
  value: unknown,
  fallback: WindowPlacementRecord | null,
  issues: string[]
): WindowPlacementRecord | null {
  if (value === undefined) return cloneWindowPlacement(fallback);
  if (value === null) return null;
  if (!isRecord(value)) {
    issues.push("state.windowPlacements.main must be an object.");
    return cloneWindowPlacement(fallback);
  }

  let normalBounds = fallback?.normalBounds ? { ...fallback.normalBounds } : null;
  if (value.normalBounds === null) {
    normalBounds = null;
  } else {
    try {
      normalBounds = readWindowBounds(assertRecord(value.normalBounds, "state.windowPlacements.main.normalBounds"));
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  let mode = fallback?.mode ?? DEFAULT_MAIN_WINDOW_MODE;
  if (value.mode === "normal" || value.mode === "maximized") {
    mode = value.mode;
  } else {
    issues.push("state.windowPlacements.main.mode must be normal or maximized");
  }
  return { normalBounds, mode };
}

function readWindowBounds(value: Record<string, unknown>): WindowBounds {
  return {
    x: assertFiniteNumber(value.x, "state.windowPlacements.main.normalBounds.x"),
    y: assertFiniteNumber(value.y, "state.windowPlacements.main.normalBounds.y"),
    width: assertFiniteNumber(value.width, "state.windowPlacements.main.normalBounds.width"),
    height: assertFiniteNumber(value.height, "state.windowPlacements.main.normalBounds.height")
  };
}

function cloneWindowPlacement(value: WindowPlacementRecord | null): WindowPlacementRecord | null {
  return value === null
    ? null
    : { normalBounds: value.normalBounds ? { ...value.normalBounds } : null, mode: value.mode };
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
