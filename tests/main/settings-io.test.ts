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

/** Saves as the app does: the draft is the effective settings with the user's changes. */
async function save(changes: Record<string, unknown>, logger?: AppLogger): Promise<GlobalSettings> {
  const { settings: previous } = await loadSettings(settingsPath());
  return saveSettings(settingsPath(), { ...previous, ...changes }, previous, logger);
}

describe("settings by set", () => {
  it("loads built-ins on first run without writing any file", async () => {
    expect(await loadSettings(settingsPath())).toEqual({ settings: defaults(), quarantinedTo: null });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("writes only the set that changes", async () => {
    const effective = await save({ defaultOutputFormat: "webp" });
    expect(await written()).toEqual({ defaultOutputFormat: "webp" });
    expect(effective).toEqual({ ...defaults(), defaultOutputFormat: "webp" });
  });

  it("reads every absent set as its built-in without rewriting the file", async () => {
    const text = '{"defaultWebpQuality":71}\n';
    await fs.writeFile(settingsPath(), text);
    expect((await loadSettings(settingsPath())).settings).toEqual({ ...defaults(), defaultWebpQuality: 71 });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(text);
  });

  it("writes every set that differs and drops unknown and version keys at the next save", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ defaultWebpQuality: 71, version: 99, schemaVersion: 99, retired: true }));
    await save({ confirmDeleteTasks: false });
    expect(await written()).toEqual({ defaultWebpQuality: 71, confirmDeleteTasks: false });
  });

  it("drops the retired selection key and writes only the changed role", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ model: "old-model" }));
    const effective = await save({ "gemini.slug": "typed-new-model", "gemini.thinking.slug": null });
    expect(await written()).toEqual({ "gemini.slug": "typed-new-model" });
    expect(effective["gemini.description"]).toBe("gemini-3.8-flash");
    expect(effective["gemini.slug"]).toBe("typed-new-model");
  });

  it("stores a role's Thinking only while it differs from its model's default", async () => {
    await save({ "gemini.thinking.slug": "minimal" });
    expect(await written()).toEqual({});
    await save({ "gemini.thinking.slug": "high" });
    expect(await written()).toEqual({ "gemini.thinking.slug": "high" });
    const effective = await save({ "gemini.slug": "gemini-3.8-flash", "gemini.thinking.slug": "low" });
    expect(await written()).toEqual({ "gemini.slug": "gemini-3.8-flash" });
    expect(effective["gemini.thinking.slug"]).toBe("low");
  });

  it("stores the description's image resolution only while it is not High", async () => {
    await save({ "gemini.mediaResolution.description": "high" });
    expect(await written()).toEqual({});
    const effective = await save({ "gemini.mediaResolution.description": "low" });
    expect(await written()).toEqual({ "gemini.mediaResolution.description": "low" });
    expect(effective["gemini.mediaResolution.description"]).toBe("low");
    await save({ "gemini.mediaResolution.description": "high" });
    expect(await written()).toEqual({});
  });

  it("checks the image resolution against the description model's levels", async () => {
    const warn = vi.fn();
    const effective = await save({ "gemini.mediaResolution.description": "extreme" }, { warn } as unknown as AppLogger);
    expect(await written()).toEqual({});
    expect(effective["gemini.mediaResolution.description"]).toBe("high");
    expect(warn).toHaveBeenCalledOnce();

    await fs.writeFile(settingsPath(), JSON.stringify({ "gemini.description": "typed-unknown", "gemini.thinking.description": null, "gemini.mediaResolution.description": "low" }));
    const loaded = await loadSettings(settingsPath(), { warn } as unknown as AppLogger);
    expect(loaded.settings["gemini.mediaResolution.description"]).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("checks a role's Thinking against its model's values", async () => {
    const warn = vi.fn();
    const effective = await save({ "gemini.thinking.description": "minimal" }, { warn } as unknown as AppLogger);
    expect(await written()).toEqual({});
    expect(effective["gemini.thinking.description"]).toBe("medium");
    expect(warn).toHaveBeenCalledOnce();

    await fs.writeFile(settingsPath(), JSON.stringify({ "gemini.description": "typed-unknown", "gemini.thinking.description": "high" }));
    const loaded = await loadSettings(settingsPath(), { warn } as unknown as AppLogger);
    expect(loaded.settings["gemini.thinking.description"]).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("writes metadata whole rather than merging its members", async () => {
    await save({ injectFields: { author: "Jane", credit: "Me" } });
    await save({ injectFields: { author: "John" } });
    expect(await written()).toEqual({ injectFields: { author: "John" } });
  });

  it("never writes an invalid value, keeping each previous value and reporting each issue", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ defaultWebpQuality: 71, injectFields: { author: "Jane" }, theme: "dark" }));
    const warn = vi.fn();
    const effective = await save({
      defaultWebpQuality: 999,
      previewDebounceMs: 1.5,
      defaultOutputFormat: "gif",
      confirmDeleteTasks: "false",
      injectFields: { author: 42 },
      "gemini.description": "",
      writeSoftwareTag: false,
    }, { warn } as unknown as AppLogger);
    const expected = { defaultWebpQuality: 71, injectFields: { author: "Jane" }, theme: "dark", writeSoftwareTag: false };
    expect(await written()).toEqual(expected);
    expect(effective).toEqual({ ...defaults(), ...expected });
    expect(warn).toHaveBeenCalledTimes(6);
    for (const key of ["defaultWebpQuality", "previewDebounceMs", "defaultOutputFormat", "confirmDeleteTasks", "injectFields.author", "gemini.description"]) {
      expect(warn).toHaveBeenCalledWith("settings contained invalid data; its previous value is kept", {
        mod: "settings",
        issue: expect.stringContaining(`settings.${key}`),
      });
    }
  });

  it("normalizes metadata members, dropping unknown ones", async () => {
    await save({ injectFields: { author: "Jane", credit: "Me" } });
    await save({ injectFields: { author: "John", unknownField: "discard" } });
    expect(await written()).toEqual({ injectFields: { author: "John" } });
  });

  it("heals an invalid stored set at the next save, which writes it as its built-in", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ defaultWebpQuality: 999, "gemini.description": "unlisted-model" }));
    const effective = await save({ confirmDeleteTasks: false });
    expect(await written()).toEqual({ "gemini.description": "unlisted-model", confirmDeleteTasks: false });
    expect(effective.defaultWebpQuality).toBe(defaults().defaultWebpQuality);
    expect(effective["gemini.description"]).toBe("unlisted-model");
  });

  it("writes from the settings it holds, not from the file as it now is", async () => {
    const { settings: previous } = await loadSettings(settingsPath());
    await fs.writeFile(settingsPath(), JSON.stringify({ defaultWebpQuality: 71 }));
    await saveSettings(settingsPath(), { ...previous, confirmDeleteTasks: false }, previous);
    expect(await written()).toEqual({ confirmDeleteTasks: false });
  });

  it("removes a set's key when it is saved back to its built-in, and keeps an empty file when no key remains", async () => {
    await save({ defaultWebpQuality: 71, confirmDeleteTasks: false });
    await save({ defaultWebpQuality: defaults().defaultWebpQuality });
    expect(await written()).toEqual({ confirmDeleteTasks: false });
    const effective = await save({ confirmDeleteTasks: true });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe("{}\n");
    expect(effective).toEqual(defaults());
  });

  it("removes reset prompts while retaining other saved sets", async () => {
    await save({ visionDescriptionPrompt: "custom description", visionSlugPrompt: "custom slug", defaultWebpQuality: 71 });
    const effective = await save({ visionDescriptionPrompt: defaults().visionDescriptionPrompt, visionSlugPrompt: defaults().visionSlugPrompt });
    expect(await written()).toEqual({ defaultWebpQuality: 71 });
    expect(effective.visionDescriptionPrompt).toBe(defaults().visionDescriptionPrompt);
    expect(effective.visionSlugPrompt).toBe(defaults().visionSlugPrompt);
  });

  it("compares after cleanup: a prompt differing by line endings or trailing spaces and a model id differing by case are not stored", async () => {
    await save({
      visionDescriptionPrompt: `\r\n${defaults().visionDescriptionPrompt}  \r\n`,
      visionSlugPrompt: `${defaults().visionSlugPrompt}   `,
      "gemini.description": ` ${defaults()["gemini.description"].toUpperCase()} `,
      "gemini.endpoint": `${defaults()["gemini.endpoint"]} `
    });
    expect(await written()).toEqual({});
  });

  it("stores a differing set in its cleaned form", async () => {
    await save({ visionSlugPrompt: "  Line one  \r\n\r\n  Line two  \n", "gemini.slug": " typed-model ", "gemini.thinking.slug": null, uiFontFamily: " Inter\n Display " });
    expect(await written()).toEqual({ visionSlugPrompt: "  Line one\n\n  Line two", "gemini.slug": "typed-model", uiFontFamily: "Inter Display" });
  });

  it("removes a stored copy equal to its built-in at the next save of another set", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ visionSlugPrompt: `${defaults().visionSlugPrompt}  `, "gemini.slug": defaults()["gemini.slug"].toUpperCase(), defaultWebpQuality: 71 }));
    await save({ confirmDeleteTasks: false });
    expect(await written()).toEqual({ defaultWebpQuality: 71, confirmDeleteTasks: false });
  });

  it("treats an empty metadata member as absent, since it injects nothing", async () => {
    await save({ injectFields: { author: "  ", credit: "" } });
    expect(await written()).toEqual({});
    await save({ injectFields: { author: "Jane", credit: " " } });
    expect(await written()).toEqual({ injectFields: { author: "Jane" } });
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
