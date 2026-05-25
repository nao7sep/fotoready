import path from "node:path";
import { DEFAULT_STAMP_FOLDER } from "@shared/constants";
import type { AssetImportResult, StampEntry } from "@shared/types/ipc";
import {
  compareAssetFileNames,
  deleteDirectoryAssets,
  expandHomePath,
  importDirectoryAssets,
  isDirectoryAssetPath,
  listDirectoryAssets,
  readDirectoryAssets
} from "./file-asset-catalog";

const STAMP_EXTENSIONS = [".png", ".svg"] as const;

export async function listStamps(stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<StampEntry[]> {
  const dir = resolveStampDir(stampFolder, homeDir);
  const [builtInEntries, userEntries] = await Promise.all([
    readDirectoryAssets(bundledStampsDir, STAMP_EXTENSIONS),
    listDirectoryAssets(dir, STAMP_EXTENSIONS)
  ]);
  return [
    ...builtInEntries.map((entry) => ({
      builtin: true,
      format: entry.extension.slice(1) as StampEntry["format"],
      name: entry.fileName,
      path: entry.path
    })),
    ...userEntries.map((entry) => ({
      builtin: false,
      format: entry.extension.slice(1) as StampEntry["format"],
      name: entry.fileName,
      path: entry.path
    }))
  ].sort((left, right) => compareAssetFileNames(left.name, right.name));
}

export async function importStamps(filePaths: readonly string[], stampFolder: string, homeDir: string, bundledStampsDir: string): Promise<AssetImportResult[]> {
  const dir = resolveStampDir(stampFolder, homeDir);
  const builtInEntries = await readDirectoryAssets(bundledStampsDir, STAMP_EXTENSIONS);
  const entries = await importDirectoryAssets(filePaths, dir, STAMP_EXTENSIONS, builtInEntries);
  return entries.map((result) => ({
    fileName: result.entry.fileName,
    path: result.entry.path,
    status: result.status
  }));
}

export async function deleteStamps(filePaths: readonly string[], stampFolder: string, homeDir: string): Promise<void> {
  const dir = resolveStampDir(stampFolder, homeDir);
  const matches = filePaths.filter((filePath) => !isDirectoryAssetPath(filePath, dir, STAMP_EXTENSIONS));
  if (matches.length > 0) {
    throw new Error(`Built-in stamps cannot be deleted: ${matches.map((filePath) => path.basename(filePath)).join(", ")}`);
  }
  await deleteDirectoryAssets(filePaths, dir, STAMP_EXTENSIONS);
}

export function resolveStampDir(stampFolder: string, homeDir: string): string {
  return expandHomePath(stampFolder.trim().length > 0 ? stampFolder : DEFAULT_STAMP_FOLDER, homeDir);
}
