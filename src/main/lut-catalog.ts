import { DEFAULT_LUT_FOLDER } from "@shared/constants";
import type { AssetRestoreResult, LutEntry } from "@shared/types/ipc";
import {
  builtInAssetKeySet,
  deleteDirectoryAsset,
  expandHomePath,
  importDirectoryAssets,
  isMatchingBuiltInAsset,
  listDirectoryAssets,
  readDirectoryAssets,
  restoreDirectoryAssets
} from "./file-asset-catalog";

const LUT_EXTENSIONS = [".cube"] as const;

export async function listLuts(lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<LutEntry[]> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const builtInKeys = await builtInLutKeys(bundledLutsDir);
  const entries = await listDirectoryAssets(dir, LUT_EXTENSIONS);
  const luts = await Promise.all(entries.map(async (entry) => ({
      name: entry.name,
      path: entry.path,
      builtin: await isMatchingBuiltInAsset(entry.path, builtInKeys)
    })));
  return luts.sort((a, b) => a.name.localeCompare(b.name));
}

export async function importLuts(filePaths: readonly string[], lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<LutEntry[]> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const builtInKeys = await builtInLutKeys(bundledLutsDir);
  const imported = await importDirectoryAssets(filePaths, dir, LUT_EXTENSIONS, "lut");
  return Promise.all(imported.map(async (entry) => ({
    name: entry.name,
    path: entry.path,
    builtin: await isMatchingBuiltInAsset(entry.path, builtInKeys)
  })));
}

export async function deleteLut(filePath: string, lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<void> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const builtInKeys = await builtInLutKeys(bundledLutsDir);
  if (await isMatchingBuiltInAsset(filePath, builtInKeys)) {
    throw new Error("Built-in LUTs cannot be deleted.");
  }
  await deleteDirectoryAsset(filePath, dir, LUT_EXTENSIONS);
}

export async function restoreBuiltInLuts(lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<AssetRestoreResult> {
  const result = await restoreDirectoryAssets(bundledLutsDir, resolveLutDir(lutFolder, homeDir), LUT_EXTENSIONS);
  return result;
}

export async function builtInLutKeys(bundledLutsDir: string): Promise<Set<string>> {
  return builtInAssetKeySet(await readDirectoryAssets(bundledLutsDir, LUT_EXTENSIONS));
}

export function resolveLutDir(lutFolder: string, homeDir: string): string {
  return expandHomePath(lutFolder.trim().length > 0 ? lutFolder : DEFAULT_LUT_FOLDER, homeDir);
}
