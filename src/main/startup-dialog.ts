import { showPlainMessageDialog } from "./plain-message-dialog";
import { mainTranslator } from "./i18n";
import type { Logger } from "@shared/types/log";
import type { MessageKey } from "@shared/i18n/catalogues";

// Both notices speak the interface language: the corrupt-settings notice shows after the settings
// were read, and a startup failure before then speaks the computer's language (System).
async function showNotice(title: MessageKey, message: MessageKey, detail: MessageKey): Promise<void> {
  const { language, t } = mainTranslator();
  await showPlainMessageDialog({
    title: t(title),
    message: t(message),
    detail: t(detail),
    closeLabel: t("common.ok"),
    detailsLabel: t("dialog.messageDetails"),
    lang: language,
  });
}

/** App-authored recovery surface; quarantine paths remain in the session log. */
export async function notifyCorruptSettings(): Promise<void> {
  await showNotice("startup.corruptSettingsTitle", "startup.corruptSettingsMessage", "startup.corruptSettingsDetail");
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
  await showNotice("startup.failedTitle", "startup.failedMessage", "startup.failedDetail");
}
