import type { MessageKey } from "@shared/i18n/catalogues";

export type CloseConfirmation = { title: MessageKey; message: MessageKey };

/**
 * What to ask before FotoReady quits, which closing its main window does on every platform, or null
 * when quitting loses nothing. The question names running saves and descriptions, which quitting
 * stops (unsaved-edits-conventions).
 */
export function closeConfirmation(workspace: { hasWork: boolean; savesInFlight: boolean }): CloseConfirmation | null {
  if (!workspace.hasWork) return null;
  return {
    title: "confirm.close.title",
    message: workspace.savesInFlight ? "confirm.close.messageWithSaves" : "confirm.close.message",
  };
}
