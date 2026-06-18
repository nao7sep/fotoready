import path from "node:path";
import { homedir } from "node:os";
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

export async function listStamps(stampFolder: string, defaultStampDir: string, bundledStampsDir: string): Promise<StampEntry[]> {
  const dir = resolveStampDir(stampFolder, defaultStampDir);
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

export async function importStamps(filePaths: readonly string[], stampFolder: string, defaultStampDir: string, bundledStampsDir: string): Promise<AssetImportResult[]> {
  const dir = resolveStampDir(stampFolder, defaultStampDir);
  const builtInEntries = await readDirectoryAssets(bundledStampsDir, STAMP_EXTENSIONS);
  const entries = await importDirectoryAssets(filePaths, dir, STAMP_EXTENSIONS, builtInEntries);
  return entries.map((result) => ({
    fileName: result.entry.fileName,
    path: result.entry.path,
    status: result.status
  }));
}

export async function deleteStamps(filePaths: readonly string[], stampFolder: string, defaultStampDir: string): Promise<void> {
  const dir = resolveStampDir(stampFolder, defaultStampDir);
  const outsideFolder = filePaths.filter((filePath) => !isDirectoryAssetPath(filePath, dir, STAMP_EXTENSIONS));
  if (outsideFolder.length > 0) {
    throw new Error(`Cannot delete stamps outside the imported stamp folder (built-in stamps are included): ${outsideFolder.map((filePath) => path.basename(filePath)).join(", ")}`);
  }
  await deleteDirectoryAssets(filePaths, dir, STAMP_EXTENSIONS);
}

export function resolveStampDir(stampFolder: string, defaultStampDir: string): string {
  const trimmed = stampFolder.trim();
  return trimmed.length > 0 ? expandHomePath(trimmed, homedir()) : defaultStampDir;
}
