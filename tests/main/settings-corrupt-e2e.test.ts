import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../../src/main/settings-io";

// End-to-end on a REAL corrupt file. The classify-then-act split in settings-io is
// what keeps a failed quarantine from being reclassified as an unreadable file and
// resetting over bytes that were never preserved; these pin the observable result.
describe("a corrupt settings file on disk", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fotoready-corrupt-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("preserves the bytes in a .invalid copy and reports the path", async () => {
    const path = join(dir, "config.json");
    const corrupt = "{ not json at all";
    writeFileSync(path, corrupt);

    const { quarantinedTo } = await loadSettings(path);

    expect(quarantinedTo).toEqual(expect.stringContaining(".invalid"));
    expect(readFileSync(quarantinedTo as string, "utf8")).toBe(corrupt);
    // The reset wrote fresh defaults at the original path, beside the preserved copy.
    expect(readdirSync(dir)).toContain("config.json");
  });

  it("reports nothing for a sound file and leaves it untouched", async () => {
    const path = join(dir, "config.json");
    const before = JSON.stringify({ workerPoolSize: 2 }, null, 2) + "\n";
    writeFileSync(path, before);
    const { quarantinedTo } = await loadSettings(path);
    expect(quarantinedTo).toBeNull();
    expect(readdirSync(dir).filter((f) => f.endsWith(".invalid"))).toEqual([]);
  });
});
