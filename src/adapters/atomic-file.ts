import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  encoding?: BufferEncoding
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${nanoid(8)}`;
  try {
    if (typeof data === "string") {
      await fs.writeFile(tmpPath, data, encoding ?? "utf8");
    } else {
      await fs.writeFile(tmpPath, data);
    }
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true });
    throw error;
  }
}
