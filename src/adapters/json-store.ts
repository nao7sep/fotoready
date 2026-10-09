import fs from "node:fs/promises";
import path from "node:path";
import { message, type Message } from "@shared/i18n/translate";
import { utcStamp } from "@shared/time";

/** Why a store found at load is left exactly as it is for the session. */
export type StoreLeftReason = "unreadable" | "newer";

/**
 * A save to a store that load decided not to write this session (store-recovery-conventions): it
 * could not be read or set aside, or a newer FotoReady wrote it. `reason` is shown beneath the failed
 * save.
 */
export class StoreNotWritableError extends Error {
  readonly reason: Message;

  constructor(readonly filePath: string, left: StoreLeftReason) {
    super(`${filePath} was left as it is when FotoReady started, so this session does not write it.`);
    this.name = "StoreNotWritableError";
    this.reason = message(left === "newer" ? "failure.storeLeftNewer" : "failure.storeLeftUnreadable", { path: filePath });
  }
}

/**
 * Sets an unreadable store aside as `<stem>-<timestamp>.invalid` beside it (derived-filename grammar)
 * and returns that path. The copy is created exclusively, so a second set-aside within the same second
 * fails instead of replacing the first; the original is removed only after its copy exists. Throws when
 * either step fails, leaving the original in place.
 */
export async function setAsideStore(filePath: string): Promise<string> {
  const { dir, name } = path.parse(filePath);
  const setAsidePath = path.join(dir, `${name}-${utcStamp()}.invalid`);
  await fs.copyFile(filePath, setAsidePath, fs.constants.COPYFILE_EXCL);
  await fs.rm(filePath);
  return setAsidePath;
}
