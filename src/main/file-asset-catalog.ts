import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

export type DirectoryAsset = {
  extension: string;
  fileName: string;
  path: string;
};

export type DirectoryAssetImportResult = {
  entry: DirectoryAsset;
  status: "imported" | "skipped-name-conflict";
};

export type RestoreDirectoryAssetsResult = {
  restored: string[];
  skipped: string[];
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

export async function importDirectoryAsset(
  filePath: string,
  dir: string,
  extensions: readonly string[]
): Promise<DirectoryAssetImportResult> {
  const extension = path.extname(filePath).toLowerCase();
  if (!extensions.map((item) => item.toLowerCase()).includes(extension)) {
    throw new Error(`Only ${extensions.join(", ")} files can be imported.`);
  }
  await fs.mkdir(dir, { recursive: true });
  const absoluteSource = path.resolve(filePath);
  const sourceFileName = path.basename(absoluteSource);
  const existing = await readDirectoryAssets(dir, extensions);
  const duplicate = existing.find((entry) => isSameAssetFileName(entry.fileName, sourceFileName));
  if (duplicate) {
    return {
      entry: duplicate,
      status: "skipped-name-conflict"
    };
  }

  const targetPath = path.join(dir, sourceFileName);
  try {
    await fs.copyFile(absoluteSource, targetPath, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return {
        entry: directoryAssetFromFileName(dir, sourceFileName),
        status: "skipped-name-conflict"
      };
    }
    throw error;
  }
  return {
    entry: directoryAssetFromFileName(dir, sourceFileName),
    status: "imported"
  };
}

export async function importDirectoryAssets(
  filePaths: readonly string[],
  dir: string,
  extensions: readonly string[]
): Promise<DirectoryAssetImportResult[]> {
  const results: DirectoryAssetImportResult[] = [];
  for (const filePath of filePaths) {
    results.push(await importDirectoryAsset(filePath, dir, extensions));
  }
  return results;
}

export async function restoreDirectoryAssets(
  sourceDir: string,
  targetDir: string,
  extensions: readonly string[]
): Promise<RestoreDirectoryAssetsResult> {
  await fs.mkdir(targetDir, { recursive: true });
  const sourceEntries = await readDirectoryAssets(sourceDir, extensions);
  const existingEntries = await readDirectoryAssets(targetDir, extensions);
  const existingFileNames = new Set(existingEntries.map((entry) => normalizeAssetFileName(entry.fileName)));
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const entry of sourceEntries) {
    if (existingFileNames.has(normalizeAssetFileName(entry.fileName))) {
      skipped.push(entry.fileName);
      continue;
    }
    const targetPath = path.join(targetDir, entry.fileName);
    try {
      await fs.copyFile(entry.path, targetPath, fsConstants.COPYFILE_EXCL);
      existingFileNames.add(normalizeAssetFileName(entry.fileName));
      restored.push(entry.fileName);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        existingFileNames.add(normalizeAssetFileName(entry.fileName));
        skipped.push(entry.fileName);
        continue;
      }
      throw error;
    }
  }
  return { restored, skipped };
}

export async function deleteDirectoryAsset(filePath: string, dir: string, extensions: readonly string[]): Promise<void> {
  const target = assertDirectoryAssetPath(filePath, dir, extensions);
  await fs.unlink(target);
}

export async function deleteDirectoryAssets(filePaths: readonly string[], dir: string, extensions: readonly string[]): Promise<void> {
  for (const filePath of filePaths) {
    await deleteDirectoryAsset(filePath, dir, extensions);
  }
}

export function expandHomePath(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  return input;
}

export function builtInAssetNameSet(entries: readonly DirectoryAsset[]): Set<string> {
  return new Set(entries.map((entry) => normalizeAssetFileName(entry.fileName)));
}

export function isMatchingBuiltInAsset(filePath: string, builtInFileNames: ReadonlySet<string>): boolean {
  return builtInFileNames.has(normalizeAssetFileName(path.basename(filePath)));
}

export function matchingBuiltInAssetFileNames(filePaths: readonly string[], builtInFileNames: ReadonlySet<string>): string[] {
  return filePaths
    .map((filePath) => path.basename(filePath))
    .filter((fileName) => builtInFileNames.has(normalizeAssetFileName(fileName)));
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

function directoryAssetFromFileName(dir: string, fileName: string): DirectoryAsset {
  const extension = path.extname(fileName).toLowerCase();
  return {
    extension,
    fileName,
    path: path.join(dir, fileName)
  };
}

function compareAssetFileNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function isSameAssetFileName(left: string, right: string): boolean {
  return normalizeAssetFileName(left) === normalizeAssetFileName(right);
}

function normalizeAssetFileName(fileName: string): string {
  return fileName.toLowerCase();
}
