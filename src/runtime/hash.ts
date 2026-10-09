import { createHash } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";

export function sha256Bytes(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** How much of a file is hashed between turns of the event loop. */
const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * The same hash as {@link sha256Bytes}, computed a megabyte at a time with a turn of the event loop
 * between chunks, so hashing a large saved image or imported photo on the main process never holds
 * up IPC, timers or quitting for its whole length.
 */
export async function sha256BytesYielding(bytes: Buffer | Uint8Array): Promise<string> {
  const hash = createHash("sha256");
  for (let offset = 0; offset < bytes.byteLength; offset += HASH_CHUNK_BYTES) {
    if (offset > 0) await nextTurn();
    hash.update(bytes.subarray(offset, offset + HASH_CHUNK_BYTES));
  }
  return hash.digest("hex");
}
