import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState, saveState } from "@main/state-io";
import { closeBackupStore } from "@main/backup-store";
import { defaultUiState } from "@shared/validation/state";

// Real filesystem (a temp dir) so loadState's read → parse → (materialize?) path is exercised end
// to end. state.json is volatile UI state: it must NOT be created on a first run, only once there
// is real state to record.

const ENV_VAR = "FOTOREADY_HOME";
const prevHome = process.env[ENV_VAR];

let dir: string;
const statePath = () => path.join(dir, "state.json");

// The write-through data-backup store resolves its file from FOTOREADY_HOME; point it at this test's
// throwaway root so saveState's record writes backups.sqlite3 HERE (cleaned up below) instead of the
// developer's home dir. Its files are normal SQLite artifacts under the root, filtered out of any
// directory-contents assertion below (data-backup conventions).
const STORE_FILES = new Set(["backups.sqlite3", "backups.sqlite3-wal", "backups.sqlite3-shm"]);
const withoutStoreFiles = (files: string[]): string[] => files.filter((f) => !STORE_FILES.has(f));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-state-"));
  process.env[ENV_VAR] = dir;
});

afterEach(async () => {
  // Close the store singleton so it releases this root's file handle and re-opens against the next test's
  // throwaway root.
  closeBackupStore();
  if (prevHome === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = prevHome;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadState", () => {
  it("returns defaults on first run WITHOUT creating state.json", async () => {
    const state = await loadState(statePath());

    expect(state).toEqual(defaultUiState());
    // The volatile state file is not materialized on first run.
    await expect(fs.access(statePath())).rejects.toThrow();
    // No state.json, and no store file either — loadState performs no managed save, so nothing records.
    expect(withoutStoreFiles(await fs.readdir(dir))).toEqual([]);
  });

  it("reads back state once it has actually been written", async () => {
    await saveState(statePath(), defaultUiState());
    expect(await loadState(statePath())).toEqual(defaultUiState());
  });

  it("quarantines an unreadable state file, then resets it in place", async () => {
    await fs.writeFile(statePath(), "{ not valid json", "utf8");

    const state = await loadState(statePath());

    expect(state).toEqual(defaultUiState());
    // The corrupt bytes are preserved aside (as state-<stamp>.invalid, derived-filename grammar), and
    // state.json is reset so the next launch is clean.
    const files = withoutStoreFiles(await fs.readdir(dir));
    expect(files.some((f) => f.startsWith("state-") && f.endsWith(".invalid"))).toBe(true);
    expect(files).toContain("state.json");
  });
});
