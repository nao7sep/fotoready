import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings, saveSettings } from "@main/settings-io";
import { closeBackupStore } from "@main/backup-store";
import { defaultGlobalSettings } from "@shared/defaults";
import { multiline, singleLine } from "@shared/text-cleanup";
import type { GlobalSettings } from "@shared/types/settings";
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

  it("drops the retired selection key and writes only the changed role", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ model: "old-model" }));
    const effective = await saveSettings(settingsPath(), { "gemini.slug": "typed-new-model" });
    expect(await written()).toEqual({ "gemini.slug": "typed-new-model" });
    expect(effective["gemini.description"]).toBe("gemini-3.8-flash");
    expect(effective["gemini.slug"]).toBe("typed-new-model");
  });

  it("writes metadata whole rather than merging its members", async () => {
    await saveSettings(settingsPath(), { injectFields: { author: "Jane", credit: "Me" } });
    await saveSettings(settingsPath(), { injectFields: { author: "John" } });
    expect(await written()).toEqual({ injectFields: { author: "John" } });
  });

  it("never writes an invalid value, leaving each stored copy untouched and reporting each issue", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ defaultWebpQuality: 71, injectFields: { author: "Jane" }, theme: "dark" }));
    const warn = vi.fn();
    const patch = {
      defaultWebpQuality: 999,
      previewDebounceMs: 1.5,
      defaultOutputFormat: "gif",
      confirmDeleteTasks: "false",
      injectFields: { author: 42 },
      "gemini.description": "",
      writeSoftwareTag: false,
    } as unknown as Partial<GlobalSettings>;

    const effective = await saveSettings(settingsPath(), patch, { warn } as unknown as AppLogger);
    const expected = { defaultWebpQuality: 71, injectFields: { author: "Jane" }, theme: "dark", writeSoftwareTag: false };
    expect(await written()).toEqual(expected);
    expect(effective).toEqual({ ...defaults(), ...expected });
    expect(warn).toHaveBeenCalledTimes(6);
    for (const key of ["defaultWebpQuality", "previewDebounceMs", "defaultOutputFormat", "confirmDeleteTasks", "injectFields.author", "gemini.description"]) {
      expect(warn).toHaveBeenCalledWith("settings patch contained invalid data; its stored copy is unchanged", {
        mod: "settings",
        issue: expect.stringContaining(`settings.${key}`),
      });
    }
  });

  it("normalizes metadata members without merging or writing absent sets", async () => {
    await saveSettings(settingsPath(), { injectFields: { author: "Jane", credit: "Me" } });
    const injectFields = { author: "John", unknownField: "discard" };
    await saveSettings(settingsPath(), { injectFields });
    expect(await written()).toEqual({ injectFields: { author: "John" } });
  });

  it("preserves an untouched invalid stored set while rejecting an invalid changed set", async () => {
    const text = JSON.stringify({ defaultWebpQuality: 999, "gemini.description": "unlisted-model" });
    await fs.writeFile(settingsPath(), text);
    const warn = vi.fn();
    const effective = await saveSettings(settingsPath(), { visionMaxRetries: -1 }, { warn } as unknown as AppLogger);
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(text);
    expect(effective.defaultWebpQuality).toBe(defaults().defaultWebpQuality);
    expect(effective["gemini.description"]).toBe("unlisted-model");
    expect(effective.visionMaxRetries).toBe(defaults().visionMaxRetries);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("removes a set's key when it is saved back to its built-in, and leaves no file when no key remains", async () => {
    await saveSettings(settingsPath(), { defaultWebpQuality: 71, confirmDeleteTasks: false });
    await saveSettings(settingsPath(), { defaultWebpQuality: defaults().defaultWebpQuality });
    expect(await written()).toEqual({ confirmDeleteTasks: false });
    const effective = await saveSettings(settingsPath(), { confirmDeleteTasks: true });
    await expect(fs.stat(settingsPath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(effective).toEqual(defaults());
  });

  it("removes reset prompts while retaining other saved sets", async () => {
    await saveSettings(settingsPath(), { visionDescriptionPrompt: "custom description", visionSlugPrompt: "custom slug", defaultWebpQuality: 71 });
    const effective = await saveSettings(settingsPath(), { visionDescriptionPrompt: defaults().visionDescriptionPrompt, visionSlugPrompt: defaults().visionSlugPrompt });
    expect(await written()).toEqual({ defaultWebpQuality: 71 });
    expect(effective.visionDescriptionPrompt).toBe(defaults().visionDescriptionPrompt);
    expect(effective.visionSlugPrompt).toBe(defaults().visionSlugPrompt);
  });

  it("compares after cleanup: a prompt differing by line endings or trailing spaces and a model id differing by case are not stored", async () => {
    await saveSettings(settingsPath(), {
      visionDescriptionPrompt: `\r\n${defaults().visionDescriptionPrompt}  \r\n`,
      visionSlugPrompt: `${defaults().visionSlugPrompt}   `,
      "gemini.description": ` ${defaults()["gemini.description"].toUpperCase()} `,
      "gemini.endpoint": `${defaults()["gemini.endpoint"]} `
    });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("stores a differing set in its cleaned form", async () => {
    await saveSettings(settingsPath(), { visionSlugPrompt: "  Line one  \r\n\r\n  Line two  \n", "gemini.slug": " typed-model ", uiFontFamily: " Inter\n Display " });
    expect(await written()).toEqual({ visionSlugPrompt: "  Line one\n\n  Line two", "gemini.slug": "typed-model", uiFontFamily: "Inter Display" });
  });

  it("removes an untouched stored copy equal to its built-in at the next save of another set", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ visionSlugPrompt: `${defaults().visionSlugPrompt}  `, "gemini.slug": defaults()["gemini.slug"].toUpperCase(), defaultWebpQuality: 71 }));
    await saveSettings(settingsPath(), { confirmDeleteTasks: false });
    expect(await written()).toEqual({ defaultWebpQuality: 71, confirmDeleteTasks: false });
  });

  it("treats an empty metadata member as absent, since it injects nothing", async () => {
    await saveSettings(settingsPath(), { injectFields: { author: "  ", credit: "" } });
    expect(await fs.readdir(dir)).toEqual([]);
    await saveSettings(settingsPath(), { injectFields: { author: "Jane", credit: " " } });
    expect(await written()).toEqual({ injectFields: { author: "Jane" } });
  });

  it("writes nothing when the result equals the file", async () => {
    await saveSettings(settingsPath(), { defaultWebpQuality: 71 });
    const before = await fs.stat(settingsPath());
    await saveSettings(settingsPath(), { defaultWebpQuality: 71, confirmDeleteTasks: true });
    const after = await fs.stat(settingsPath());
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("writes nothing when a built-in is saved with no file present", async () => {
    await saveSettings(settingsPath(), { defaultWebpQuality: defaults().defaultWebpQuality, workerPoolSize: null });
    expect(await fs.readdir(dir)).toEqual([]);
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

describe("built-in texts", () => {
  it("are kept in the cleaned form a saved copy is compared in", () => {
    const builtIns = defaults();
    expect(builtIns.visionDescriptionPrompt).toBe(multiline(builtIns.visionDescriptionPrompt));
    expect(builtIns.visionSlugPrompt).toBe(multiline(builtIns.visionSlugPrompt));
    for (const [key, value] of Object.entries(builtIns)) {
      if (typeof value === "string" && !key.endsWith("Prompt")) expect(value, key).toBe(singleLine(value));
    }
  });
});
