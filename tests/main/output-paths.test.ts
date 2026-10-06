import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PathVariableError } from "@main/configured-path";
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
    expect(resolved).not.toBe(path.resolve(process.cwd(), "out/web"));
  });

  describe("with ~ and environment references", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    });

    it("expands ~ against the home directory instead of nesting it under the source folder", () => {
      vi.spyOn(os, "homedir").mockReturnValue("/fotoready-test-home");
      expect(resolveProjectOutputDir("~/Pictures", source)).toBe(path.join("/fotoready-test-home", "Pictures"));
    });

    it("expands a variable, keeping the source folder as the base of a relative result", () => {
      vi.stubEnv("FOTOREADY_OUTPUT_TEST", "exports");
      expect(resolveProjectOutputDir("$FOTOREADY_OUTPUT_TEST/web", source)).toBe(path.resolve(path.dirname(source), "exports", "web"));
    });

    it("fails on an unset variable rather than creating a folder named after it", () => {
      vi.stubEnv("FOTOREADY_OUTPUT_TEST_UNSET", undefined);
      expect(() => resolveProjectOutputDir("%FOTOREADY_OUTPUT_TEST_UNSET%/web", source)).toThrow(PathVariableError);
    });
  });
});
