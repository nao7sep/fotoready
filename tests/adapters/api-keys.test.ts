import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyStore, apiKeyEnvVar } from "@adapters/api-keys";
import type { Logger } from "@shared/types/log";

const GEMINI_ENV = apiKeyEnvVar("gemini"); // "GEMINI_API_KEY"
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

  it("derives the conventional environment variable from the id", () => {
    expect(GEMINI_ENV).toBe("GEMINI_API_KEY");
  });

  it("resolves the environment value first, over any stored value, and trims it", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "stored-key");
    process.env[GEMINI_ENV] = "  env-key  ";

    expect(await store.resolve("gemini")).toBe("env-key");
    expect(await store.has("gemini")).toBe(true);
  });

  it("falls back to the stored value when the environment variable is unset/blank", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "stored-key");

    process.env[GEMINI_ENV] = "   ";
    expect(await store.resolve("gemini")).toBe("stored-key");
  });

  it("peeks at the stored plaintext key even when the environment overrides resolution", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "  stored-key  ");
    process.env[GEMINI_ENV] = "env-key";

    expect(await store.peek("gemini")).toBe("stored-key");
    expect(await store.resolve("gemini")).toBe("env-key");
    await store.clear("gemini");
    expect(await store.peek("gemini")).toBeNull();
    expect(await store.resolve("gemini")).toBe("env-key");
  });

  it("peeks only at the exact stored id and never materializes an environment key", async () => {
    const store = new ApiKeyStore(filePath);
    process.env[GEMINI_ENV] = "env-key";
    process.env.GEMINI_VISION_API_KEY = "vision-env-key";

    expect(await store.peek("gemini")).toBeNull();
    expect(await store.peek("gemini.vision")).toBeNull();
    expect(fs.existsSync(filePath)).toBe(false);
    await store.set("gemini", "stored-key");
    expect(await store.peek("gemini.vision")).toBeNull();
    await store.set("gemini.vision", "stored-vision-key");
    expect(await store.peek("gemini.vision")).toBe("stored-vision-key");
  });

  it("peeks at raw stored plaintext and treats malformed encoded values as absent", async () => {
    fs.writeFileSync(filePath, `${JSON.stringify({ formatVersion: 1, keys: { gemini: "  pasted-key  ", "gemini.vision": "obf:invalid!!" } })}\n`);
    const store = new ApiKeyStore(filePath);
    process.env[GEMINI_ENV] = "env-key";

    expect(await store.peek("gemini")).toBe("pasted-key");
    expect(await store.peek("gemini.vision")).toBeNull();
    expect(() => store.peek("Gemini")).toThrow(/Invalid api-key id/);
  });

  it("reports a key present via the environment even with no stored file", async () => {
    const store = new ApiKeyStore(filePath);
    process.env[GEMINI_ENV] = "env-only-key";
    expect(await store.has("gemini")).toBe(true);
    expect(await store.resolve("gemini")).toBe("env-only-key");
    // No file is written just because the env var was read.
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("stores the key under its id inside a keys container, obfuscated", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "sk-plaintext-secret");
    const onDisk = fs.readFileSync(filePath, "utf8");
    expect(onDisk).not.toContain("sk-plaintext-secret");
    expect(JSON.parse(onDisk)).toHaveProperty(["keys", "gemini"]);
    expect(await store.resolve("gemini")).toBe("sk-plaintext-secret");
  });

  it("clears the stored key while leaving any env key in effect", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "stored-key");
    await store.clear("gemini");
    expect(await store.has("gemini")).toBe(false);

    process.env[GEMINI_ENV] = "env-key";
    expect(await store.resolve("gemini")).toBe("env-key");
  });

  it("treats an untagged stored value as plaintext and matches ids case-insensitively", async () => {
    fs.writeFileSync(filePath, `${JSON.stringify({ formatVersion: 1, keys: { Gemini: "  sk-plain-pasted  " } })}\n`);
    const store = new ApiKeyStore(filePath);
    expect(await store.resolve("gemini")).toBe("sk-plain-pasted");
  });

  it("resolves a provider.purpose id exactly and never falls back to the provider id", async () => {
    expect(apiKeyEnvVar("gemini.vision")).toBe("GEMINI_VISION_API_KEY");

    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "general-stored");
    expect(await store.resolve("gemini.vision")).toBeNull();

    await store.set("gemini.vision", "vision-stored");
    expect(await store.resolve("gemini.vision")).toBe("vision-stored");
    expect(await store.resolve("gemini")).toBe("general-stored");

    // An ambient provider env var is never spent on a purpose key.
    await store.clear("gemini.vision");
    process.env[GEMINI_ENV] = "general-env";
    expect(await store.resolve("gemini.vision")).toBeNull();

    // The purpose key's own env var is consulted for the exact id, ahead of its stored value.
    await store.set("gemini.vision", "vision-stored");
    process.env.GEMINI_VISION_API_KEY = "vision-env";
    expect(await store.resolve("gemini.vision")).toBe("vision-env");
  });

  it("moves a corrupt key file aside and resolves to no key instead of throwing", async () => {
    fs.writeFileSync(filePath, "not json at all");
    const store = new ApiKeyStore(filePath);

    await expect(store.resolve("gemini")).resolves.toBeNull();
    const entries = fs.readdirSync(tmpDir);
    // api-keys-<stamp>.invalid, derived-filename grammar (never a dot-append after the full filename).
    expect(entries.some((e) => e.startsWith("api-keys-") && e.endsWith(".invalid"))).toBe(true);
    expect(entries).not.toContain("api-keys.json");
  });

  it("preserves valid JSON of the wrong shape before a later save creates a fresh store", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const original = `${JSON.stringify({ gemini: "recover-me" })}\n`;
    fs.writeFileSync(filePath, original);
    const store = new ApiKeyStore(filePath, logger);

    await expect(store.resolve("gemini")).resolves.toBeNull();
    const invalidName = fs.readdirSync(tmpDir).find((entry) => entry.startsWith("api-keys-") && entry.endsWith(".invalid"));
    expect(invalidName).toBeDefined();
    expect(fs.readFileSync(path.join(tmpDir, invalidName!), "utf8")).toBe(original);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/unexpected shape/i),
      expect.objectContaining({ movedTo: path.join(tmpDir, invalidName!) }),
    );

    await store.set("gemini", "new-key");
    expect(await store.resolve("gemini")).toBe("new-key");
    expect(fs.readFileSync(path.join(tmpDir, invalidName!), "utf8")).toBe(original);
  });

  it.runIf(isPosix)("leaves wrong-shaped JSON it cannot set aside in place, refusing to store a key over it for the session", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const original = `${JSON.stringify({ formatVersion: 1, gemini: "recover-me" })}\n`;
    fs.writeFileSync(filePath, original);
    const copyFile = vi.spyOn(fsPromises, "copyFile").mockRejectedValueOnce(Object.assign(new Error("read-only folder"), { code: "EROFS" }));
    const store = new ApiKeyStore(filePath, logger);
    try {
      await expect(store.resolve("gemini")).resolves.toBeNull();
      await expect(store.set("gemini", "new-key")).rejects.toMatchObject({
        name: "StoreNotWritableError",
        reason: { key: "failure.storeLeftUnreadable", values: { path: filePath } },
      });
    } finally { copyFile.mockRestore(); }
    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
    expect(fs.readdirSync(tmpDir)).toEqual(["api-keys.json"]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/could not be set aside/), expect.objectContaining({ apiKeysPath: filePath }));
  });

  it.runIf(isPosix && process.getuid?.() !== 0)("leaves a file it cannot read in place, unmoved, refusing to store a key over it for the session", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const original = `${JSON.stringify({ formatVersion: 1, keys: { gemini: "stored-key" } })}\n`;
    fs.writeFileSync(filePath, original);
    fs.chmodSync(filePath, 0o000);
    const store = new ApiKeyStore(filePath, logger);
    try {
      await expect(store.resolve("gemini")).resolves.toBeNull();
      await expect(store.set("gemini", "new-key")).rejects.toMatchObject({
        name: "StoreNotWritableError",
        reason: { key: "failure.storeLeftUnreadable", values: { path: filePath } },
      });
      expect(fs.readdirSync(tmpDir)).toEqual(["api-keys.json"]);
    } finally { fs.chmodSync(filePath, 0o600); }
    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/could not be read/), expect.objectContaining({ err: expect.objectContaining({ code: "EACCES" }) }));
  });

  it.runIf(isPosix)("writes the secrets file with 0600 permissions on POSIX", async () => {
    const store = new ApiKeyStore(filePath);
    await store.set("gemini", "stored-key");
    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it.runIf(isPosix)("warns and tightens a group/world-readable secrets file back to 0600 on read", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, `${JSON.stringify({ formatVersion: 1, keys: {} })}\n`);
    fs.chmodSync(filePath, 0o644);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);

    const store = new ApiKeyStore(filePath, logger);
    await store.resolve("gemini");

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/readable beyond the owner/i),
      expect.objectContaining({ mode: "644" }),
    );
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it.runIf(isPosix)("does not warn for an already-0600 secrets file", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, `${JSON.stringify({ formatVersion: 1, keys: {} })}\n`, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);

    const store = new ApiKeyStore(filePath, logger);
    await store.resolve("gemini");

    expect(logger.warn).not.toHaveBeenCalled();
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it.runIf(isPosix)("re-tightens a file widened again later in the same session, warning only once", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, `${JSON.stringify({ formatVersion: 1, keys: {} })}\n`);
    fs.chmodSync(filePath, 0o644);

    const store = new ApiKeyStore(filePath, logger);
    await store.resolve("gemini"); // first access: warns once and tightens
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Widened again mid-session (e.g. some external actor loosened perms).
    fs.chmodSync(filePath, 0o644);
    await store.resolve("gemini"); // second access: must re-tighten even though already warned once

    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    // The chmod repeats every time; only the warning stays once-per-session.
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it.runIf(isPosix)("logs a failed permission repair while keeping the stored key readable", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, `${JSON.stringify({ formatVersion: 1, keys: { gemini: "stored-key" } })}\n`);
    fs.chmodSync(filePath, 0o644);
    const open = fsPromises.open;
    const chmod = vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      vi.spyOn(file, "chmod").mockRejectedValueOnce(new Error("chmod denied"));
      return file;
    });
    const store = new ApiKeyStore(filePath, logger);

    await expect(store.resolve("gemini")).resolves.toBe("stored-key");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/could not tighten/i),
      expect.objectContaining({ apiKeysPath: filePath, err: expect.any(Error) }),
    );
    chmod.mockRestore();
  });

  it("treats a malformed obf: value as absent, warns naming the key id, and never returns garbage", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, `${JSON.stringify({ formatVersion: 1, keys: { gemini: "obf:not-valid-base64!!" } })}\n`);
    const store = new ApiKeyStore(filePath, logger);

    await expect(store.resolve("gemini")).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/malformed/i),
      expect.objectContaining({ keyId: "gemini" }),
    );
  });

  it("round-trips a valid obf: value without the malformed-value warning firing", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new ApiKeyStore(filePath, logger);
    await store.set("gemini", "sk-a-real-key");

    await expect(store.resolve("gemini")).resolves.toBe("sk-a-real-key");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  describe("format version", () => {
    it("reads a file with no format version as v0.1.0's form, leaving it as it is", async () => {
      const text = `${JSON.stringify({ keys: { gemini: "stored-key" } })}\n`;
      fs.writeFileSync(filePath, text, { mode: 0o600 });
      await expect(new ApiKeyStore(filePath).resolve("gemini")).resolves.toBe("stored-key");
      expect(fs.readFileSync(filePath, "utf8")).toBe(text);
      expect(fs.readdirSync(tmpDir)).toEqual(["api-keys.json"]);
    });

    it("writes the current version first and reads it back", async () => {
      const store = new ApiKeyStore(filePath);
      await store.set("gemini", "stored-key");
      const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
      expect(Object.keys(onDisk)).toEqual(["formatVersion", "keys"]);
      expect(onDisk.formatVersion).toBe(1);
      await expect(new ApiKeyStore(filePath).resolve("gemini")).resolves.toBe("stored-key");
    });

    it.runIf(isPosix)("repairs only the inspected descriptor if the pathname is replaced during its read", async () => {
      fs.writeFileSync(filePath, JSON.stringify({ formatVersion: 1, keys: { gemini: "old-synthetic" } }));
      fs.chmodSync(filePath, 0o644);
      const future = JSON.stringify({ formatVersion: 2, future: "kept" });
      const open = fsPromises.open;
      const spy = vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
        const file = await open(...args);
        const read = file.readFile.bind(file);
        vi.spyOn(file, "readFile").mockImplementationOnce(async (...readArgs) => {
          const text = await read(...readArgs);
          const replacement = path.join(tmpDir, "replacement.json");
          fs.writeFileSync(replacement, future, { mode: 0o644 });
          fs.renameSync(replacement, filePath);
          return text;
        });
        return file;
      });
      try {
        await expect(new ApiKeyStore(filePath).peek("gemini")).resolves.toBe("old-synthetic");
        expect(fs.readFileSync(filePath, "utf8")).toBe(future);
        expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);
      } finally { spy.mockRestore(); }
    });

    it.runIf(isPosix)("leaves a newer file's broad permissions exactly as found", async () => {
      fs.writeFileSync(filePath, JSON.stringify({ formatVersion: 2, keys: { gemini: "synthetic" } }));
      fs.chmodSync(filePath, 0o644);
      const store = new ApiKeyStore(filePath);
      await expect(store.peek("gemini")).resolves.toBeNull();
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);
    });

    it("reads a newer file as no key, refuses to store over it, and leaves it byte-identical", async () => {
      const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const text = `${JSON.stringify({ formatVersion: 2, keys: { gemini: "stored-key" } })}\n`;
      fs.writeFileSync(filePath, text, { mode: 0o600 });
      const store = new ApiKeyStore(filePath, logger);

      await expect(store.resolve("gemini")).resolves.toBeNull();
      await expect(store.has("gemini")).resolves.toBe(false);
      await expect(store.set("gemini", "new-key")).rejects.toMatchObject({ name: "StoreNotWritableError", filePath, reason: { key: "failure.storeLeftNewer", values: { path: filePath } } });
      await store.clear("gemini");

      expect(fs.readFileSync(filePath, "utf8")).toBe(text);
      expect(fs.readdirSync(tmpDir)).toEqual(["api-keys.json"]);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/newer/), expect.objectContaining({ apiKeysPath: filePath, formatVersion: 2 }));
    });
  });
});
