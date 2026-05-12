import { createHash } from "node:crypto";
import fs from "node:fs/promises";

export function sha256Bytes(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await fs.readFile(path));
}
