import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStateCoordinator, loadState, saveState } from "@main/state-io";
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

  it("replaces unreadable disposable state with defaults", async () => {
    await fs.writeFile(statePath(), "{ not valid json", "utf8");

    const state = await loadState(statePath());

    expect(state).toEqual(defaultUiState());
    const files = withoutStoreFiles(await fs.readdir(dir));
    expect(files).toEqual(["state.json"]);
  });
});

describe("createStateCoordinator", () => {
  it("orders writes and computes each patch from the latest committed state", async () => {
    const state = defaultUiState();
    const writes: typeof state[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writer = vi.fn(async (_path: string, next: typeof state) => {
      writes.push(structuredClone(next));
      if (writes.length === 1) await firstBlocked;
    });
    const coordinator = createStateCoordinator(statePath(), state, writer);

    const first = coordinator.update({ showHistogram: true });
    const second = coordinator.update({ histogramPosition: { x: 30, y: 40 } });
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    releaseFirst();
    await Promise.all([first, second]);

    expect(writes).toHaveLength(2);
    expect(writes[1].showHistogram).toBe(true);
    expect(writes[1].histogramPosition).toEqual({ x: 30, y: 40 });
    expect(state).toEqual(writes[1]);
  });

  it("continues after a failed write without mutating state for the failed patch", async () => {
    const state = defaultUiState();
    const writer = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const coordinator = createStateCoordinator(statePath(), state, writer);

    await expect(coordinator.update({ showHistogram: true })).rejects.toThrow("disk full");
    await coordinator.update({ histogramPosition: { x: 5, y: 6 } });
    await coordinator.flush();

    expect(state.showHistogram).toBe(false);
    expect(state.histogramPosition).toEqual({ x: 5, y: 6 });
    expect(writer).toHaveBeenCalledTimes(2);
  });
});
