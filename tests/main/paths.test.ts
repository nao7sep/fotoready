import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The resolver imports os's default object while the catalogs import the
// named homedir function; both must see the same disposable home.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const homedir = vi.fn<() => string>();
  return { ...actual, homedir, default: { ...actual, homedir } };
});

// paths.ts statically imports `app` from electron, which is not available under
// the vitest node environment, so stub it to a minimal non-packaged app.
vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { getAppPaths } from "@main/paths";
import { resolveLutDir } from "@main/lut-catalog";
import { resolveStampDir } from "@main/stamp-catalog";

const ENV_VAR = "FOTOREADY_DATA_DIR";

let tmpBase: string;
let tmpHome: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-paths-"));
  tmpHome = path.join(tmpBase, "home");
  fs.mkdirSync(tmpHome);
  // getAppPaths creates and tightens the default root too, so isolate every
  // path case rather than only cases that supply the relocation override.
  vi.mocked(os.homedir).mockReturnValue(tmpHome);
  vi.stubEnv(ENV_VAR, undefined);
});

afterEach(() => {
  vi.mocked(os.homedir).mockReset();
  vi.unstubAllEnvs();
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe("getAppPaths luts/stamps relocate with FOTOREADY_DATA_DIR", () => {
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
    const defaultRoot = path.join(tmpHome, ".fotoready");
    expect(paths.lutsDir).toBe(path.join(defaultRoot, "luts"));
    expect(paths.stampsDir).toBe(path.join(defaultRoot, "stamps"));
  });
});

describe("getAppPaths storage filenames", () => {
  it("resolves the durable settings to config.json under the storage root", () => {
    const target = path.join(tmpBase, "relocated");
    process.env[ENV_VAR] = target;
    const paths = getAppPaths();
    expect(paths.settingsPath).toBe(path.join(path.resolve(target), "config.json"));
    expect(path.basename(paths.settingsPath)).toBe("config.json");
  });

  it("keeps settings, state, and api-keys as three distinct files", () => {
    const target = path.join(tmpBase, "relocated");
    process.env[ENV_VAR] = target;
    const paths = getAppPaths();
    expect(path.basename(paths.settingsPath)).toBe("config.json");
    expect(path.basename(paths.statePath)).toBe("state.json");
    expect(path.basename(paths.apiKeysPath)).toBe("api-keys.json");
    const names = [paths.settingsPath, paths.statePath, paths.apiKeysPath];
    expect(new Set(names).size).toBe(3);
    expect(paths.settingsPath).not.toBe(paths.statePath);
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
    expect(resolveLutDir("~/x", defaultLutDir)).toBe(path.join(tmpHome, "x"));
    expect(resolveStampDir("~/x", defaultStampDir)).toBe(path.join(tmpHome, "x"));
  });

  it("returns an absolute custom folder unchanged", () => {
    const abs = path.join("/var", "custom-luts");
    expect(resolveLutDir(abs, defaultLutDir)).toBe(abs);
    expect(resolveStampDir(path.join("/var", "custom-stamps"), defaultStampDir)).toBe(path.join("/var", "custom-stamps"));
  });
});
