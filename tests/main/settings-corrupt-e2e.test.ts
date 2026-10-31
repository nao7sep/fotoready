import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../../src/main/settings-io";
import { header } from "../helpers/file-header";

// End-to-end on a REAL corrupt file: settings are valuable content, so an unreadable file stops
// startup and stays byte-identical, with nothing set aside (store-recovery-conventions).
describe("a corrupt settings file on disk", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fotoready-corrupt-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is refused as unreadable and left exactly as it is", async () => {
    const path = join(dir, "config.json");
    const corrupt = "{ not json at all";
    writeFileSync(path, corrupt);

    await expect(loadSettings(path)).rejects.toMatchObject({ name: "RefusedFileError", filePath: path, reason: "unreadable" });

    expect(readFileSync(path, "utf8")).toBe(corrupt);
    expect(readdirSync(dir)).toEqual(["config.json"]);
  });

  it("loads a sound file and leaves it untouched", async () => {
    const path = join(dir, "config.json");
    const before = JSON.stringify({ ...header("config"), defaultWebpQuality: 71 }, null, 2) + "\n";
    writeFileSync(path, before);
    const { settings } = await loadSettings(path);
    expect(settings.defaultWebpQuality).toBe(71);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readdirSync(dir)).toEqual(["config.json"]);
  });
});
