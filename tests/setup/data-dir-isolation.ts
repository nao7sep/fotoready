import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

// Every test gets its own throwaway storage root, so nothing a test writes reaches the developer's
// real ~/.fotoready (storage-path-conventions). A test that wants a specific root sets
// FOTOREADY_DATA_DIR in its own beforeEach, which runs after this one.

let root: string | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fotoready-data-"));
  process.env.FOTOREADY_DATA_DIR = root;
});

afterEach(async () => {
  // The store singleton holds a handle under the root; release it so the next test re-opens
  // against its own root and the folder can be removed on every platform. Imported here, not at
  // the top, so a spec's own vi.mock of node:os or electron still reaches the modules it loads.
  const { closeBackupStore } = await import("@main/backup-store");
  closeBackupStore();
  delete process.env.FOTOREADY_DATA_DIR;
  if (root !== null) {
    await rm(root, { recursive: true, force: true });
    root = null;
  }
});
