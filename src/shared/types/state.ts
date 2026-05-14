/**
 * Ephemeral UI state — saved by the app on the user's behalf, not by intentional
 * configuration. Edited via `state.update` IPC; persisted to `~/.fotoready/state.json`.
 * Anything the user would expect to "stick across sessions but not feel like a setting"
 * belongs here (panel visibility, overlay positions, window geometry, etc.).
 */
export type UiState = {
  showHistogram: boolean;
  histogramPosition: { x: number; y: number } | null;
};
