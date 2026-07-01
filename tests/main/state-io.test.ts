import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState, saveState } from "@main/state-io";
import { defaultUiState } from "@shared/validation/state";

// Real filesystem (a temp dir) so loadState's read → parse → (materialize?) path is exercised end
// to end. state.json is volatile UI state: it must NOT be created on a first run, only once there
// is real state to record.

let dir: string;
const statePath = () => path.join(dir, "state.json");

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-state-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadState", () => {
  it("returns defaults on first run WITHOUT creating state.json", async () => {
    const state = await loadState(statePath());

    expect(state).toEqual(defaultUiState());
    // The volatile state file is not materialized on first run.
    await expect(fs.access(statePath())).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("reads back state once it has actually been written", async () => {
    await saveState(statePath(), defaultUiState());
    expect(await loadState(statePath())).toEqual(defaultUiState());
  });

  it("quarantines an unreadable state file, then resets it in place", async () => {
    await fs.writeFile(statePath(), "{ not valid json", "utf8");

    const state = await loadState(statePath());

    expect(state).toEqual(defaultUiState());
    // The corrupt bytes are preserved aside, and state.json is reset so the next launch is clean.
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.startsWith("state.json.") && f.endsWith(".invalid"))).toBe(true);
    expect(files).toContain("state.json");
  });
});
