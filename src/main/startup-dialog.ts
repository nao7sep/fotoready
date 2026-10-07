import { showPlainMessageDialog } from "./plain-message-dialog";
import { mainTranslator } from "./i18n";
import type { Logger } from "@shared/types/log";
import type { MessageKey } from "@shared/i18n/catalogues";
import type { MessageValues } from "@shared/i18n/translate";

// Every notice speaks the interface language: the corrupt-settings notice shows after the settings
// were read, and a startup failure before then speaks the computer's language (System).
async function showNotice(title: MessageKey, message: MessageKey, detail: MessageKey, detailValues?: MessageValues): Promise<void> {
  const { language, t } = mainTranslator();
  await showPlainMessageDialog({
    title: t(title),
    message: t(message),
    detail: t(detail, detailValues),
    buttons: [t("common.ok")],
    detailsLabel: t("dialog.messageDetails"),
    lang: language,
  });
}

/** App-authored recovery surface: it names the set-aside `.invalid` file and the defaults started with (store-recovery-conventions). */
export async function notifyCorruptSettings(quarantinedTo: string): Promise<void> {
  await showNotice("startup.corruptSettingsTitle", "startup.corruptSettingsMessage", "startup.corruptSettingsDetail", { path: quarantinedTo });
}

/**
 * The quarantine is a durable recovery consequence, so startup may continue
 * only after its authored explanation was actually shown. If the presentation
 * shell fails, preserve that cause and reject into the existing fatal startup
 * path instead of opening the ordinary workspace with an invisible reset.
 */
export async function requireCorruptSettingsNotice(logger: Pick<Logger, "error">, quarantinedTo: string): Promise<void> {
  try {
    await notifyCorruptSettings(quarantinedTo);
  } catch (cause) {
    const error = new Error("FotoReady could not present the corrupt-settings recovery notice.", { cause });
    logger.error("could not show the corrupt-settings recovery dialog", { mod: "main", err: error });
    throw error;
  }
}

/** Failed settings quarantine reports the original file left in place. */
export async function notifySettingsQuarantineFailure(filePath: string): Promise<void> {
  await showNotice("startup.corruptSettingsTitle", "startup.settingsLeftMessage", "startup.settingsLeftDetail", { path: filePath });
}

export async function notifyStartupFailure(): Promise<void> {
  await showNotice("startup.failedTitle", "startup.failedMessage", "startup.failedDetail");
}

/** The halt for a store a newer FotoReady wrote: it names the file, which is left as it is. */
export async function notifyNewerFormat(filePath: string): Promise<void> {
  await showNotice("startup.newerFileTitle", "startup.newerFileMessage", "startup.newerFileDetail", { path: filePath });
}
