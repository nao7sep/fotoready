import type { CloseRequest } from "@shared/types/ipc";

export type CloseConfirmation = { title: string; message: string };

/**
 * What to ask before a close goes ahead, or null when the close loses nothing. Only a close that
 * ends the app discards the workspace and cancels running saves; a macOS window close keeps both,
 * so it needs no confirmation.
 */
export function closeConfirmation(
  request: CloseRequest,
  workspace: { hasWork: boolean; savesInFlight: boolean },
): CloseConfirmation | null {
  if (!request.endsApp || !workspace.hasWork) return null;
  return {
    title: "Close FotoReady?",
    message: workspace.savesInFlight
      ? "Close and discard the current workspace? Saves still in progress are cancelled, and their unfinished files are removed."
      : "Close and discard the current workspace?",
  };
}
