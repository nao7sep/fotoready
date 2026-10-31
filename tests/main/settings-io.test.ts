import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings, saveSettings } from "@main/settings-io";
import { defaultGlobalSettings } from "@shared/defaults";
import { multiline, singleLine } from "@shared/text-cleanup";
import type { GlobalSettings } from "@shared/types/settings";
import type { AppLogger } from "@main/logger";
import { header } from "../helpers/file-header";

const ENV_VAR = "FOTOREADY_DATA_DIR";
const prevHome = process.env[ENV_VAR];
let dir: string;
const settingsPath = () => path.join(dir, "config.json");
const defaults = () => defaultGlobalSettings();

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-settings-"));
  process.env[ENV_VAR] = dir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (prevHome === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = prevHome;
  await fs.rm(dir, { recursive: true, force: true });
});

/** The sets the file holds, none while first run has written no file; every save records the format version first. */
const written = async () => {
  const text = await fs.readFile(settingsPath(), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return JSON.stringify(header("config"));
    throw error;
  });
  const { format, writer: _writer, ...sets } = JSON.parse(text) as Record<string, unknown>;
  expect(format).toEqual(header("config").format);
  return sets;
};

/** Saves as the app does: the draft is the effective settings with the user's changes. */
async function save(changes: Record<string, unknown>, logger?: AppLogger): Promise<GlobalSettings> {
  const { settings: previous, file } = await loadSettings(settingsPath());
  return saveSettings(file, { ...previous, ...changes }, previous, logger);
}

/** A file the process cannot read, as an access failure leaves it; skipped where permissions do not apply. */
const accessDeniable = process.platform !== "win32" && process.getuid?.() !== 0;

describe("the settings format version", () => {
  it.each([
    ["no header", { defaultWebpQuality: 71 }],
    ["another owner", { format: { owner: "gptimg", kind: "config", version: 1 }, defaultWebpQuality: 71 }],
    ["another kind", { ...header("state"), defaultWebpQuality: 71 }],
    ["a version that is not a positive integer", { ...header("config", 0), defaultWebpQuality: 71 }]
  ])("refuses a file with %s as unreadable and leaves it byte-identical", async (_label, root) => {
    const text = JSON.stringify(root);
    await fs.writeFile(settingsPath(), text);
    await expect(loadSettings(settingsPath())).rejects.toMatchObject({ name: "RefusedFileError", filePath: settingsPath(), reason: "unreadable" });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(text);
    expect(await fs.readdir(dir)).toEqual(["config.json"]);
  });

  it("ignores writer when reading", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ format: header("config").format, writer: "anything", defaultWebpQuality: 71 }));
    expect((await loadSettings(settingsPath())).settings.defaultWebpQuality).toBe(71);
  });

  it("writes the current version first and reads it back", async () => {
    await save({ defaultWebpQuality: 71 });
    const text = await fs.readFile(settingsPath(), "utf8");
    expect(text.startsWith('{\n  "format": {\n    "owner": "fotoready",\n    "kind": "config",\n    "version": 1\n  },\n  "writer": {')).toBe(true);
    expect((await loadSettings(settingsPath())).settings).toEqual({ ...defaults(), defaultWebpQuality: 71 });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(text);
  });

  it("refuses a newer file, naming it, and leaves it byte-identical", async () => {
    const text = `${JSON.stringify({ ...header("config", 2), defaultWebpQuality: 71 })}\n`;
    await fs.writeFile(settingsPath(), text);

    await expect(loadSettings(settingsPath())).rejects.toMatchObject({ name: "RefusedFileError", filePath: settingsPath(), reason: "newer" });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(text);
    expect(await fs.readdir(dir)).toEqual(["config.json"]);
  });

  it.each([
    ["a newer FotoReady", header("config", 2), "newer"],
    ["something unreadable", { defaultWebpQuality: 1 }, "unreadable"]
  ] as const)("refuses a save once %s has replaced the file, leaving it byte-identical", async (_label, root, reason) => {
    await save({ defaultWebpQuality: 71 });
    const { settings, file } = await loadSettings(settingsPath());
    const text = JSON.stringify(root);
    await fs.writeFile(settingsPath(), text);
    await expect(saveSettings(file, { ...settings, confirmDeleteTasks: false }, settings)).rejects.toMatchObject({ name: "StoreNotWritableError", reason: { key: reason === "newer" ? "failure.storeLeftNewer" : "failure.storeLeftUnreadable" } });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(text);
  });
});

