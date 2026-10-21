import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStorageRoot } from "@main/storage-root";
import { DATA_DIR_NAME } from "@shared/constants";
import { asPlatform } from "../helpers/platform";

const ENV_VAR = "FOTOREADY_DATA_DIR";

describe("resolveStorageRoot (FOTOREADY_DATA_DIR)", () => {
  let tmpBase: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-root-"));
    tmpHome = path.join(tmpBase, "home");
    fs.mkdirSync(tmpHome);
    // Default, tilde, and relative roots still use the real resolver, but its
    // home-directory input must never point at the developer's app stores.
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    vi.stubEnv(ENV_VAR, undefined);
    vi.stubEnv("FOTOREADY_ROOT_TEST_UNSET", undefined);
    vi.stubEnv("FOTOREADY_ROOT_TEST_EMPTY", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it("defaults to <homedir>/.fotoready when the override is unset", () => {
    const root = resolveStorageRoot(DATA_DIR_NAME, ["logs"]);
    expect(root).toBe(path.join(tmpHome, DATA_DIR_NAME));
  });

  it("treats an empty or whitespace override as unset (uses the default)", () => {
    process.env[ENV_VAR] = "   ";
    const root = resolveStorageRoot(DATA_DIR_NAME, []);
    expect(root).toBe(path.join(tmpHome, DATA_DIR_NAME));
  });

  it("relocates the whole root to an absolute override and creates standard subdirs", () => {
    const target = path.join(tmpBase, "relocated");
    process.env[ENV_VAR] = target;
    const root = resolveStorageRoot(DATA_DIR_NAME, ["logs"]);
    expect(root).toBe(path.resolve(target));
    expect(fs.statSync(root).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(root, "logs")).isDirectory()).toBe(true);
  });

  it.each(["$FOTOREADY_ROOT_TEST_SET", "${FOTOREADY_ROOT_TEST_SET}", "%FOTOREADY_ROOT_TEST_SET%"])(
    "expands %s inside an absolute authored override before creating the root",
    (reference) => {
      vi.stubEnv("FOTOREADY_ROOT_TEST_SET", "expanded");
      process.env[ENV_VAR] = path.join(tmpBase, reference, "profile");
      const expected = path.join(tmpBase, "expanded", "profile");
      expect(resolveStorageRoot(DATA_DIR_NAME, ["logs"])).toBe(expected);
      expect(fs.statSync(path.join(expected, "logs")).isDirectory()).toBe(true);
      expect(fs.existsSync(path.join(tmpBase, reference))).toBe(false);
    }
  );

  it("rejects an unset variable inside an absolute authored override", () => {
    process.env[ENV_VAR] = path.join(tmpBase, "$FOTOREADY_ROOT_TEST_UNSET", "profile");
    expect(() => resolveStorageRoot(DATA_DIR_NAME)).toThrow(/FOTOREADY_ROOT_TEST_UNSET/);
    expect(fs.existsSync(path.join(tmpBase, "$FOTOREADY_ROOT_TEST_UNSET"))).toBe(false);
  });

  it("expands a leading ~ in the override against the home directory", () => {
    process.env[ENV_VAR] = "~/.fotoready-test-home-expand";
    const root = resolveStorageRoot(DATA_DIR_NAME, []);
    expect(root).toBe(path.join(tmpHome, ".fotoready-test-home-expand"));
  });

  it("resolves a relative override against HOME, never the working directory", () => {
    process.env[ENV_VAR] = "relative-fotoready-root-xyz";
    const root = resolveStorageRoot(DATA_DIR_NAME, []);
    expect(root).toBe(path.resolve(tmpHome, "relative-fotoready-root-xyz"));
    expect(root).not.toBe(path.resolve(process.cwd(), "relative-fotoready-root-xyz"));
  });

  it("throws a clear startup error when the override cannot be used (path is a file)", () => {
    const filePath = path.join(tmpBase, "not-a-dir");
    fs.writeFileSync(filePath, "x");
    process.env[ENV_VAR] = filePath;
    expect(() => resolveStorageRoot(DATA_DIR_NAME, [])).toThrow(/FOTOREADY_DATA_DIR/);
  });

  it("hard-errors on a reference to an unset $VAR, naming the variable (never a literal $VAR directory)", () => {
    process.env[ENV_VAR] = "$FOTOREADY_ROOT_TEST_UNSET";
    // A literal `$VAR` path segment would be a silent misconfiguration — the
    // app would create a directory literally named "$FOTOREADY_ROOT_TEST_UNSET",
    // so it is a reported startup error instead.
    expect(() => resolveStorageRoot(DATA_DIR_NAME, [])).toThrow(/FOTOREADY_DATA_DIR/);
    expect(() => resolveStorageRoot(DATA_DIR_NAME, [])).toThrow(/FOTOREADY_ROOT_TEST_UNSET/);
    expect(() => resolveStorageRoot(DATA_DIR_NAME, [])).toThrow(/not set/);
    // And no literal-$VAR directory was materialized under HOME.
    expect(fs.existsSync(path.join(tmpHome, "$FOTOREADY_ROOT_TEST_UNSET"))).toBe(false);
  });

  it("hard-errors on a reference to a $VAR set to the empty string, naming it, never collapsing onto bare HOME", () => {
    process.env[ENV_VAR] = "$FOTOREADY_ROOT_TEST_EMPTY";
    // Must throw rather than silently resolving to path.resolve(homeDir, "") === homeDir.
    expect(() => resolveStorageRoot(DATA_DIR_NAME, [])).toThrow(/FOTOREADY_DATA_DIR/);
    expect(() => resolveStorageRoot(DATA_DIR_NAME, [])).toThrow(/FOTOREADY_ROOT_TEST_EMPTY/);
    expect(() => resolveStorageRoot(DATA_DIR_NAME, [])).toThrow(/is empty/);
  });

  it.skipIf(process.platform === "win32")("creates a fresh root as owner-only (0700)", () => {
    const target = path.join(tmpBase, "fresh-root");
    process.env[ENV_VAR] = target;
    const root = resolveStorageRoot(DATA_DIR_NAME, []);
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === "win32")(
    "tightens an existing broader root (0755) to 0700 at launch",
    () => {
      const target = path.join(tmpBase, "existing-root");
      fs.mkdirSync(target, { mode: 0o755 });
      expect(fs.statSync(target).mode & 0o777).toBe(0o755);
      process.env[ENV_VAR] = target;
      const root = resolveStorageRoot(DATA_DIR_NAME, []);
      expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    }
  );

  it.skipIf(process.platform === "win32")("leaves an existing root's permissions to Windows' own model there", async () => {
    const target = path.join(tmpBase, "windows-root");
    fs.mkdirSync(target, { mode: 0o755 });
    process.env[ENV_VAR] = target;
    const root = await asPlatform("win32", () => resolveStorageRoot(DATA_DIR_NAME, []));
    expect(fs.statSync(root).mode & 0o777).toBe(0o755);
  });
});
