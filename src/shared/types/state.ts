import type { WorkspacePaneKey } from "../layout/workspace-metrics";

export type WindowPlacementMode = "normal" | "maximized";

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowPlacementRecord = {
  normalBounds: WindowBounds | null;
  mode: WindowPlacementMode;
};

/**
 * Ephemeral UI state — saved by the app on the user's behalf, not by intentional
 * configuration. Edited via `state.update` IPC; persisted to `~/.fotoready/state.json`.
 * Anything the user would expect to "stick across sessions but not feel like a setting"
 * belongs here (panel visibility, overlay positions, window geometry, etc.).
 */
export type UiState = {
  showHistogram: boolean;
  histogramPosition: { x: number; y: number } | null;
  /**
   * The user's dragged side-pane widths (the intent, in px). Persisted here rather than in renderer
   * localStorage so the main process can read them to size the window before the renderer loads, and
   * so all of the app's state lives in one place. The display is clamped to the container at render
   * time (clampWidthsToContainer); this stored intent is not — a wide layout survives a narrow reopen
   * and reappears when the window grows.
   */
  workspaceWidths: Record<WorkspacePaneKey, number>;
  /** Disposable placement state keyed by the durable top-level window's stable role. */
  windowPlacements: {
    main: WindowPlacementRecord | null;
  };
};
