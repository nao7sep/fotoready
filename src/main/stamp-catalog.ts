import path from "node:path";
import { DEFAULT_STAMP_FOLDER } from "@shared/constants";
import type { AssetRestoreResult, StampEntry } from "@shared/types/ipc";
import {
  assetNameSet,
  deleteDirectoryAsset,
  expandHomePath,
  importDirectoryAssets,
  listDirectoryAssets,
  readDirectoryAssets,
  restoreDirectoryAssets
} from "./file-asset-catalog";

const STAMP_EXTENSIONS = [".png", ".svg"] as const;

export async function listStamps(homeDir: string, bundledStampsDir: string): Promise<StampEntry[]> {
  const dir = resolveStampDir(homeDir);
  const builtInNames = await builtInStampNames(bundledStampsDir);
  const entries = await listDirectoryAssets(dir, STAMP_EXTENSIONS);
  return entries.map((entry) => ({
    builtin: builtInNames.has(entry.name),
    format: entry.extension.slice(1) as StampEntry["format"],
    name: entry.name,
    path: entry.path
  }));
}

export async function importStamps(filePaths: readonly string[], homeDir: string, bundledStampsDir: string): Promise<StampEntry[]> {
  const dir = resolveStampDir(homeDir);
  const builtInNames = await builtInStampNames(bundledStampsDir);
  const entries = await importDirectoryAssets(filePaths, dir, STAMP_EXTENSIONS, "stamp");
  return entries.map((entry) => ({
    builtin: builtInNames.has(entry.name),
    format: entry.extension.slice(1) as StampEntry["format"],
    name: entry.name,
    path: entry.path
  }));
}

export async function deleteStamp(filePath: string, homeDir: string, bundledStampsDir: string): Promise<void> {
  const builtInNames = await builtInStampNames(bundledStampsDir);
  const entryName = path.basename(filePath, path.extname(filePath));
  if (builtInNames.has(entryName)) {
    throw new Error("Built-in stamps cannot be deleted.");
  }
  await deleteDirectoryAsset(filePath, resolveStampDir(homeDir), STAMP_EXTENSIONS);
}

export async function restoreBuiltInStamps(homeDir: string, bundledStampsDir: string): Promise<AssetRestoreResult> {
  return restoreDirectoryAssets(bundledStampsDir, resolveStampDir(homeDir), STAMP_EXTENSIONS);
}

export async function builtInStampNames(bundledStampsDir: string): Promise<Set<string>> {
  return assetNameSet(await readDirectoryAssets(bundledStampsDir, STAMP_EXTENSIONS));
}

export function resolveStampDir(homeDir: string): string {
  return expandHomePath(DEFAULT_STAMP_FOLDER, homeDir);
}
