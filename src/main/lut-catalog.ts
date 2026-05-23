import path from "node:path";
import { DEFAULT_LUT_FOLDER } from "@shared/constants";
import type { AssetRestoreResult, LutEntry } from "@shared/types/ipc";
import {
  assetNameSet,
  deleteDirectoryAsset,
  expandHomePath,
  importDirectoryAssets,
  listDirectoryAssets,
  readDirectoryAssets,
  restoreDirectoryAssets
} from "./file-asset-catalog";

const LUT_EXTENSIONS = [".cube"] as const;

export async function listLuts(lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<LutEntry[]> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const builtInNames = await builtInLutNames(bundledLutsDir);
  const entries = await listDirectoryAssets(dir, LUT_EXTENSIONS);
  return entries
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      builtin: builtInNames.has(entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function importLuts(filePaths: readonly string[], lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<LutEntry[]> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const builtInNames = await builtInLutNames(bundledLutsDir);
  const imported = await importDirectoryAssets(filePaths, dir, LUT_EXTENSIONS, "lut");
  return imported.map((entry) => ({
    name: entry.name,
    path: entry.path,
    builtin: builtInNames.has(entry.name)
  }));
}

export async function deleteLut(filePath: string, lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<void> {
  const dir = resolveLutDir(lutFolder, homeDir);
  const builtInNames = await builtInLutNames(bundledLutsDir);
  const entryName = path.basename(filePath, path.extname(filePath));
  if (builtInNames.has(entryName)) {
    throw new Error("Built-in LUTs cannot be deleted.");
  }
  await deleteDirectoryAsset(filePath, dir, LUT_EXTENSIONS);
}

export async function restoreBuiltInLuts(lutFolder: string, homeDir: string, bundledLutsDir: string): Promise<AssetRestoreResult> {
  const result = await restoreDirectoryAssets(bundledLutsDir, resolveLutDir(lutFolder, homeDir), LUT_EXTENSIONS);
  return result;
}

export async function builtInLutNames(bundledLutsDir: string): Promise<Set<string>> {
  return assetNameSet(await readDirectoryAssets(bundledLutsDir, LUT_EXTENSIONS));
}

export function resolveLutDir(lutFolder: string, homeDir: string): string {
  return expandHomePath(lutFolder.trim().length > 0 ? lutFolder : DEFAULT_LUT_FOLDER, homeDir);
}
