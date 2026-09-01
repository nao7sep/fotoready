import path from "node:path";
import { homedir } from "node:os";
import type { AssetImportResult, StampEntry } from "@shared/types/ipc";
import type { Logger } from "@shared/types/log";
import {
  compareAssetFileNames,
  deleteDirectoryAssets,
  expandHomePath,
  importDirectoryAssets,
  isDirectoryAssetPath,
  listDirectoryAssets,
  readDirectoryAssets
} from "./file-asset-catalog";
import { readBuiltinStampCatalog } from "./builtin-stamp-catalog";

const STAMP_EXTENSIONS = [".png", ".svg"] as const;

export async function listStamps(stampFolder: string, defaultStampDir: string, bundledStampsDir: string, logger?: Logger): Promise<StampEntry[]> {
  const dir = resolveStampDir(stampFolder, defaultStampDir);
  const [builtInEntries, userEntries] = await Promise.all([
    readDirectoryAssets(bundledStampsDir, STAMP_EXTENSIONS, logger),
    listDirectoryAssets(dir, STAMP_EXTENSIONS, logger)
  ]);
  const catalogEntries = await readBuiltinStampCatalog(
    bundledStampsDir,
    builtInEntries.map((entry) => entry.fileName)
  );
  const builtInEntriesByFileName = new Map(builtInEntries.map((entry) => [entry.fileName, entry]));
  return [
    ...catalogEntries.map((catalogEntry) => {
      const entry = builtInEntriesByFileName.get(catalogEntry.file);
      if (!entry) throw new Error(`Built-in stamp asset is missing after catalog validation: ${catalogEntry.file}`);
      return {
        slug: catalogEntry.slug,
        builtin: true,
        format: entry.extension.slice(1) as StampEntry["format"],
        groupId: catalogEntry.group,
        name: catalogEntry.label,
        path: entry.path
      };
    }),
    ...userEntries.map((entry) => ({
      slug: path.parse(entry.fileName).name,
      builtin: false,
      format: entry.extension.slice(1) as StampEntry["format"],
      groupId: "imported" as const,
      name: entry.fileName,
      path: entry.path
    }))
  ].sort((left, right) => compareAssetFileNames(left.name, right.name));
}

export async function importStamps(filePaths: readonly string[], stampFolder: string, defaultStampDir: string, bundledStampsDir: string, logger?: Logger): Promise<AssetImportResult[]> {
  const dir = resolveStampDir(stampFolder, defaultStampDir);
  const builtInEntries = await readDirectoryAssets(bundledStampsDir, STAMP_EXTENSIONS, logger);
  const entries = await importDirectoryAssets(filePaths, dir, STAMP_EXTENSIONS, builtInEntries, logger);
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
