import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { shell } from "electron";
import type { Logger } from "@shared/types/log";
import { record } from "./backup-store";
import { message, type Message } from "@shared/i18n/translate";
import { temporaryPathFor } from "@adapters/atomic-file";
import { moveOutputFile } from "./move-output-file";

export type DirectoryAsset = {
  extension: string;
  fileName: string;
  path: string;
};

export type DirectoryAssetImportResult = {
  entry: DirectoryAsset;
  status: "imported" | "skipped-name-conflict";
};

/** A library folder could not be created or read; `reason` is the user-facing copy naming it. */
export class LibraryFolderError extends Error {
  readonly reason: Message;

  constructor(dir: string, cause: unknown, displayPath: string | null = dir) {
    super(`The asset library folder "${dir}" could not be read.`, { cause });
    this.name = "LibraryFolderError";
    // The actual directory and exception remain diagnostic evidence; only a chosen folder is named.
    this.reason = displayPath === null ? message("failure.libraryUnreadable") : message("failure.libraryFolderUnreadable", { path: displayPath });
  }
}

/** Lists the user's library folder, creating it first; a folder that cannot be created or read throws LibraryFolderError. */
export async function listDirectoryAssets(dir: string, extensions: readonly string[], displayPath: string | null = dir): Promise<DirectoryAsset[]> {
  let entries: Dirent<string>[];
  try {
    await fs.mkdir(dir, { recursive: true });
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw new LibraryFolderError(dir, error, displayPath);
  }
  return assetsFromEntries(dir, entries, extensions);
}

export async function readDirectoryAssets(dir: string, extensions: readonly string[], logger?: Logger): Promise<DirectoryAsset[]> {
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    logger?.warn("could not read asset library directory; treating it as empty", {
      mod: "assets.catalog",
      assetDir: dir,
      err: error,
    });
    return [];
  }
  return assetsFromEntries(dir, entries, extensions);
}

function assetsFromEntries(dir: string, entries: readonly Dirent<string>[], extensions: readonly string[]): DirectoryAsset[] {
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
  return entries
    .filter((entry) => entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => directoryAssetFromFileName(dir, entry.name))
    .sort((left, right) => compareAssetFileNames(left.fileName, right.fileName));
}

export async function importDirectoryAssets(
  filePaths: readonly string[],
  dir: string,
  extensions: readonly string[],
  reservedAssets: readonly DirectoryAsset[] = [],
  logger?: Logger
): Promise<DirectoryAssetImportResult[]> {
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
  await fs.mkdir(dir, { recursive: true });
  const knownAssets = new Map<string, DirectoryAsset>();
  for (const entry of [...reservedAssets, ...(await readDirectoryAssets(dir, extensions, logger))]) {
    knownAssets.set(normalizeAssetFileName(entry.fileName), entry);
  }

  const results: DirectoryAssetImportResult[] = [];
  for (const filePath of filePaths) {
    const absoluteSource = path.resolve(filePath);
    const sourceFileName = path.basename(absoluteSource);
    const extension = path.extname(sourceFileName).toLowerCase();
    if (!allowed.has(extension)) {
      throw new Error(`Only ${extensions.join(", ")} files can be imported.`);
    }

    const normalizedFileName = normalizeAssetFileName(sourceFileName);
    const existing = knownAssets.get(normalizedFileName);
    if (existing) {
      results.push({
        entry: existing,
        status: "skipped-name-conflict"
      });
      continue;
    }

    const entry = directoryAssetFromFileName(dir, sourceFileName);
    let bytes: Buffer;
    try {
      bytes = await copyNewFile(absoluteSource, entry.path, logger);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        knownAssets.set(normalizedFileName, entry);
        results.push({
          entry,
          status: "skipped-name-conflict"
        });
        continue;
      }
      throw error;
    }
    // recorded: a LUT or stamp the user adds is protected, once, from the exact bytes written
    // (data-backup-conventions, Capture).
    record(entry.path, bytes);

    knownAssets.set(normalizedFileName, entry);
    results.push({
      entry,
      status: "imported"
    });
  }
  return results;
}

/**
 * Copies `source` to `destination`, which must not exist yet, and returns the bytes written. The copy
 * keeps the source's modified time and mode. Bytes are completed and synced in private staging before
 * publication. Hard-link publication exposes only complete bytes; the exclusive-copy fallback
 * on volumes without links retains the recoverable interruption risk of output moves.
 */
async function copyNewFile(source: string, destination: string, logger?: Logger): Promise<Buffer> {
  const stat = await fs.stat(source);
  const bytes = await fs.readFile(source);
  // Imports are serialized by the catalog owner. Keep its fixed staging separate from the
  // publication helper's own fallback staging, which may be needed on volumes without hard links.
  const staging = `${temporaryPathFor(destination)}-import`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { mode: 0o700 });
  const stagedPath = path.join(staging, path.basename(destination));
  try {
    const file = await fs.open(stagedPath, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      if (process.platform !== "win32") await file.chmod(stat.mode & 0o7777);
      await file.utimes(stat.atime, stat.mtime);
      await file.sync();
    } catch (error) {
      await file.close().catch((closeError) => logger?.warn("could not close unpublished asset", { mod: "assets.catalog", filePath: stagedPath, err: closeError }));
      throw error;
    }
    await file.close();
    for (const failure of await moveOutputFile(stagedPath, destination, logger)) {
      logger?.warn("could not clean up published asset staging", { mod: "assets.catalog", filePath: failure.path, err: failure.error });
    }
    return bytes;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch((error) => logger?.warn("could not remove asset import staging", { mod: "assets.catalog", staging, err: error }));
  }
}

export async function deleteDirectoryAsset(filePath: string, dir: string, extensions: readonly string[]): Promise<void> {
  const target = assertDirectoryAssetPath(filePath, dir, extensions);
  await shell.trashItem(target);
}

export async function deleteDirectoryAssets(filePaths: readonly string[], dir: string, extensions: readonly string[]): Promise<void> {
  for (const filePath of filePaths) {
    await deleteDirectoryAsset(filePath, dir, extensions);
  }
}

export function assertDirectoryAssetPath(filePath: string, dir: string, extensions: readonly string[]): string {
  const resolvedDir = path.resolve(dir);
  const resolvedPath = path.resolve(filePath);
  const relative = path.relative(resolvedDir, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Asset is outside the library folder.");
  }
  const extension = path.extname(resolvedPath).toLowerCase();
  if (!extensions.map((item) => item.toLowerCase()).includes(extension)) {
    throw new Error(`Only ${extensions.join(", ")} files can be managed here.`);
  }
  return resolvedPath;
}

export function isDirectoryAssetPath(filePath: string, dir: string, extensions: readonly string[]): boolean {
  try {
    assertDirectoryAssetPath(filePath, dir, extensions);
    return true;
  } catch {
    return false;
  }
}

export function compareAssetFileNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function directoryAssetFromFileName(dir: string, fileName: string): DirectoryAsset {
  const extension = path.extname(fileName).toLowerCase();
  return {
    extension,
    fileName,
    path: path.join(dir, fileName)
  };
}

function normalizeAssetFileName(fileName: string): string {
  return fileName.toLowerCase();
}
