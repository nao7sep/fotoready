import path from "node:path";
import { homedir } from "node:os";
import type { AssetImportResult, LutEntry } from "@shared/types/ipc";
import {
  compareAssetFileNames,
  deleteDirectoryAssets,
  expandHomePath,
  importDirectoryAssets,
  isDirectoryAssetPath,
  listDirectoryAssets,
  readDirectoryAssets
} from "./file-asset-catalog";

const LUT_EXTENSIONS = [".cube"] as const;

export async function listLuts(lutFolder: string, defaultLutDir: string, bundledLutsDir: string): Promise<LutEntry[]> {
  const dir = resolveLutDir(lutFolder, defaultLutDir);
  const [builtInEntries, userEntries] = await Promise.all([
    readDirectoryAssets(bundledLutsDir, LUT_EXTENSIONS),
    listDirectoryAssets(dir, LUT_EXTENSIONS)
  ]);
  return [
    ...builtInEntries.map((entry) => ({
      name: entry.fileName,
      path: entry.path,
      builtin: true
    })),
    ...userEntries.map((entry) => ({
      name: entry.fileName,
      path: entry.path,
      builtin: false
    }))
  ].sort((left, right) => compareAssetFileNames(left.name, right.name));
}

export async function importLuts(filePaths: readonly string[], lutFolder: string, defaultLutDir: string, bundledLutsDir: string): Promise<AssetImportResult[]> {
  const dir = resolveLutDir(lutFolder, defaultLutDir);
  const builtInEntries = await readDirectoryAssets(bundledLutsDir, LUT_EXTENSIONS);
  const imported = await importDirectoryAssets(filePaths, dir, LUT_EXTENSIONS, builtInEntries);
  return imported.map((result) => ({
    fileName: result.entry.fileName,
    path: result.entry.path,
    status: result.status
  }));
}

export async function deleteLuts(filePaths: readonly string[], lutFolder: string, defaultLutDir: string): Promise<void> {
  const dir = resolveLutDir(lutFolder, defaultLutDir);
  const outsideFolder = filePaths.filter((filePath) => !isDirectoryAssetPath(filePath, dir, LUT_EXTENSIONS));
  if (outsideFolder.length > 0) {
    throw new Error(`Cannot delete LUTs outside the imported LUT folder (built-in LUTs are included): ${outsideFolder.map((filePath) => path.basename(filePath)).join(", ")}`);
  }
  await deleteDirectoryAssets(filePaths, dir, LUT_EXTENSIONS);
}

export function resolveLutDir(lutFolder: string, defaultLutDir: string): string {
  const trimmed = lutFolder.trim();
  return trimmed.length > 0 ? expandHomePath(trimmed, homedir()) : defaultLutDir;
}
