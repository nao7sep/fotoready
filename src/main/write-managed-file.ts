/**
 * The single managed-text atomic-write choke point (data-backup + storage-path conventions). Every durable
 * text file fotoready OWNS and reloads as its own state — `config.json` (settings-io) and `state.json`
 * (state-io) — is written through this one helper, so the data-backup hook lives in exactly ONE place. A
 * managed-text write that bypasses this helper is a silent backup gap.
 *
 * It delegates the atomic temp-then-rename to {@link atomicWriteFile} (the layer-neutral writer shared with
 * the non-recorded write sites) and passes an `afterWrite` hook that, strictly AFTER the rename lands,
 * records the exact bytes just written into `~/.fotoready/backups.sqlite3`. The record is best-effort and
 * silent: {@link record} catches, logs once at `warn`, and swallows every failure, so a backup problem can
 * never throw back into this write or affect the save's success.
 *
 * Not every atomic write is a managed-text write. The three write sites that deliberately do NOT record —
 * `api-keys.json` (a secret; never recorded), the output `.json` sidecar (colocated with output images,
 * excluded by the binary-bearing-directory rule), and any binary — keep calling {@link atomicWriteFile}
 * directly with no `afterWrite`. That per-write-site split IS the record/no-record decision, made at
 * authoring time by the call site, never by sniffing content here.
 */

import { atomicWriteFile } from "@adapters/atomic-file";
import { record } from "./backup-store";

/**
 * Atomically write a managed *text* file and record its exact on-disk bytes after the rename. `filePath` is
 * the full absolute path of the managed file; `text` is its serialized content. Throws on write failure (the
 * caller logs it); the record itself never throws.
 */
export async function writeManagedFile(filePath: string, text: string): Promise<void> {
  await atomicWriteFile(filePath, text, {
    afterWrite: (bytes) => record(filePath, bytes)
  });
}
