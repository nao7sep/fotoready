import { showPlainMessageDialog } from "./plain-message-dialog";
import { mainTranslator } from "./i18n";
import type { Logger } from "@shared/types/log";
import type { MessageKey } from "@shared/i18n/catalogues";
import type { MessageValues } from "@shared/i18n/translate";
import type { SettingsNotice } from "./settings-io";

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

/**
 * App-authored recovery surface (store-recovery-conventions): it names the set-aside `.invalid` file
 * and the defaults started with, or the settings file left in place because it could not be read.
 */
export async function notifySettingsRecovery(notice: SettingsNotice): Promise<void> {
  if (notice.kind === "setAside") {
    await showNotice("startup.corruptSettingsTitle", "startup.corruptSettingsMessage", "startup.corruptSettingsDetail", { path: notice.path });
  } else {
    await showNotice("startup.corruptSettingsTitle", "startup.settingsUnreadableMessage", "startup.settingsUnreadableDetail", { path: notice.path });
  }
}

/**
 * Shows the settings notice once. The recovery it reports has already happened, so a notice that
 * cannot be shown is logged and not retried.
 */
export async function showSettingsNotice(logger: Pick<Logger, "error">, notice: SettingsNotice): Promise<void> {
  try {
    await notifySettingsRecovery(notice);
  } catch (error) {
    logger.error("could not show the settings recovery notice", { mod: "main", notice, err: error });
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
