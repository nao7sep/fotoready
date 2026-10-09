import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));

import { record, setBackupWriter } from "@main/backup-store";
import type { BackupWrite } from "@main/backup-tables";
import { loadSettings, saveSettings } from "@main/settings-io";
import { saveState } from "@main/state-io";
import { ApiKeyStore } from "@adapters/api-keys";
import { importLuts } from "@main/lut-catalog";
import { importStamps } from "@main/stamp-catalog";
import { writeTaskSidecarFile } from "@main/task-sidecar";
import { defaultUiState } from "@shared/validation/state";
import { defaultPipeline } from "@shared/defaults";
import type { Original, Task } from "@shared/types/project";

// Which writes reach the backup history, and with which bytes (data-backup-conventions, What is
// protected): config.json after each save and each LUT and stamp the user adds; never output, state,
// secrets or records. The store writer's own handling of these writes is tested in store-writer.test.ts.

let root: string;
let recorded: BackupWrite[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-capture-"));
  recorded = [];
  setBackupWriter({ writeBackup: (write) => recorded.push(write) });
});

afterEach(async () => {
  setBackupWriter(null);
  await fs.rm(root, { recursive: true, force: true });
});

const paths = () => recorded.map((write) => write.path);

describe("the backup history's coverage", () => {
  it("records config.json's exact bytes after each save that writes it", async () => {
    const settingsPath = path.join(root, "config.json");
    const loaded = await loadSettings(settingsPath);
    await saveSettings(loaded.file, { ...loaded.settings, defaultWebpQuality: 71 }, loaded.settings);
    expect(recorded).toEqual([{ path: settingsPath, bytes: new Uint8Array(await fs.readFile(settingsPath)), writtenAt: expect.stringMatching(/Z$/) }]);

    // A save that leaves the bytes as they are writes nothing, so it records nothing.
    const again = await loadSettings(settingsPath);
    await saveSettings(again.file, again.settings, again.settings);
    expect(recorded).toHaveLength(1);
  });

  it("records each imported LUT and stamp once, from the bytes written, and not a name conflict", async () => {
    const source = path.join(root, "source");
    await fs.mkdir(source);
    const lut = path.join(source, "Warm.cube");
    const stamp = path.join(source, "Approved.svg");
    await fs.writeFile(lut, "LUT_3D_SIZE 2\n0 0 0\n");
    await fs.writeFile(stamp, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    const empty = path.join(root, "bundled");
    await fs.mkdir(empty);

    const [importedLut] = await importLuts([lut], "", path.join(root, "luts"), empty);
    const [importedStamp] = await importStamps([stamp], "", path.join(root, "stamps"), empty);
    await importLuts([lut], "", path.join(root, "luts"), empty);

    expect(importedLut?.status).toBe("imported");
    expect(importedStamp?.status).toBe("imported");
    expect(paths()).toEqual([importedLut!.path, importedStamp!.path]);
    expect(Buffer.from(recorded[0]!.bytes).toString()).toBe(await fs.readFile(importedLut!.path, "utf8"));
    expect(Buffer.from(recorded[1]!.bytes).toString()).toBe(await fs.readFile(importedStamp!.path, "utf8"));
  });

  it("records nothing for state, secrets or output", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined);
    await saveState(path.join(root, "state.json"), defaultUiState());
    await new ApiKeyStore(path.join(root, "api-keys.json")).set("gemini", "fake-key");
    const original = { sourcePath: path.join(root, "photo.jpg"), sourceHash: "hash", size: 1, format: "jpeg", width: 1, height: 1 } as Original;
    const task = { generateDescription: false, generateSlug: false, customSlug: null, output: null } as unknown as Task;
    await writeTaskSidecarFile(path.join(root, "photo-out.jpg"), original, task, defaultPipeline());
    vi.unstubAllEnvs();
    expect(recorded).toEqual([]);
  });

  it("hands over a copy of exactly the bytes given, even from a view into a larger buffer", () => {
    const larger = Buffer.from("xxsavedxx");
    record(path.join(root, "config.json"), larger.subarray(2, 7));
    expect(Buffer.from(recorded[0]!.bytes).toString()).toBe("saved");
    expect(recorded[0]!.bytes.byteLength).toBe(5);
    expect(recorded[0]!.bytes.buffer.byteLength).toBe(5);
  });
});