describe("settings by set", () => {
  it("keeps a TIFF output default through saving and reopening", async () => {
    expect((await save({ defaultOutputFormat: "tiff" })).defaultOutputFormat).toBe("tiff");
    expect(await written()).toEqual({ defaultOutputFormat: "tiff" });
    const reopened = await loadSettings(settingsPath());
    expect(reopened.settings.defaultOutputFormat).toBe("tiff");
  });

  it.each(["defaultOutputDirectory", "lutFolder", "stampFolder", "defaultWatermarkImage"] as const)(
    "preserves literal selected %s through saving, reopening and a whitespace-only filename change",
    async (key) => {
      const first = path.join(dir, " $UNSET_SETTINGS %literal%");
      const selected = `${first} `;
      await save({ [key]: first });
      expect((await save({ [key]: selected }))[key]).toBe(selected);
      expect((await loadSettings(settingsPath())).settings[key]).toBe(selected);
      expect((await written())[key]).toBe(selected);
    }
  );

  it("loads built-ins on first run without writing any file", async () => {
    expect(await loadSettings(settingsPath())).toEqual({ settings: defaults(), file: { path: settingsPath(), stored: {} } });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("writes nothing when a first-run save leaves every set at its built-in", async () => {
    const effective = await save({});
    expect(effective).toEqual(defaults());
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("leaves the file untouched when a save changes nothing", async () => {
    await save({ defaultWebpQuality: 71 });
    const renameSpy = vi.spyOn(fs, "rename");
    await save({});
    expect(renameSpy).not.toHaveBeenCalled();
    expect(await written()).toEqual({ defaultWebpQuality: 71 });
  });

  it("writes only the set that changes", async () => {
    const effective = await save({ defaultOutputFormat: "webp" });
    expect(await written()).toEqual({ defaultOutputFormat: "webp" });
    expect(effective).toEqual({ ...defaults(), defaultOutputFormat: "webp" });
  });

  it("reads every absent set as its built-in without rewriting the file", async () => {
    const text = `${JSON.stringify({ ...header("config"), defaultWebpQuality: 71 })}\n`;
    await fs.writeFile(settingsPath(), text);
    expect((await loadSettings(settingsPath())).settings).toEqual({ ...defaults(), defaultWebpQuality: 71 });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(text);
  });

  it("keeps unknown keys through a save of another set", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ ...header("config"), defaultWebpQuality: 71, version: 99, schemaVersion: 99, future: { kept: true } }));
    await save({ confirmDeleteTasks: false });
    expect(await written()).toEqual({ defaultWebpQuality: 71, version: 99, schemaVersion: 99, future: { kept: true }, confirmDeleteTasks: false });
  });

  it("writes only the changed role", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify(header("config")));
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
    // Flash on the fast role starts at Flash's own default, medium.
    const effective = await save({ "gemini.slug": "gemini-3.8-flash", "gemini.thinking.slug": "medium" });
    expect(await written()).toEqual({ "gemini.slug": "gemini-3.8-flash" });
    expect(effective["gemini.thinking.slug"]).toBe("medium");
    await save({ "gemini.slug": "gemini-3.8-flash", "gemini.thinking.slug": "low" });
    expect(await written()).toEqual({ "gemini.slug": "gemini-3.8-flash", "gemini.thinking.slug": "low" });
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

  it("checks the image resolution against the description model's levels, and keeps a stored one for an id with no row", async () => {
    const warn = vi.fn();
    const effective = await save({ "gemini.mediaResolution.description": "extreme" }, { warn } as unknown as AppLogger);
    expect(await written()).toEqual({});
    expect(effective["gemini.mediaResolution.description"]).toBe("high");
    expect(warn).toHaveBeenCalledOnce();

    await fs.writeFile(settingsPath(), JSON.stringify({ ...header("config"), "gemini.description": "typed-unknown", "gemini.thinking.description": null, "gemini.mediaResolution.description": "low" }));
    const loaded = await loadSettings(settingsPath(), { warn } as unknown as AppLogger);
    expect(loaded.settings["gemini.mediaResolution.description"]).toBe("low");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("checks a role's Thinking against its model's values, and keeps a stored one for an id with no row", async () => {
    const warn = vi.fn();
    const effective = await save({ "gemini.thinking.description": "minimal" }, { warn } as unknown as AppLogger);
    expect(await written()).toEqual({});
    expect(effective["gemini.thinking.description"]).toBe("medium");
    expect(warn).toHaveBeenCalledOnce();

    await fs.writeFile(settingsPath(), JSON.stringify({ ...header("config"), "gemini.description": "typed-unknown", "gemini.thinking.description": "high" }));
    const loaded = await loadSettings(settingsPath(), { warn } as unknown as AppLogger);
    expect(loaded.settings["gemini.thinking.description"]).toBe("high");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps a Thinking and image resolution saved under an id with no row through a relaunch", async () => {
    const kept = { "gemini.description": "typed-unknown", "gemini.thinking.description": "minimal", "gemini.mediaResolution.description": "low" };
    await save(kept);
    expect(await written()).toEqual(kept);
    expect((await loadSettings(settingsPath())).settings).toEqual({ ...defaults(), ...kept });
  });

  it("writes metadata whole rather than merging its members", async () => {
    await save({ injectFields: { author: "Jane", credit: "Me" } });
    await save({ injectFields: { author: "John" } });
    expect(await written()).toEqual({ injectFields: { author: "John" } });
  });

  it.skipIf(!accessDeniable)("refuses a file it cannot open as unreadable and leaves it in place", async () => {
    const text = `${JSON.stringify({ ...header("config"), defaultWebpQuality: 71 })}\n`;
    await fs.writeFile(settingsPath(), text);
    await fs.chmod(settingsPath(), 0o000);
    try {
      await expect(loadSettings(settingsPath())).rejects.toMatchObject({ name: "RefusedFileError", filePath: settingsPath(), reason: "unreadable", cause: expect.objectContaining({ code: "EACCES" }) });
      expect(await fs.readdir(dir)).toEqual(["config.json"]);
    } finally {
      await fs.chmod(settingsPath(), 0o600);
    }
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(text);
  });

  it("never writes an invalid value, keeping each previous value and reporting each issue", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ ...header("config"), defaultWebpQuality: 71, injectFields: { author: "Jane" }, theme: "dark" }));
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

  it("keeps invalid stored values through a save of another set, using their built-ins meanwhile", async () => {
    const stored = { defaultWebpQuality: 999, visionDescriptionPrompt: "", injectFields: { author: "Jane", credit: 42 }, "gemini.description": "unlisted-model" };
    await fs.writeFile(settingsPath(), JSON.stringify({ ...header("config"), ...stored }));
    const effective = await save({ confirmDeleteTasks: false });
    expect(await written()).toEqual({ ...stored, confirmDeleteTasks: false });
    expect(effective.defaultWebpQuality).toBe(defaults().defaultWebpQuality);
    expect(effective.visionDescriptionPrompt).toBe(defaults().visionDescriptionPrompt);
    expect(effective["gemini.description"]).toBe("unlisted-model");
  });

  it("replaces an invalid stored value once the user edits that set", async () => {
    await fs.writeFile(settingsPath(), JSON.stringify({ ...header("config"), defaultWebpQuality: 999, visionDescriptionPrompt: "" }));
    await save({ defaultWebpQuality: 71 });
    expect(await written()).toEqual({ defaultWebpQuality: 71, visionDescriptionPrompt: "" });
    await save({ visionDescriptionPrompt: defaults().visionDescriptionPrompt });
    expect(await written()).toEqual({ defaultWebpQuality: 71, visionDescriptionPrompt: "" });
    await save({ visionDescriptionPrompt: "Describe it." });
    expect(await written()).toEqual({ defaultWebpQuality: 71, visionDescriptionPrompt: "Describe it." });
  });

  it("writes from the settings it holds, not from the file as it now is", async () => {
    const { settings: previous, file } = await loadSettings(settingsPath());
    await fs.writeFile(settingsPath(), JSON.stringify({ ...header("config"), defaultWebpQuality: 71 }));
    await saveSettings(file, { ...previous, confirmDeleteTasks: false }, previous);
    expect(await written()).toEqual({ confirmDeleteTasks: false });
  });

  it("removes a set's key when it is saved back to its built-in, and keeps a file with no set when no key remains", async () => {
    await save({ defaultWebpQuality: 71, confirmDeleteTasks: false });
    await save({ defaultWebpQuality: defaults().defaultWebpQuality });
    expect(await written()).toEqual({ confirmDeleteTasks: false });
    const effective = await save({ confirmDeleteTasks: true });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(`${JSON.stringify(header("config"), null, 2)}\n`);
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
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("stores a differing set in its cleaned form", async () => {
    await save({ visionSlugPrompt: "  Line one  \r\n\r\n  Line two  \n", "gemini.slug": " typed-model ", "gemini.thinking.slug": null, uiFontFamily: " Inter\n Display " });
    expect(await written()).toEqual({ visionSlugPrompt: "  Line one\n\n  Line two", "gemini.slug": "typed-model", uiFontFamily: "Inter Display" });
  });

  it("keeps a stored copy equal to its built-in through a save of another set", async () => {
    const stored = { visionSlugPrompt: `${defaults().visionSlugPrompt}  `, "gemini.slug": defaults()["gemini.slug"].toUpperCase(), defaultWebpQuality: 71 };
    await fs.writeFile(settingsPath(), JSON.stringify({ ...header("config"), ...stored }));
    await save({ confirmDeleteTasks: false });
    expect(await written()).toEqual({ ...stored, confirmDeleteTasks: false });
  });

  it("treats an empty metadata member as absent, since it injects nothing", async () => {
    await save({ injectFields: { author: "  ", credit: "" } });
    expect(await written()).toEqual({});
    await save({ injectFields: { author: "Jane", credit: " " } });
    expect(await written()).toEqual({ injectFields: { author: "Jane" } });
  });

  it("logs a bad set and reads only that set as absent without quarantining or rewriting", async () => {
    const original = `${JSON.stringify({ ...header("config"), defaultWebpQuality: 999, confirmDeleteTasks: false })}\n`;
    await fs.writeFile(settingsPath(), original);
    const warn = vi.fn();
    const result = await loadSettings(settingsPath(), { warn } as unknown as AppLogger);
    expect(result.settings).toEqual({ ...defaults(), confirmDeleteTasks: false });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[1].issue).toContain("settings.defaultWebpQuality");
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(original);
    expect(await fs.readdir(dir)).toEqual(["config.json"]);
  });

  it.each(["{ not valid json", "[]"])("refuses unreadable bytes without moving or replacing them: %s", async (corrupt) => {
    await fs.writeFile(settingsPath(), corrupt);
    await expect(loadSettings(settingsPath())).rejects.toMatchObject({ name: "RefusedFileError", reason: "unreadable" });
    expect(await fs.readFile(settingsPath(), "utf8")).toBe(corrupt);
    expect(await fs.readdir(dir)).toEqual(["config.json"]);
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
