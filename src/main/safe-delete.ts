import fs from "node:fs/promises";

export async function deleteSelectedFiles(filePaths: string[]): Promise<void> {
  const uniquePaths = [...new Set(filePaths.filter((filePath) => filePath.trim().length > 0))];
  const failures: string[] = [];

  for (const filePath of uniquePaths) {
    try {
      if (!(await fileExists(filePath))) {
        continue;
      }
      await fs.rm(filePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${filePath}: ${detail}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Failed to delete output file${failures.length === 1 ? "" : "s"}: ${failures.join("; ")}`);
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
