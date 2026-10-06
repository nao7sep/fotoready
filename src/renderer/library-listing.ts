import type { Message } from "@shared/i18n/translate";
import { isIpcFailure } from "@shared/ipc-failure";
import { presentFailure } from "./present-failure";

/** A LUT or stamp library as the main window shows it: its entries, or none and a notice saying why. */
export type LibraryListing<T> = { entries: T[]; notice: Message | null };

/**
 * Lists one asset library for the main window. A failure the main process authored for the user
 * (the library folder names an unset variable or cannot be read) lists the library as empty with
 * `notice` and that reason beneath it, so the window still opens and the folder can be fixed in
 * Settings. Any other failure propagates.
 */
export async function listLibrary<T>(list: () => Promise<T[]>, notice: Message, operation: string): Promise<LibraryListing<T>> {
  try {
    return { entries: await list(), notice: null };
  } catch (error) {
    if (!isIpcFailure(error)) throw error;
    return { entries: [], notice: presentFailure(error, notice, operation) };
  }
}
