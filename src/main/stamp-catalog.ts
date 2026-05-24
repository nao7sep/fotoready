import { DEFAULT_STAMP_FOLDER } from "@shared/constants";
import type { AssetRestoreResult, StampEntry } from "@shared/types/ipc";
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

const STAMP_EXTENSIONS = [".png", ".svg"] as const;

export async function listStamps(stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<StampEntry[]> {
  const dir = resolveStampDir(stampFolder, homeDir);
  const builtInKeys = await builtInStampKeys(bundledStampsDir);
  const entries = await listDirectoryAssets(dir, STAMP_EXTENSIONS);
  return Promise.all(entries.map(async (entry) => ({
    builtin: await isMatchingBuiltInAsset(entry.path, builtInKeys),
    format: entry.extension.slice(1) as StampEntry["format"],
    name: entry.name,
    path: entry.path
  })));
}

export async function importStamps(filePaths: readonly string[], stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<StampEntry[]> {
  const dir = resolveStampDir(stampFolder, homeDir);
  const builtInKeys = await builtInStampKeys(bundledStampsDir);
  const entries = await importDirectoryAssets(filePaths, dir, STAMP_EXTENSIONS, "stamp");
  return Promise.all(entries.map(async (entry) => ({
    builtin: await isMatchingBuiltInAsset(entry.path, builtInKeys),
    format: entry.extension.slice(1) as StampEntry["format"],
    name: entry.name,
    path: entry.path
  })));
}

export async function deleteStamp(filePath: string, stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<void> {
  const builtInKeys = await builtInStampKeys(bundledStampsDir);
  if (await isMatchingBuiltInAsset(filePath, builtInKeys)) {
    throw new Error("Built-in stamps cannot be deleted.");
  }
  await deleteDirectoryAsset(filePath, resolveStampDir(stampFolder, homeDir), STAMP_EXTENSIONS);
}

export async function restoreBuiltInStamps(stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<AssetRestoreResult> {
  return restoreDirectoryAssets(bundledStampsDir, resolveStampDir(stampFolder, homeDir), STAMP_EXTENSIONS);
}

export async function builtInStampKeys(bundledStampsDir: string): Promise<Set<string>> {
  return builtInAssetKeySet(await readDirectoryAssets(bundledStampsDir, STAMP_EXTENSIONS));
}

export function resolveStampDir(stampFolder: string, homeDir: string): string {
  return expandHomePath(stampFolder.trim().length > 0 ? stampFolder : DEFAULT_STAMP_FOLDER, homeDir);
}
