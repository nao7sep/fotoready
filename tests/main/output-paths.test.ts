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

  it("resolves a relative output dir against the SOURCE directory, never the cwd", () => {
    // The storage-path conventions forbid resolving a GUI path against
    // process.cwd() (which is `/` for a double-clicked macOS build). A relative
    // output dir must resolve against an explicit base — here the source image's
    // own directory — not the launch working directory.
    const resolved = resolveProjectOutputDir("out/web", source);
    expect(resolved).toBe(path.resolve(path.dirname(source), "out/web"));
    expect(resolved).toBe("/photos/trip/out/web");
    expect(resolved).not.toBe(path.resolve(process.cwd(), "out/web"));
  });
});
