import { DEFAULT_LUT_FOLDER } from "@shared/constants";
import type { AssetImportResult, AssetRestoreResult, LutEntry } from "@shared/types/ipc";
import {
  builtInAssetNameSet,
  deleteDirectoryAssets,
  expandHomePath,
  importDirectoryAssets,
  isMatchingBuiltInAsset,
  listDirectoryAssets,
  matchingBuiltInAssetFileNames,
  readDirectoryAssets,
  restoreDirectoryAssets
} from "./file-asset-catalog";

const LUT_EXTENSIONS = [".cube"] as const;

export async function listLuts(lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<LutEntry[]> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const builtInFileNames = await builtInLutNames(bundledLutsDir);
  const entries = await listDirectoryAssets(dir, LUT_EXTENSIONS);
  return entries.map((entry) => ({
    name: entry.fileName,
    path: entry.path,
    builtin: isMatchingBuiltInAsset(entry.path, builtInFileNames)
  }));
}

export async function importLuts(filePaths: readonly string[], lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<AssetImportResult[]> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const imported = await importDirectoryAssets(filePaths, dir, LUT_EXTENSIONS);
  return imported.map((result) => ({
    fileName: result.entry.fileName,
    path: result.entry.path,
    status: result.status
  }));
}

export async function deleteLuts(filePaths: readonly string[], lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<void> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const builtInFileNames = await builtInLutNames(bundledLutsDir);
  const matches = matchingBuiltInAssetFileNames(filePaths, builtInFileNames);
  if (matches.length > 0) {
    throw new Error(`Built-in LUTs cannot be deleted: ${matches.join(", ")}`);
  }
  await deleteDirectoryAssets(filePaths, dir, LUT_EXTENSIONS);
}

export async function restoreBuiltInLuts(lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<AssetRestoreResult> {
  const result = await restoreDirectoryAssets(bundledLutsDir, resolveLutDir(lutFolder, homeDir), LUT_EXTENSIONS);
  return result;
}

export async function builtInLutNames(bundledLutsDir: string): Promise<Set<string>> {
  return builtInAssetNameSet(await readDirectoryAssets(bundledLutsDir, LUT_EXTENSIONS));
}

export function resolveLutDir(lutFolder: string, homeDir: string): string {
  return expandHomePath(lutFolder.trim().length > 0 ? lutFolder : DEFAULT_LUT_FOLDER, homeDir);
}
