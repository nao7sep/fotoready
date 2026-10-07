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

/** A completed quarantine survives incidental presentation failure. */
export async function showCorruptSettingsNotice(logger: Pick<Logger, "error">, quarantinedTo: string): Promise<boolean> {
  try {
    await notifyCorruptSettings(quarantinedTo);
    return true;
  } catch (error) {
    logger.error("could not show the corrupt-settings recovery dialog", { mod: "main", quarantinedTo, err: error });
    return false;
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
