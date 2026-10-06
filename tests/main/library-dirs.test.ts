import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));

import { PathVariableError } from "@main/configured-path";
import { resolveLutDir } from "@main/lut-catalog";
import { resolveStampDir } from "@main/stamp-catalog";

// The imported LUT and stamp folders resolve against the home directory, after `~` and
// environment references are expanded.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ["LUT", resolveLutDir],
  ["stamp", resolveStampDir]
])("the imported %s folder", (_name, resolve) => {
  const fallback = path.resolve("/fotoready-default-library");

  it("uses the default folder when none is set", () => {
    expect(resolve("  ", fallback)).toBe(fallback);
  });

  it("resolves a relative folder against the home directory", () => {
    expect(resolve("library", fallback)).toBe(path.resolve(homedir(), "library"));
  });

  it("expands ${VAR} and %VAR% before resolving", () => {
    vi.stubEnv("FOTOREADY_LIBRARY_TEST", "assets");
    expect(resolve("${FOTOREADY_LIBRARY_TEST}/library", fallback)).toBe(path.resolve(homedir(), "assets", "library"));
    expect(resolve("%FOTOREADY_LIBRARY_TEST%\\library", fallback)).toBe(path.resolve(homedir(), "assets\\library"));
  });

  it("fails on an unset variable rather than keeping it as typed", () => {
    vi.stubEnv("FOTOREADY_LIBRARY_TEST_UNSET", undefined);
    expect(() => resolve("$FOTOREADY_LIBRARY_TEST_UNSET/library", fallback)).toThrow(PathVariableError);
  });
});
