import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { shell } from "electron";

export type DirectoryAsset = {
  extension: string;
  fileName: string;
  path: string;
};

export type DirectoryAssetImportResult = {
  entry: DirectoryAsset;
  status: "imported" | "skipped-name-conflict";
};

export async function listDirectoryAssets(dir: string, extensions: readonly string[]): Promise<DirectoryAsset[]> {
  await fs.mkdir(dir, { recursive: true });
  return readDirectoryAssets(dir, extensions);
}

export async function readDirectoryAssets(dir: string, extensions: readonly string[]): Promise<DirectoryAsset[]> {
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => directoryAssetFromFileName(dir, entry.name))
    .sort((left, right) => compareAssetFileNames(left.fileName, right.fileName));
}

export async function importDirectoryAssets(
  filePaths: readonly string[],
  dir: string,
  extensions: readonly string[],
  reservedAssets: readonly DirectoryAsset[] = []
): Promise<DirectoryAssetImportResult[]> {
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
  await fs.mkdir(dir, { recursive: true });
  const knownAssets = new Map<string, DirectoryAsset>();
  for (const entry of [...reservedAssets, ...(await readDirectoryAssets(dir, extensions))]) {
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
    try {
      await fs.copyFile(absoluteSource, entry.path, fsConstants.COPYFILE_EXCL);
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

    knownAssets.set(normalizedFileName, entry);
    results.push({
      entry,
      status: "imported"
    });
  }
  return results;
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

// Expands a leading `~`/`~/` against the home directory and guarantees an
// absolute result. A relative value (e.g. a user-typed "myluts") is resolved
// against `homeDir` — an explicit, launch-independent base — and NEVER left to
// resolve against `process.cwd()` downstream, which would land under `/` on a
// double-clicked macOS build per the storage-path conventions.
export function expandHomePath(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  if (path.isAbsolute(input)) return input;
  return path.resolve(homeDir, input);
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
