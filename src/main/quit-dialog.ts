import { showPlainMessageDialog } from "./plain-message-dialog";
import { mainTranslator } from "./i18n";
import type { QuitChoice, UserWork } from "./quit-save";

const CHOICES: readonly QuitChoice[] = ["cancel", "retry", "quit"];

/**
 * Asks what to do about the user's own work that is not saved on a quit the user started, naming
 * it. Retry is the default; Cancel, which keeps FotoReady open and loses nothing, is the Escape
 * answer and the one an ending session gives.
 */
export async function askWorkNotSaved(unsaved: UserWork[]): Promise<QuitChoice> {
  const { language, t, list } = mainTranslator();
  const names = unsaved.map((work) => (work.kind === "settings" ? t("settings.title") : work.file));
  const choice = await showPlainMessageDialog({
    title: t("quit.notSaved.title"),
    message: t("quit.notSaved.message"),
    detail: t("quit.notSaved.detail", { items: list(names) }),
    buttons: [t("common.cancel"), t("common.retry"), t("quit.quitAnyway")],
    defaultId: 1,
    cancelId: 0,
    destructiveId: 2,
    detailsLabel: t("dialog.messageDetails"),
    lang: language,
  });
  return CHOICES[choice] ?? "cancel";
}

/** The process owns workspace discard even when its main window has closed. */
export async function askDiscardWorkspace(savesInFlight: boolean): Promise<boolean> {
  const { language, t } = mainTranslator();
  return await showPlainMessageDialog({
    title: t("confirm.close.title"),
    message: t(savesInFlight ? "confirm.close.messageWithSaves" : "confirm.close.message"),
    buttons: [t("common.cancel"), t("common.close")],
    defaultId: 0,
    cancelId: 0,
    destructiveId: 1,
    detailsLabel: t("dialog.messageDetails"),
    lang: language,
  }) === 1;
}
