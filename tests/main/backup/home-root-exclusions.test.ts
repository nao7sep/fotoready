// The home-root exclude list: the user's durable work-product (config.json and other managed data) is
// kept; backups/, logs/, the imported luts/ and stamps/ instrument trees, the volatile state.json, the
// api-keys.json secret, atomic-write temporaries, .invalid quarantine copies, and OS metadata droppings
// are dropped.

import { describe, it, expect } from "vitest";
import { isExcludedFile, isExcludedDir } from "@main/backup/home-root-exclusions";

describe("isExcludedFile", () => {
  it.each(["config.json", "notes/durable.json"])("includes %s", (relativePath) => {
    expect(isExcludedFile(relativePath)).toBe(false);
  });

  it.each([
    "state.json",
    "api-keys.json", // a secret — not backed up
    "luts/warm.cube", // imported instrument, not work-product
    "stamps/logo.png", // imported instrument, not work-product
    "stamps/sub/mark.png",
    "logs/20260701-000000-utc.log",
    "backups/index.json",
    "backups/backup-20260701-000000-utc.zip",
    "config.json.tmp.123.abc.tmp",
    "config.json.20260701-000000-utc.invalid", // quarantine copy
    "state.20260701-000000-utc.INVALID", // matched case-insensitively
    ".DS_Store",
    "luts/.DS_Store",
    "stamps/Thumbs.db",
    "desktop.ini",
    "Desktop.ini", // OS-noise floor, matched case-insensitively
  ])("excludes %s", (relativePath) => {
    expect(isExcludedFile(relativePath)).toBe(true);
  });
});

describe("isExcludedDir", () => {
  it("prunes the top-level backups, logs, luts and stamps directories", () => {
    expect(isExcludedDir("backups")).toBe(true);
    expect(isExcludedDir("logs")).toBe(true);
    expect(isExcludedDir("luts")).toBe(true);
    expect(isExcludedDir("stamps")).toBe(true);
  });
});
