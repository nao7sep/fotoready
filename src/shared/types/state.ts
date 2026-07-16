import type { WorkspacePaneKey } from "../layout/workspace-metrics";

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
  /**
   * The window's last width/height in px, restored (clamped to the current screen) on the next
   * launch. null until the user has resized once — the first run opens at a derived default. Only
   * size is remembered, not position, so a monitor change can't strand the window off-screen.
   */
  windowSize: { width: number; height: number } | null;
};
