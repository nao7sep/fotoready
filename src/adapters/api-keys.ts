import fs from "node:fs/promises";
import { utcStamp } from "@shared/time";
import { atomicWriteFile } from "@adapters/atomic-file";
import type { Logger } from "@shared/types/log";

type ApiKeyFile = Record<string, string>;

// Secrets file mode on POSIX. The api-keys file holds a key at rest, so it is
// owner-only per the storage-path conventions; the mode is enforced on every
// write and a broader mode is warned about on read.
const SECRETS_FILE_MODE = 0o600;
const ENFORCE_FILE_MODE = process.platform !== "win32";

// Per-provider environment variables that take precedence over the stored key,
// so a user can supply a key without persisting it (storage-path conventions:
// "Resolution prefers the environment"). Gemini is the only provider today.
const PROVIDER_ENV_VARS: Record<string, string> = {
  gemini: "GEMINI_API_KEY"
};

function envKeyFor(provider: string): string | null {
  const envVar = PROVIDER_ENV_VARS[provider];
  if (!envVar) return null;
  const value = process.env[envVar];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export class ApiKeyStore {
  #chain: Promise<unknown> = Promise.resolve();
  #modeWarned = false;

  constructor(
    private readonly filePath: string,
    private readonly logger?: Logger
  ) {}

  has(provider: string): Promise<boolean> {
    if (envKeyFor(provider)) return Promise.resolve(true);
    return this.serialize(async () => {
      const file = await this.readFile();
      return decodeApiKey(file[provider] ?? "").length > 0;
    });
  }

  get(provider: string): Promise<string | null> {
    // Environment value wins over the stored value.
    const envValue = envKeyFor(provider);
    if (envValue) return Promise.resolve(envValue);
    return this.serialize(async () => {
      const file = await this.readFile();
      const apiKey = decodeApiKey(file[provider] ?? "");
      return apiKey.length > 0 ? apiKey : null;
    });
  }

  delete(provider: string): Promise<void> {
    return this.serialize(async () => {
      const file = await this.readFile();
      delete file[provider];
      await atomicWriteFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, { mode: SECRETS_FILE_MODE });
    });
  }

  set(provider: string, value: string): Promise<void> {
    return this.serialize(async () => {
      const file = await this.readFile();
      file[provider] = encodeApiKey(value);
      await atomicWriteFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, { mode: SECRETS_FILE_MODE });
    });
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(fn, fn);
    this.#chain = next.catch(() => {});
    return next;
  }

  // POSIX-only: warn once if the secrets file is readable beyond the owner. We
  // warn rather than refuse so an existing key is not made unusable, and repair
  // the mode opportunistically; the next write re-applies 0600 regardless.
  private async warnIfInsecureMode(): Promise<void> {
    if (!ENFORCE_FILE_MODE || this.#modeWarned) return;
    try {
      const stat = await fs.stat(this.filePath);
      if ((stat.mode & 0o077) !== 0) {
        this.#modeWarned = true;
        const octal = (stat.mode & 0o777).toString(8).padStart(3, "0");
        this.logger?.warn("api key file is readable beyond the owner; tightening to 0600", {
          mod: "api-keys",
          apiKeysPath: this.filePath,
          mode: octal
        });
        await fs.chmod(this.filePath, SECRETS_FILE_MODE).catch(() => {});
      }
    } catch {
      // No file yet, or stat failed — nothing to warn about.
    }
  }

  private async readFile(): Promise<ApiKeyFile> {
    await this.warnIfInsecureMode();
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        const backupPath = await this.backupInvalidFile();
        this.logger?.warn("api key file was not a JSON object; ignoring it", { mod: "api-keys", apiKeysPath: this.filePath, backupPath });
        return {};
      }
      const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string");
      if (entries.length !== Object.keys(parsed).length) {
        this.logger?.warn("api key file contained non-string entries; ignoring those entries", { mod: "api-keys", apiKeysPath: this.filePath });
      }
      return Object.fromEntries(entries);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const backupPath = await this.backupInvalidFile();
        this.logger?.warn("api key file was unreadable; ignoring it", { mod: "api-keys", apiKeysPath: this.filePath, backupPath, err: error });
      }
      return {};
    }
  }

  private async backupInvalidFile(): Promise<string | null> {
    const backupPath = `${this.filePath}.${utcStamp()}.invalid`;
    try {
      await fs.copyFile(this.filePath, backupPath);
      return backupPath;
    } catch {
      return null;
    }
  }
}

const API_KEY_MARKER = "obf:";

function encodeApiKey(value: string): string {
  if (!value) return "";
  const reversed = Array.from(value).reverse().join("");
  return `${API_KEY_MARKER}${Buffer.from(reversed, "utf8").toString("base64")}`;
}

function decodeApiKey(value: string): string {
  if (!value.startsWith(API_KEY_MARKER)) return "";
  try {
    const reversed = Buffer.from(value.slice(API_KEY_MARKER.length), "base64").toString("utf8");
    return Array.from(reversed).reverse().join("");
  } catch {
    return "";
  }
}
