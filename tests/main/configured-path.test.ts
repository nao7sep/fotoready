import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathVariableError, pathVariableReason, resolveConfiguredPath } from "@main/configured-path";

const home = path.resolve("/fotoready-test-home");
const base = path.resolve("/fotoready-test-base");

beforeEach(() => {
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("FOTOREADY_PATH_TEST_SET", "photos");
  vi.stubEnv("FOTOREADY_PATH_TEST_UNSET", undefined);
  vi.stubEnv("FOTOREADY_PATH_TEST_EMPTY", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("resolveConfiguredPath", () => {
  it("expands a leading ~ against the home directory", () => {
    expect(resolveConfiguredPath("~", base)).toBe(home);
    expect(resolveConfiguredPath("~/Pictures", base)).toBe(path.join(home, "Pictures"));
    expect(resolveConfiguredPath("~\\Pictures", base)).toBe(path.join(home, "Pictures"));
  });

  it.each(["$FOTOREADY_PATH_TEST_SET", "${FOTOREADY_PATH_TEST_SET}", "%FOTOREADY_PATH_TEST_SET%"])(
    "expands %s, then resolves the relative result against the base",
    (reference) => {
      expect(resolveConfiguredPath(`${reference}/out`, base)).toBe(path.resolve(base, "photos", "out"));
    }
  );

  it("resolves a relative path against the base, never the working directory", () => {
    expect(resolveConfiguredPath("out/web", base)).toBe(path.resolve(base, "out/web"));
  });

  it("returns an absolute path as given", () => {
    const absolute = path.resolve("/exports/web");
    expect(resolveConfiguredPath(absolute, base)).toBe(absolute);
  });

  it.each(["$HOME", "${HOME}", "%HOME%", "$FOTOREADY_PATH_TEST_UNSET", "100%FOTOREADY_PATH_TEST_UNSET%"])(
    "keeps a picked folder named %s literal, whether its variable is set or not",
    (name) => {
      const picked = path.resolve("/exports", name, "web");
      expect(resolveConfiguredPath(picked, base)).toBe(picked);
    }
  );

  it.each(["$FOTOREADY_PATH_TEST_UNSET", "${FOTOREADY_PATH_TEST_UNSET}", "%FOTOREADY_PATH_TEST_UNSET%"])(
    "fails on %s, naming the unset variable, rather than keeping it as typed",
    (reference) => {
      const failure = captureFailure(() => resolveConfiguredPath(`~/${reference}/luts`, base));
      expect(failure).toBeInstanceOf(PathVariableError);
      expect(failure.variable).toBe("FOTOREADY_PATH_TEST_UNSET");
      expect(pathVariableReason(failure)).toEqual({ key: "failure.pathVariable", values: { variable: "FOTOREADY_PATH_TEST_UNSET" } });
    }
  );

  it("fails on a variable set to the empty string", () => {
    const failure = captureFailure(() => resolveConfiguredPath("$FOTOREADY_PATH_TEST_EMPTY/out", base));
    expect(failure.variable).toBe("FOTOREADY_PATH_TEST_EMPTY");
  });
});

function captureFailure(run: () => unknown): PathVariableError {
  try {
    run();
  } catch (error) {
    if (error instanceof PathVariableError) return error;
    throw error;
  }
  throw new Error("expected a PathVariableError");
}
