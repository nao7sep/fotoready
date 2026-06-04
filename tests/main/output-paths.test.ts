import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectOutputDir } from "@main/output-paths";

describe("resolveProjectOutputDir", () => {
  const source = "/photos/trip/DSC_0001.jpg";

  it("uses the source directory when no output dir is set", () => {
    expect(resolveProjectOutputDir(null, source)).toBe(path.dirname(source));
    expect(resolveProjectOutputDir("", source)).toBe(path.dirname(source));
    expect(resolveProjectOutputDir("   ", source)).toBe(path.dirname(source));
  });

  it("passes an absolute output dir through unchanged", () => {
    expect(resolveProjectOutputDir("/exports/web", source)).toBe("/exports/web");
  });

  it("resolves a relative output dir against the cwd", () => {
    expect(resolveProjectOutputDir("out/web", source)).toBe(path.resolve(process.cwd(), "out/web"));
  });
});
