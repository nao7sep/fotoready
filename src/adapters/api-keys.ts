import { safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { utcStamp } from "@shared/time";

type ApiKeyFile = Record<string, string>;
type LoggerLike = {
  warn(fields: Record<string, unknown>, message: string): void;
};

export class ApiKeyStore {
  constructor(
    private readonly filePath: string,
    private readonly logger?: LoggerLike
  ) {}

  async has(provider: string): Promise<boolean> {
    const file = await this.readFile();
    return typeof file[provider] === "string" && file[provider].length > 0;
  }

  async get(provider: string): Promise<string | null> {
    const file = await this.readFile();
    const encrypted = file[provider];
    if (!encrypted) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage encryption is not available on this system.");
    }
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async delete(provider: string): Promise<void> {
    const file = await this.readFile();
    delete file[provider];
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  async set(provider: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage encryption is not available on this system.");
    }

    const file = await this.readFile();
    file[provider] = safeStorage.encryptString(value).toString("base64");
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
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
