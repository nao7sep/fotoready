import { showPlainMessageDialog } from "./plain-message-dialog";
import { mainTranslator } from "./i18n";
import type { Logger } from "@shared/types/log";
import type { MessageKey } from "@shared/i18n/catalogues";
import type { MessageValues } from "@shared/i18n/translate";
import type { RefusedFileError, StoreLeftReason } from "@adapters/json-store";

// Every notice speaks the interface language: a side-store notice shows after the settings were read,
// and a startup stop before then speaks the computer's language (System).
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

export async function notifyStartupFailure(): Promise<void> {
  await showNotice("startup.failedTitle", "startup.failedMessage", "startup.failedDetail");
}

/**
 * The launch stop (store-recovery-conventions, What a refused file does): one message naming every
 * file FotoReady refused, whether a newer version wrote it or it could not be read, and what to do.
 */
export async function notifyRefusedFiles(files: readonly RefusedFileError[]): Promise<void> {
  const { language, t } = mainTranslator();
  const lines = files.map((file) => t(file.reason === "newer" ? "startup.refusedNewer" : "startup.refusedUnreadable", { path: file.filePath }));
  await showPlainMessageDialog({
    title: t("startup.failedTitle"),
    message: t("startup.refusedMessage"),
    detail: [...lines, t("startup.refusedAdvice")].join("\n\n"),
    buttons: [t("common.ok")],
    detailsLabel: t("dialog.messageDetails"),
    lang: language,
  });
}

/**
 * Says once, while FotoReady keeps running, that Records or backups are off for this session because
 * their database is refused; the database is left as it is. A notice that cannot be shown is logged.
 */
export async function showSideStoreOff(logger: Pick<Logger, "error">, store: "records" | "backups", filePath: string, reason: StoreLeftReason): Promise<void> {
  const prefix = store === "records" ? "store.recordsOff" : "store.backupsOff";
  try {
    await showNotice(`${prefix}Title`, `${prefix}Message`, reason === "newer" ? "store.offNewerDetail" : "store.offUnreadableDetail", { path: filePath });
  } catch (error) {
    logger.error("could not show the notice that a side store is off", { mod: "main", store, filePath, err: error });
  }
}
