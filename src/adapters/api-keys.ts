import { safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

type ApiKeyFile = Record<string, string>;

export class ApiKeyStore {
  constructor(private readonly filePath: string) {}

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
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as ApiKeyFile;
    } catch {
      return {};
    }
  }
}
