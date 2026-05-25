import path from "node:path";
import { DEFAULT_LUT_FOLDER } from "@shared/constants";
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

export async function listLuts(lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<LutEntry[]> {
  const dir = resolveLutDir(lutFolder, homeDir);
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

export async function importLuts(filePaths: readonly string[], lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<AssetImportResult[]> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const builtInEntries = await readDirectoryAssets(bundledLutsDir, LUT_EXTENSIONS);
  const imported = await importDirectoryAssets(filePaths, dir, LUT_EXTENSIONS, builtInEntries);
  return imported.map((result) => ({
    fileName: result.entry.fileName,
    path: result.entry.path,
    status: result.status
  }));
}

export async function deleteLuts(filePaths: readonly string[], lutFolder: string, homeDir: string): Promise<void> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const matches = filePaths.filter((filePath) => !isDirectoryAssetPath(filePath, dir, LUT_EXTENSIONS));
  if (matches.length > 0) {
    throw new Error(`Built-in LUTs cannot be deleted: ${matches.map((filePath) => path.basename(filePath)).join(", ")}`);
  }
  await deleteDirectoryAssets(filePaths, dir, LUT_EXTENSIONS);
}

export function resolveLutDir(lutFolder: string, homeDir: string): string {
  return expandHomePath(lutFolder.trim().length > 0 ? lutFolder : DEFAULT_LUT_FOLDER, homeDir);
}
