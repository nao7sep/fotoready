import { DEFAULT_STAMP_FOLDER } from "@shared/constants";
import type { AssetImportResult, AssetRestoreResult, StampEntry } from "@shared/types/ipc";
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

const STAMP_EXTENSIONS = [".png", ".svg"] as const;

export async function listStamps(stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<StampEntry[]> {
  const dir = resolveStampDir(stampFolder, homeDir);
  const builtInFileNames = await builtInStampNames(bundledStampsDir);
  const entries = await listDirectoryAssets(dir, STAMP_EXTENSIONS);
  return entries.map((entry) => ({
    builtin: isMatchingBuiltInAsset(entry.path, builtInFileNames),
    format: entry.extension.slice(1) as StampEntry["format"],
    name: entry.fileName,
    path: entry.path
  }));
}

export async function importStamps(filePaths: readonly string[], stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<AssetImportResult[]> {
  const dir = resolveStampDir(stampFolder, homeDir);
  const entries = await importDirectoryAssets(filePaths, dir, STAMP_EXTENSIONS);
  return entries.map((result) => ({
    fileName: result.entry.fileName,
    path: result.entry.path,
    status: result.status
  }));
}

export async function deleteStamps(filePaths: readonly string[], stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<void> {
  const builtInFileNames = await builtInStampNames(bundledStampsDir);
  const matches = matchingBuiltInAssetFileNames(filePaths, builtInFileNames);
  if (matches.length > 0) {
    throw new Error(`Built-in stamps cannot be deleted: ${matches.join(", ")}`);
  }
  await deleteDirectoryAssets(filePaths, resolveStampDir(stampFolder, homeDir), STAMP_EXTENSIONS);
}

export async function restoreBuiltInStamps(stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<AssetRestoreResult> {
  return restoreDirectoryAssets(bundledStampsDir, resolveStampDir(stampFolder, homeDir), STAMP_EXTENSIONS);
}

export async function builtInStampNames(bundledStampsDir: string): Promise<Set<string>> {
  return builtInAssetNameSet(await readDirectoryAssets(bundledStampsDir, STAMP_EXTENSIONS));
}

export function resolveStampDir(stampFolder: string, homeDir: string): string {
  return expandHomePath(stampFolder.trim().length > 0 ? stampFolder : DEFAULT_STAMP_FOLDER, homeDir);
}
