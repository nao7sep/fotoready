// The home-root exclude list: durable data (config.json, the api-keys.json secret, and the imported
// luts/ and stamps/ trees) is kept; backups/, logs/, the volatile state.json, atomic-write temporaries,
// and OS metadata droppings are dropped.

import { describe, it, expect } from "vitest";
import { isExcludedFile, isExcludedDir } from "@main/backup/home-root-exclusions";

describe("isExcludedFile", () => {
  it.each(["config.json", "api-keys.json", "luts/warm.cube", "stamps/logo.png", "stamps/sub/mark.png"])(
    "includes %s",
    (relativePath) => {
      expect(isExcludedFile(relativePath)).toBe(false);
    },
  );

  it.each([
    "state.json",
    "logs/20260701-000000-utc.log",
    "backups/index.json",
    "backups/backup-20260701-000000-utc.zip",
    "config.json.tmp.123.abc.tmp",
    ".DS_Store",
    "luts/.DS_Store",
    "stamps/Thumbs.db",
  ])("excludes %s", (relativePath) => {
    expect(isExcludedFile(relativePath)).toBe(true);
  });
});

describe("isExcludedDir", () => {
  it("prunes the top-level backups and logs directories", () => {
    expect(isExcludedDir("backups")).toBe(true);
    expect(isExcludedDir("logs")).toBe(true);
  });

  it("does not prune the managed luts and stamps directories", () => {
    expect(isExcludedDir("luts")).toBe(false);
    expect(isExcludedDir("stamps")).toBe(false);
  });
});
