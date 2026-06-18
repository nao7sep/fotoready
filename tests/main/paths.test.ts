import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// paths.ts statically imports `app` from electron, which is not available under
// the vitest node environment, so stub it to a minimal non-packaged app.
vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { getAppPaths } from "@main/paths";
import { resolveLutDir } from "@main/lut-catalog";
import { resolveStampDir } from "@main/stamp-catalog";

const ENV_VAR = "FOTOREADY_HOME";

describe("getAppPaths luts/stamps relocate with FOTOREADY_HOME", () => {
  let tmpBase: string;
  const original = process.env[ENV_VAR];

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-paths-"));
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = original;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it("places lutsDir/stampsDir under the override root", () => {
    const target = path.join(tmpBase, "relocated");
    process.env[ENV_VAR] = target;
    const paths = getAppPaths();
    expect(paths.dataDir).toBe(path.resolve(target));
    expect(paths.lutsDir).toBe(path.join(path.resolve(target), "luts"));
    expect(paths.stampsDir).toBe(path.join(path.resolve(target), "stamps"));
  });

  it("places lutsDir/stampsDir under the default root when the override is unset", () => {
    const paths = getAppPaths();
    const defaultRoot = path.join(os.homedir(), ".fotoready");
    expect(paths.lutsDir).toBe(path.join(defaultRoot, "luts"));
    expect(paths.stampsDir).toBe(path.join(defaultRoot, "stamps"));
  });
});

describe("resolveLutDir / resolveStampDir", () => {
  const defaultLutDir = path.join("/tmp", "fotoready-home", "luts");
  const defaultStampDir = path.join("/tmp", "fotoready-home", "stamps");

  it("returns the passed default dir for a blank folder", () => {
    expect(resolveLutDir("", defaultLutDir)).toBe(defaultLutDir);
    expect(resolveLutDir("   ", defaultLutDir)).toBe(defaultLutDir);
    expect(resolveStampDir("", defaultStampDir)).toBe(defaultStampDir);
    expect(resolveStampDir("  \t ", defaultStampDir)).toBe(defaultStampDir);
  });

  it("expands a leading ~ in a custom folder against the home directory", () => {
    expect(resolveLutDir("~/x", defaultLutDir)).toBe(path.join(os.homedir(), "x"));
    expect(resolveStampDir("~/x", defaultStampDir)).toBe(path.join(os.homedir(), "x"));
  });

  it("returns an absolute custom folder unchanged", () => {
    const abs = path.join("/var", "custom-luts");
    expect(resolveLutDir(abs, defaultLutDir)).toBe(abs);
    expect(resolveStampDir(path.join("/var", "custom-stamps"), defaultStampDir)).toBe(path.join("/var", "custom-stamps"));
  });
});
