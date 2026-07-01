// The mirror-layout mapping: every home-root file keeps its relative path (fotoready has no external
// managed roots, so the mapping is a straight forward-slash normalization).

import { describe, it, expect } from "vitest";
import { forHomeFile, normalize } from "@main/backup/archive-paths";

describe("archivePaths", () => {
  it("keeps a home file at its relative path", () => {
    expect(forHomeFile("config.json")).toBe("config.json");
    expect(forHomeFile("luts/warm.cube")).toBe("luts/warm.cube");
    expect(forHomeFile("stamps/logo.png")).toBe("stamps/logo.png");
  });

  it("normalizes backslashes and a leading slash", () => {
    expect(normalize("a\\b\\c.txt")).toBe("a/b/c.txt");
    expect(normalize("/config.json")).toBe("config.json");
    expect(forHomeFile("luts\\sub\\cool.cube")).toBe("luts/sub/cool.cube");
  });
});
