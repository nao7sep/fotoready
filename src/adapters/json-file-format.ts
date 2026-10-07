import fs from "node:fs/promises";
import { NewerFormatError, parseVersionedJson } from "@shared/format-versions";

/** Store recovery conventions: inspect the present marker before mutating a JSON store. */
export async function assertJsonFileFormat(filePath: string, supported: number): Promise<void> {
  let text: string;
  try { text = await fs.readFile(filePath, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const read = parseVersionedJson(text, supported);
  if (read.kind === "newer") throw new NewerFormatError(filePath, read.found, supported);
  if (read.kind === "invalid") throw read.error;
}
