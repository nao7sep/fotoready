import { safeStorage } from "electron";
import fs from "node:fs/promises";
import { utcStamp } from "@shared/time";
import { atomicWriteFile } from "@adapters/atomic-file";

type ApiKeyFile = Record<string, string>;
type LoggerLike = {
  warn(fields: Record<string, unknown>, message: string): void;
};

export class ApiKeyStore {
  #chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly logger?: LoggerLike
  ) {}

  has(provider: string): Promise<boolean> {
    return this.serialize(async () => {
      const file = await this.readFile();
      return typeof file[provider] === "string" && file[provider].length > 0;
    });
  }

  get(provider: string): Promise<string | null> {
    return this.serialize(async () => {
      const file = await this.readFile();
      const encrypted = file[provider];
      if (!encrypted) return null;
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure storage encryption is not available on this system.");
      }
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    });
  }

  delete(provider: string): Promise<void> {
    return this.serialize(async () => {
      const file = await this.readFile();
      delete file[provider];
      await atomicWriteFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
    });
  }

  set(provider: string, value: string): Promise<void> {
    return this.serialize(async () => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure storage encryption is not available on this system.");
      }
      const file = await this.readFile();
      file[provider] = safeStorage.encryptString(value).toString("base64");
      await atomicWriteFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
    });
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(fn, fn);
    this.#chain = next.catch(() => {});
    return next;
  }

  private async readFile(): Promise<ApiKeyFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        const backupPath = await this.backupInvalidFile();
        this.logger?.warn({ mod: "api-keys", apiKeysPath: this.filePath, backupPath }, "api key file was not a JSON object; ignoring it");
        return {};
      }
      const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string");
      if (entries.length !== Object.keys(parsed).length) {
        this.logger?.warn({ mod: "api-keys", apiKeysPath: this.filePath }, "api key file contained non-string entries; ignoring those entries");
      }
      return Object.fromEntries(entries);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const backupPath = await this.backupInvalidFile();
        this.logger?.warn({ mod: "api-keys", apiKeysPath: this.filePath, backupPath, err: error }, "api key file was unreadable; ignoring it");
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
