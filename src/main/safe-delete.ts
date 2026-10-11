import fs from "node:fs/promises";
import { shell } from "electron";

/** Individual trash outcomes remain known even when another selected file cannot be moved. */
export class FileTrashError extends Error {
  constructor(readonly removed: string[], readonly failures: Array<{ path: string; error: unknown }>) {
    super("Some selected files could not be moved to the trash.", { cause: new AggregateError(failures.map((failure) => failure.error)) });
    this.name = "FileTrashError";
  }
}

export async function deleteSelectedFiles(filePaths: string[]): Promise<void> {
  const uniquePaths = [...new Set(filePaths.filter((filePath) => filePath.trim().length > 0))];
  const failures: Array<{ path: string; error: unknown }> = [];
  const removed: string[] = [];

  for (const filePath of uniquePaths) {
    try {
      if (!(await fileExists(filePath))) {
        removed.push(filePath);
        continue;
      }
      await shell.trashItem(filePath);
      removed.push(filePath);
    } catch (error) {
      failures.push({ path: filePath, error });
    }
  }

  if (failures.length > 0) {
    throw new FileTrashError(removed, failures);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
