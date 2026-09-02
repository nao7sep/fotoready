import { showPlainMessageDialog } from "./plain-message-dialog";
import type { Logger } from "@shared/types/log";

/** App-authored recovery surface; quarantine paths remain in the session log. */
export async function notifyCorruptSettings(): Promise<void> {
  await showPlainMessageDialog({
    title: "Settings could not be read",
    message: "Your FotoReady settings file was unreadable and a copy has been set aside so nothing is lost.",
    detail: "FotoReady has started with default values for the unreadable fields. Your projects and photos are untouched. The saved copy location is recorded in the session log.",
  });
}

/**
 * The quarantine is a durable recovery consequence, so startup may continue
 * only after its authored explanation was actually shown. If the presentation
 * shell fails, preserve that cause and reject into the existing fatal startup
 * path instead of opening the ordinary workspace with an invisible reset.
 */
export async function requireCorruptSettingsNotice(logger: Pick<Logger, "error">): Promise<void> {
  try {
    await notifyCorruptSettings();
  } catch (cause) {
    const error = new Error("FotoReady could not present the corrupt-settings recovery notice.", { cause });
    logger.error("could not show the corrupt-settings recovery dialog", { mod: "main", err: error });
    throw error;
  }
}

export async function notifyStartupFailure(): Promise<void> {
  await showPlainMessageDialog({
    title: "FotoReady could not start",
    message: "FotoReady could not finish opening its settings and workspace.",
    detail: "No photos or project files were changed. Check the session log, then start FotoReady again.",
  });
}
