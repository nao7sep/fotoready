import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings, saveSettings } from "@main/settings-io";
import { closeBackupStore } from "@main/backup-store";
import { defaultGlobalSettings } from "@shared/defaults";
import type { AppLogger } from "@main/logger";

const ENV_VAR = "FOTOREADY_DATA_DIR";
const prevHome = process.env[ENV_VAR];
let dir: string;
const settingsPath = () => path.join(dir, "config.json");
const defaults = () => defaultGlobalSettings(null);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-settings-"));
  process.env[ENV_VAR] = dir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeBackupStore();
  if (prevHome === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = prevHome;
  await fs.rm(dir, { recursive: true, force: true });
});

const written = async () => JSON.parse(await fs.readFile(settingsPath(), "utf8"));

describe("settings by set", () => {
  it("loads built-ins on first run without writing any file", async () => {
    expect(await loadSettings(settingsPath())).toEqual({ settings: defaults(), quarantinedTo: null });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("writes only the set that changes", async () => {
    const effective = await saveSettings(settingsPath(), { defaultOutputFormat: "webp" });
    expect(await written()).toEqual({ defaultOutputFormat: "webp" });
    expect(effective).toEqual({ ...defaults(), defaultOutputFormat: "webp" });
  });

  it("reads every absent set as its built-in without rewriting the file", async () => {
    const text = '{"defaultWebpQuality":71}\n';
    await fs.writeFile(settingsPath(), text);
    expect((await loadSettings(settingsPath())).settings).toEqual({ ...defaults(), defaultWebpQuality: 71 });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(text);
  });

  it("replaces only requested sets and drops unknown and version keys at the next write", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ defaultWebpQuality: 71, version: 99, schemaVersion: 99, retired: true }));
    await saveSettings(settingsPath(), { confirmDeleteTasks: false });
    expect(await written()).toEqual({ defaultWebpQuality: 71, confirmDeleteTasks: false });
  });

  it("writes metadata whole rather than merging its members", async () => {
    await saveSettings(settingsPath(), { injectFields: { author: "Jane", credit: "Me" } });
    await saveSettings(settingsPath(), { injectFields: { author: "John" } });
    expect(await written()).toEqual({ injectFields: { author: "John" } });
  });

  it("deletes reset prompts while retaining other saved sets", async () => {
    await saveSettings(settingsPath(), { visionDescriptionPrompt: "custom description", visionSlugPrompt: "custom slug", defaultWebpQuality: 71 });
    const effective = await saveSettings(settingsPath(), {}, ["visionDescriptionPrompt", "visionSlugPrompt"]);
    expect(await written()).toEqual({ defaultWebpQuality: 71 });
    expect(effective.visionDescriptionPrompt).toBe(defaults().visionDescriptionPrompt);
    expect(effective.visionSlugPrompt).toBe(defaults().visionSlugPrompt);
  });

  it("logs a bad set and reads only that set as absent without quarantining or rewriting", async () => {
    const original = '{"defaultWebpQuality":999,"confirmDeleteTasks":false}\n';
    await fs.writeFile(settingsPath(), original);
    const warn = vi.fn();
    const result = await loadSettings(settingsPath(), { warn } as unknown as AppLogger);
    expect(result.quarantinedTo).toBeNull();
    expect(result.settings).toEqual({ ...defaults(), confirmDeleteTasks: false });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[1].issue).toContain("settings.defaultWebpQuality");
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(original);
    expect(await fs.readdir(dir)).toEqual(["config.json"]);
  });

  it.each(["{ not valid json", "[]"])("moves unreadable bytes aside without writing a replacement: %s", async (corrupt) => {
    await fs.writeFile(settingsPath(), corrupt);
    const result = await loadSettings(settingsPath());
    expect(result.settings).toEqual(defaults());
    expect(result.quarantinedTo).toMatch(/config-.*\.invalid$/);
    expect(await fs.readFile(result.quarantinedTo!, "utf8")).toBe(corrupt);
    await expect(fs.stat(settingsPath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await loadSettings(settingsPath())).toEqual({ settings: defaults(), quarantinedTo: null });
  });

  it("does not overwrite unreadable bytes when quarantine fails", async () => {
    await fs.writeFile(settingsPath(), "{ bad json");
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("quarantine refused"));
    await expect(loadSettings(settingsPath())).rejects.toThrow("quarantine refused");
    expect(await fs.readFile(settingsPath(), "utf8")).toBe("{ bad json");
  });
});
