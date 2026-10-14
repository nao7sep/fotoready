import type { MessageKey } from "@shared/i18n/catalogues";

export type CloseConfirmation = { title: MessageKey; message: MessageKey };

/**
 * What to ask before the main window closes or FotoReady quits, or null when the close loses
 * nothing. Both discard the workspace and cancel running saves: on macOS the app stays in the Dock
 * with an empty workspace (developer decision), so the question belongs to the window close.
 */
export function closeConfirmation(workspace: { hasWork: boolean; savesInFlight: boolean }): CloseConfirmation | null {
  if (!workspace.hasWork) return null;
  return {
    title: "confirm.close.title",
    message: workspace.savesInFlight ? "confirm.close.messageWithSaves" : "confirm.close.message",
  };
}
