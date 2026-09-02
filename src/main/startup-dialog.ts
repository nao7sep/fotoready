import { showPlainMessageDialog } from "./plain-message-dialog";

/** App-authored recovery surface; quarantine paths remain in the session log. */
export async function notifyCorruptSettings(): Promise<void> {
  await showPlainMessageDialog({
    title: "Settings could not be read",
    message: "Your FotoReady settings file was unreadable and a copy has been set aside so nothing is lost.",
    detail: "FotoReady has started with default values for the unreadable fields. Your projects and photos are untouched. The saved copy location is recorded in the session log.",
  });
}

export async function notifyStartupFailure(): Promise<void> {
  await showPlainMessageDialog({
    title: "FotoReady could not start",
    message: "FotoReady could not finish opening its settings and workspace.",
    detail: "No photos or project files were changed. Check the session log, then start FotoReady again.",
  });
}
