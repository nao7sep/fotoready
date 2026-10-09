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
  delete process.env.FOTOREADY_DATA_DIR;
  if (root !== null) {
    await rm(root, { recursive: true, force: true });
    root = null;
  }
});
