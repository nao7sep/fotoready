/**
 * The backup history's entry point on the main process (data-backup-conventions). A protected write
 * hands the exact bytes it just published here, strictly after its rename lands; the store writer
 * records them in `backups.sqlite3` on its own thread, one row per path per session. The save never
 * waits on the history: recording is queued, best-effort, and silent on success. There is no startup
 * scan, no periodic pass and no restore path; restore is manual.
 *
 * What is protected: `config.json` after each save, and each LUT and stamp the user imports, once,
 * when added. Not protected, each with its reason at its write site: saved images and their sidecars
 * (output), `state.json` (state), `api-keys.json` (a secret), and records.
 */

import type { StoreWriter } from "./store-writer";

let writer: Pick<StoreWriter, "writeBackup"> | null = null;

/** Wires the session's store writer in, once, at bootstrap. Until then nothing is recorded. */
export function setBackupWriter(storeWriter: Pick<StoreWriter, "writeBackup"> | null): void {
  writer = storeWriter;
}

/**
 * Records one protected write: `absolutePath` is the full absolute path of the file as written and
 * `bytes` the exact bytes just written, never a reread of the file. Never waits and never throws.
 */
export function record(absolutePath: string, bytes: Uint8Array): void {
  // A copy of exactly these bytes: a Buffer may be a view into a larger shared allocation.
  writer?.writeBackup({ path: absolutePath, bytes: new Uint8Array(bytes), writtenAt: new Date().toISOString() });
}
