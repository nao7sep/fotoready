import fs from "node:fs/promises";
import { parseHeaderedJson, type FileKind } from "@shared/file-header";
import { message, type Message } from "@shared/i18n/translate";

/** Why a file is refused (store-recovery-conventions, What a refused file does). */
export type StoreLeftReason = "unreadable" | "newer";

/**
 * A save to a file that is refused (store-recovery-conventions): it could not be read, or a newer
 * FotoReady wrote it, so it is left exactly as it is. `reason` is shown beneath the failed save.
 */
export class StoreNotWritableError extends Error {
  readonly reason: Message;

  constructor(readonly filePath: string, left: StoreLeftReason) {
    super(`${filePath} is refused, so FotoReady leaves it as it is and does not write it.`);
    this.name = "StoreNotWritableError";
    this.reason = message(left === "newer" ? "failure.storeLeftNewer" : "failure.storeLeftUnreadable", { path: filePath });
  }
}

/** A file FotoReady opens to start that it refuses; it is left exactly as it is. */
export class RefusedFileError extends Error {
  constructor(readonly filePath: string, readonly reason: StoreLeftReason, cause?: unknown) {
    super(reason === "newer" ? `${filePath} was written by a newer FotoReady.` : `${filePath} could not be read.`, { cause });
    this.name = "RefusedFileError";
  }
}

/** Startup stops: every file it refused, named in one message, with nothing written. */
export class LaunchRefusedError extends Error {
  constructor(readonly files: readonly RefusedFileError[]) {
    super(`FotoReady stopped because it refuses ${files.map((file) => file.filePath).join(", ")}.`);
    this.name = "LaunchRefusedError";
  }
}

/**
 * Why the file at `filePath` is refused as `kind` now, or null when it is missing or readable. A file
 * that cannot be read at all is unreadable. Checked at the write itself, so no save reaches a refused
 * file, whatever was read earlier in the session.
 */
export async function refusalOf(filePath: string, kind: FileKind): Promise<StoreLeftReason | null> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "unreadable";
  }
  const read = parseHeaderedJson(text, kind);
  return read.kind === "current" ? null : read.kind === "newer" ? "newer" : "unreadable";
}
