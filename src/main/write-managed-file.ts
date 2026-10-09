/**
 * The managed-text atomic write (data-backup and storage-path conventions): `config.json`, the one
 * durable text file FotoReady owns and reloads as its own data, is written through this helper, so its
 * backup hook lives in one place. After the rename lands, the exact bytes just written are handed to
 * the backup history ({@link record}), which queues them and never waits or throws, so a backup
 * problem can never affect the save.
 *
 * Other writes keep their own unrecorded paths, with the reason beside each write site: `state.json`
 * is state, `api-keys.json` a secret, saved images and their sidecars are output. Imported LUTs and
 * stamps are recorded where they are added (`file-asset-catalog.ts`).
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
