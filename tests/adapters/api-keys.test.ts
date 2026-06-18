import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyStore } from "@adapters/api-keys";
import type { Logger } from "@shared/types/log";

const GEMINI_ENV = "GEMINI_API_KEY";
const isPosix = process.platform !== "win32";

describe("ApiKeyStore", () => {
  let tmpDir: string;
  let filePath: string;
  const originalEnv = process.env[GEMINI_ENV];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-keys-"));
    filePath = path.join(tmpDir, "api-keys.json");
    delete process.env[GEMINI_ENV];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[GEMINI_ENV];
    else process.env[GEMINI_ENV] = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves the environment value first, over any stored value", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "stored-key");
    process.env[GEMINI_ENV] = "env-key";

    expect(await store.get("gemini")).toBe("env-key");
    expect(await store.has("gemini")).toBe(true);
  });

  it("falls back to the stored value when the environment variable is unset/blank", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "stored-key");

    process.env[GEMINI_ENV] = "   ";
    expect(await store.get("gemini")).toBe("stored-key");
  });

  it("reports a key present via the environment even with no stored file", async () => {
    const store = new ApiKeyStore(filePath);
    process.env[GEMINI_ENV] = "env-only-key";
    expect(await store.has("gemini")).toBe(true);
    expect(await store.get("gemini")).toBe("env-only-key");
    // No file is written just because the env var was read.
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it.runIf(isPosix)("writes the secrets file with 0600 permissions on POSIX", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "stored-key");
    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it.runIf(isPosix)("warns and tightens a group/world-readable secrets file back to 0600 on read", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    // Write a valid keys file, then deliberately loosen it to 0644.
    fs.writeFileSync(filePath, `${JSON.stringify({})}\n`);
    fs.chmodSync(filePath, 0o644);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);

    const store = new ApiKeyStore(filePath, logger);
    // Any read path triggers the insecure-mode check.
    await store.get("gemini");

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/readable beyond the owner/i),
      expect.objectContaining({ mode: "644" })
    );
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it.runIf(isPosix)("does not warn for an already-0600 secrets file", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, `${JSON.stringify({})}\n`, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);

    const store = new ApiKeyStore(filePath, logger);
    await store.get("gemini");

    expect(logger.warn).not.toHaveBeenCalled();
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });
});
