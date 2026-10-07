import fs from "node:fs/promises";
import { shell } from "electron";
import { assertOutputSidecarFormat, OutputSidecarFormatError } from "./output-sidecar-format";

export async function deleteSelectedFiles(filePaths: string[], sidecarPaths: string[] = []): Promise<void> {
  const uniquePaths = [...new Set(filePaths.filter((filePath) => filePath.trim().length > 0))];
  const failures: string[] = [];
  const checkSidecars = async () => {
    for (const filePath of new Set(sidecarPaths)) await assertOutputSidecarFormat(filePath);
  };
  await checkSidecars();

  for (const filePath of uniquePaths) {
    try {
      if (!(await fileExists(filePath))) {
        continue;
      }
      await checkSidecars();
      await shell.trashItem(filePath);
    } catch (error) {
      if (error instanceof OutputSidecarFormatError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${filePath}: ${detail}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Failed to move file${failures.length === 1 ? "" : "s"} to the trash: ${failures.join("; ")}`);
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
