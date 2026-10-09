import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { shell } from "electron";
import type { Logger } from "@shared/types/log";
import { record } from "./backup-store";
import { message, type Message } from "@shared/i18n/translate";

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

  constructor(dir: string, cause: unknown) {
    super(`The asset library folder "${dir}" could not be read.`, { cause });
    this.name = "LibraryFolderError";
    // The OS error text stays as the OS gave it, per the localization conventions.
    this.reason = message("failure.libraryFolderUnreadable", { path: dir, reason: cause instanceof Error ? cause.message : String(cause) });
  }
}

/** Lists the user's library folder, creating it first; a folder that cannot be created or read throws LibraryFolderError. */
export async function listDirectoryAssets(dir: string, extensions: readonly string[]): Promise<DirectoryAsset[]> {
  let entries: Dirent<string>[];
  try {
    await fs.mkdir(dir, { recursive: true });
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw new LibraryFolderError(dir, error);
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
      bytes = await copyNewFile(absoluteSource, entry.path);
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
 * keeps the source's modified time and mode (content-lifecycle conventions, Files). A copy that fails
 * after creating the destination removes it, since nothing else can own a file created exclusively.
 */
async function copyNewFile(source: string, destination: string): Promise<Buffer> {
  const stat = await fs.stat(source);
  const bytes = await fs.readFile(source);
  const file = await fs.open(destination, "wx", stat.mode & 0o7777);
  try {
    await file.writeFile(bytes);
    if (process.platform !== "win32") await file.chmod(stat.mode & 0o7777);
    await file.utimes(stat.atime, stat.mtime);
    await file.close();
  } catch (error) {
    await file.close().catch(() => undefined);
    await fs.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
  return bytes;
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
