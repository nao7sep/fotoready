import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "@main/settings-io";
import { defaultGlobalSettings } from "@shared/defaults";
import { normalizeGlobalSettings } from "@shared/validation/settings";

// Real filesystem (a temp dir) so loadSettings' read → parse → validate → (materialize?) path is
// exercised end to end. Unlike volatile state.json, config.json IS materialized on first run
// (storage-path conventions: built-in defaultable files exist on disk after first launch).

let dir: string;
const settingsPath = () => path.join(dir, "config.json");
const defaults = () => defaultGlobalSettings(null);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-settings-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function findInvalid(): Promise<string | undefined> {
  const files = await fs.readdir(dir);
  return files.find((f) => f.startsWith("config-") && f.endsWith(".invalid"));
}

describe("loadSettings", () => {
  it("materializes config.json from defaults on first run (write-if-absent)", async () => {
    const settings = await loadSettings(settingsPath());

    // Behavior (a)/(b): the missing file is the first-run case; config.json IS written with the
    // in-code defaults (config.json, unlike state.json, is materialized on first run).
    expect(settings).toEqual(defaults());
    const written = await fs.readFile(settingsPath(), "utf8");
    expect(JSON.parse(written)).toEqual(defaults());
    // Serialized through the app's own save path (the same normalize-then-serialize as saveSettings):
    // pretty-printed with a trailing newline, so first-run materialization matches a normal save.
    const normalizedDefaults = normalizeGlobalSettings(defaults(), defaults()).settings;
    expect(written).toBe(`${JSON.stringify(normalizedDefaults, null, 2)}\n`);
    // Only config.json is created — no .invalid quarantine when the file was simply absent.
    expect(await findInvalid()).toBeUndefined();
  });

  it("reads back settings once they have actually been written", async () => {
    const custom = { ...defaults(), defaultWebpQuality: 71, confirmDeleteTasks: true };
    await saveSettings(settingsPath(), custom);

    expect(await loadSettings(settingsPath())).toEqual(custom);
  });

  it("quarantines an unreadable (unparseable) config.json, then resets it to defaults in place", async () => {
    const corrupt = "{ not valid json";
    await fs.writeFile(settingsPath(), corrupt, "utf8");

    const settings = await loadSettings(settingsPath());

    // Behavior (b): present-but-unreadable → the original bytes are quarantined aside and config.json
    // is rewritten with defaults so the next launch is clean (never silently discarded).
    expect(settings).toEqual(defaults());

    const invalid = await findInvalid();
    expect(invalid).toBeDefined();
    // The quarantined original is byte-for-byte the corrupt bytes we wrote.
    expect(await fs.readFile(path.join(dir, invalid!), "utf8")).toBe(corrupt);

    // config.json is reset to defaults on disk (not left corrupt).
    expect(JSON.parse(await fs.readFile(settingsPath(), "utf8"))).toEqual(defaults());
  });

  it("byte-preserves the original when it parses but fails validation, then rewrites the coerced config", async () => {
    // Behavior (c): the file is valid JSON but a field is out of range, so normalization coerces it
    // and records issues. The original (with its hand-authored formatting) must be preserved verbatim
    // in the .invalid quarantine, and config.json rewritten with the coerced result.
    const originalText = [
      "{",
      "  \"defaultWebpQuality\": 999,",
      "  \"confirmDeleteTasks\": true",
      "}",
      ""
    ].join("\n");
    await fs.writeFile(settingsPath(), originalText, "utf8");

    const settings = await loadSettings(settingsPath());

    // The coerced result: the out-of-range field falls back to the default, the valid field is kept.
    const { settings: expected, issues } = normalizeGlobalSettings(JSON.parse(originalText), defaults());
    expect(issues.length).toBeGreaterThan(0); // guards the test's premise: this input really is invalid.
    expect(settings).toEqual(expected);
    expect(settings.defaultWebpQuality).toBe(defaults().defaultWebpQuality);
    expect(settings.confirmDeleteTasks).toBe(true);

    // The quarantined original is byte-identical to what we wrote — including its exact whitespace,
    // so a user could recover their hand-edited file verbatim.
    const invalid = await findInvalid();
    expect(invalid).toBeDefined();
    expect(await fs.readFile(path.join(dir, invalid!), "utf8")).toBe(originalText);

    // config.json is rewritten with the coerced (now-valid) settings.
    expect(JSON.parse(await fs.readFile(settingsPath(), "utf8"))).toEqual(expected);
  });
});
