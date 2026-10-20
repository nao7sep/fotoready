import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { DATA_DIR_ENV_VAR } from "@shared/constants";

// Every test gets its own throwaway storage root, so nothing a test writes reaches the developer's
// real ~/.fotoready. A test that wants a specific root sets the variable in its own beforeEach,
// which runs after this one.

let root: string | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fotoready-data-"));
  process.env[DATA_DIR_ENV_VAR] = root;
});

afterEach(async () => {
  delete process.env[DATA_DIR_ENV_VAR];
  if (root !== null) {
    await rm(root, { recursive: true, force: true });
    root = null;
  }
});
