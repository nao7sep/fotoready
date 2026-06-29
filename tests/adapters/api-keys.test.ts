import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyStore, apiKeyEnvVar } from "@adapters/api-keys";
import type { Logger } from "@shared/types/log";

const GEMINI_ENV = apiKeyEnvVar(["gemini"]); // "GEMINI_API_KEY"
const isPosix = process.platform !== "win32";

describe("ApiKeyStore", () => {
  let tmpDir: string;
  let filePath: string;

  function clearGeminiEnv(): void {
    for (const name of Object.keys(process.env)) {
      if (/^GEMINI.*_API_KEY$/.test(name)) delete process.env[name];
    }
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-keys-"));
    filePath = path.join(tmpDir, "api-keys.json");
    clearGeminiEnv();
  });

  afterEach(() => {
    clearGeminiEnv();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("derives the conventional environment variable from the segments", () => {
    expect(GEMINI_ENV).toBe("GEMINI_API_KEY");
  });

  it("resolves the environment value first, over any stored value, and trims it", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set(["gemini"], "stored-key");
    process.env[GEMINI_ENV] = "  env-key  ";

    expect(await store.resolve(["gemini"])).toBe("env-key");
    expect(await store.has(["gemini"])).toBe(true);
  });

  it("falls back to the stored value when the environment variable is unset/blank", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set(["gemini"], "stored-key");

    process.env[GEMINI_ENV] = "   ";
    expect(await store.resolve(["gemini"])).toBe("stored-key");
  });

  it("reports a key present via the environment even with no stored file", async () => {
    const store = new ApiKeyStore(filePath);
    process.env[GEMINI_ENV] = "env-only-key";
    expect(await store.has(["gemini"])).toBe(true);
    expect(await store.resolve(["gemini"])).toBe("env-only-key");
    // No file is written just because the env var was read.
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("stores the key under its segment id inside a keys container, obfuscated", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set(["gemini"], "sk-plaintext-secret");
    const onDisk = fs.readFileSync(filePath, "utf8");
    expect(onDisk).not.toContain("sk-plaintext-secret");
    expect(JSON.parse(onDisk)).toHaveProperty(["keys", "gemini"]);
    expect(await store.resolve(["gemini"])).toBe("sk-plaintext-secret");
  });

  it("clears the stored key while leaving any env key in effect", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set(["gemini"], "stored-key");
    await store.clear(["gemini"]);
    expect(await store.has(["gemini"])).toBe(false);

    process.env[GEMINI_ENV] = "env-key";
    expect(await store.resolve(["gemini"])).toBe("env-key");
  });

  it("treats an untagged stored value as plaintext and matches ids case-insensitively", async () => {
    fs.writeFileSync(filePath, `${JSON.stringify({ keys: { Gemini: "  sk-plain-pasted  " } })}\n`);
    const store = new ApiKeyStore(filePath);
    expect(await store.resolve(["gemini"])).toBe("sk-plain-pasted");
  });

  it("resolves source-first with most-to-least-specific fallback", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set(["gemini"], "general-stored");
    await store.set(["gemini", "vision"], "vision-stored");

    // A more specific stored key beats the general stored key.
    expect(await store.resolve(["gemini", "vision"])).toBe("vision-stored");
    // An unconfigured specific key falls back to the general stored key.
    expect(await store.resolve(["gemini", "other"])).toBe("general-stored");

    // Source-first: a general env beats even a more specific stored key.
    process.env[GEMINI_ENV] = "general-env";
    expect(await store.resolve(["gemini", "vision"])).toBe("general-env");
    delete process.env[GEMINI_ENV];

    // fallback:false consults only the exact key.
    expect(await store.resolve(["gemini", "missing"], { fallback: false })).toBeNull();
    expect(await store.resolve(["gemini", "vision"], { fallback: false })).toBe("vision-stored");
  });

  it("moves a corrupt key file aside and resolves to no key instead of throwing", async () => {
    fs.writeFileSync(filePath, "not json at all");
    const store = new ApiKeyStore(filePath);

    await expect(store.resolve(["gemini"])).resolves.toBeNull();
    const entries = fs.readdirSync(tmpDir);
    expect(entries.some((e) => e.startsWith("api-keys.json.") && e.endsWith(".invalid"))).toBe(true);
    expect(entries).not.toContain("api-keys.json");
  });

  it.runIf(isPosix)("writes the secrets file with 0600 permissions on POSIX", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set(["gemini"], "stored-key");
    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it.runIf(isPosix)("warns and tightens a group/world-readable secrets file back to 0600 on read", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, `${JSON.stringify({ keys: {} })}\n`);
    fs.chmodSync(filePath, 0o644);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);

    const store = new ApiKeyStore(filePath, logger);
    await store.resolve(["gemini"]);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/readable beyond the owner/i),
      expect.objectContaining({ mode: "644" }),
    );
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it.runIf(isPosix)("does not warn for an already-0600 secrets file", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, `${JSON.stringify({ keys: {} })}\n`, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);

    const store = new ApiKeyStore(filePath, logger);
    await store.resolve(["gemini"]);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });
});
