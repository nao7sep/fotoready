import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStateCoordinator, loadState, saveState } from "@main/state-io";
import { closeBackupStore } from "@main/backup-store";
import { defaultUiState } from "@shared/validation/state";
import type { AppLogger } from "@main/logger";

// Real filesystem (a temp dir) so loadState's read → parse → (materialize?) path is exercised end
// to end. state.json is volatile UI state: it must NOT be created on a first run, only once there
// is real state to record.

const ENV_VAR = "FOTOREADY_DATA_DIR";
const prevHome = process.env[ENV_VAR];

let dir: string;
const statePath = () => path.join(dir, "state.json");

// The root override keeps these tests isolated from the developer's data. saveState does not
// record volatile UI state in backups.sqlite3; any backup-store artifacts are excluded from the
// state-directory assertions below.
const STORE_FILES = new Set(["backups.sqlite3", "backups.sqlite3-wal", "backups.sqlite3-shm"]);
const withoutStoreFiles = (files: string[]): string[] => files.filter((f) => !STORE_FILES.has(f));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-state-"));
  process.env[ENV_VAR] = dir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Close the store singleton so it releases this root's file handle and re-opens against the next test's
  // throwaway root.
  closeBackupStore();
  if (prevHome === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = prevHome;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadState", () => {
  it("returns defaults on first run WITHOUT creating state.json", async () => {
    const loaded = await loadState(statePath());

    expect(loaded).toEqual({ state: defaultUiState(), writable: true });
    // The volatile state file is not materialized on first run.
    await expect(fs.access(statePath())).rejects.toThrow();
    // No state.json, and no store file either — loadState performs no managed save, so nothing records.
    expect(withoutStoreFiles(await fs.readdir(dir))).toEqual([]);
  });

  it("reads back state once it has actually been written, with its format version", async () => {
    const saved = { ...defaultUiState(), showHistogram: true };
    await saveState(statePath(), saved);
    expect(JSON.parse(await fs.readFile(statePath(), "utf8"))).toMatchObject({ formatVersion: 1, showHistogram: true });
    expect(await loadState(statePath())).toEqual({ state: saved, writable: true });
  });

  it("replaces a file with no format version with defaults", async () => {
    await fs.writeFile(statePath(), JSON.stringify({ showHistogram: true }), "utf8");
    expect(await loadState(statePath())).toEqual({ state: defaultUiState(), writable: true });
    expect(JSON.parse(await fs.readFile(statePath(), "utf8"))).toMatchObject({ formatVersion: 1, showHistogram: false });
  });

  it("uses defaults for a newer file, never writes it, and leaves it byte-identical", async () => {
    const text = `${JSON.stringify({ formatVersion: 2, showHistogram: true, futureField: [1] })}\n`;
    await fs.writeFile(statePath(), text, "utf8");
    const warn = vi.fn();

    const loaded = await loadState(statePath(), { warn } as unknown as AppLogger);
    expect(loaded).toEqual({ state: defaultUiState(), writable: false });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/newer/), expect.objectContaining({ statePath: statePath(), formatVersion: 2 }));

    const writer = vi.fn(async () => undefined);
    const coordinator = createStateCoordinator(statePath(), loaded, writer);
    await coordinator.update({ showHistogram: true });
    await coordinator.flush();
    expect(writer).not.toHaveBeenCalled();
    expect(loaded.state.showHistogram).toBe(true);
    expect(await fs.readFile(statePath(), "utf8")).toBe(text);
    expect(withoutStoreFiles(await fs.readdir(dir))).toEqual(["state.json"]);
  });

  it("replaces unreadable disposable state with defaults", async () => {
    await fs.writeFile(statePath(), "{ not valid json", "utf8");

    const loaded = await loadState(statePath());

    expect(loaded).toEqual({ state: defaultUiState(), writable: true });
    const files = withoutStoreFiles(await fs.readdir(dir));
    expect(files).toEqual(["state.json"]);
  });

  it("treats a format version that is not a positive integer as unreadable", async () => {
    await fs.writeFile(statePath(), JSON.stringify({ formatVersion: "2", showHistogram: true }), "utf8");

    expect(await loadState(statePath())).toEqual({ state: defaultUiState(), writable: true });
    expect(JSON.parse(await fs.readFile(statePath(), "utf8"))).toMatchObject({ formatVersion: 1, showHistogram: false });
  });
});

describe("saveState", () => {
  it("leaves no state temp file behind when the write fails", async () => {
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("rename refused"));
    await expect(saveState(statePath(), defaultUiState())).rejects.toThrow("rename refused");
    expect(withoutStoreFiles(await fs.readdir(dir))).toEqual([]);
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
    const coordinator = createStateCoordinator(statePath(), { state, writable: true }, writer);

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
    const coordinator = createStateCoordinator(statePath(), { state, writable: true }, writer);

    await expect(coordinator.update({ showHistogram: true })).rejects.toThrow("disk full");
    await coordinator.update({ histogramPosition: { x: 5, y: 6 } });
    await coordinator.flush();

    expect(state.showHistogram).toBe(false);
    expect(state.histogramPosition).toEqual({ x: 5, y: 6 });
    expect(writer).toHaveBeenCalledTimes(2);
  });

  it("reports the last write's failure from flush, so quitting can log it", async () => {
    const writer = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("read-only"));
    const coordinator = createStateCoordinator(statePath(), { state: defaultUiState(), writable: true }, writer);

    void coordinator.update({ showHistogram: true });
    void coordinator.update({ histogramPosition: { x: 1, y: 2 } }).catch(() => undefined);

    await expect(coordinator.flush()).rejects.toThrow("read-only");
  });
});
