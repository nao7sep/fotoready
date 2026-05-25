import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export type DirectoryAsset = {
  extension: string;
  name: string;
  path: string;
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
    .map((entry) => ({
      extension: path.extname(entry.name).toLowerCase(),
      name: path.basename(entry.name, path.extname(entry.name)),
      path: path.join(dir, entry.name)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function importDirectoryAsset(
  filePath: string,
  dir: string,
  extensions: readonly string[],
  defaultBaseName: string
): Promise<DirectoryAsset> {
  const extension = path.extname(filePath).toLowerCase();
  if (!extensions.map((item) => item.toLowerCase()).includes(extension)) {
    throw new Error(`Only ${extensions.join(", ")} files can be imported.`);
  }
  await fs.mkdir(dir, { recursive: true });
  const absoluteSource = path.resolve(filePath);
  const sourceHash = await fileSha256(absoluteSource);
  const existing = await readDirectoryAssets(dir, extensions);
  const existingHashes = await Promise.all(existing.map(async (entry) => ({
    entry,
    hash: await fileSha256(entry.path).catch(() => null)
  })));
  const duplicate = existingHashes.find((item) => item.hash === sourceHash);
  if (duplicate) return duplicate.entry;

  const desiredBase = path.basename(absoluteSource, path.extname(absoluteSource));
  const targetPath = await reserveUniqueAssetPath(dir, desiredBase, extension, defaultBaseName);
  if (absoluteSource !== targetPath) {
    try {
      await fs.copyFile(absoluteSource, targetPath);
    } catch (error) {
      await fs.unlink(targetPath).catch(() => undefined);
      throw error;
    }
  }
  return {
    extension,
    name: path.basename(targetPath, path.extname(targetPath)),
    path: targetPath
  };
}

export async function importDirectoryAssets(
  filePaths: readonly string[],
  dir: string,
  extensions: readonly string[],
  defaultBaseName: string
): Promise<DirectoryAsset[]> {
  return Promise.all(filePaths.map((filePath) => importDirectoryAsset(filePath, dir, extensions, defaultBaseName)));
}

export async function restoreDirectoryAssets(
  sourceDir: string,
  targetDir: string,
  extensions: readonly string[]
): Promise<RestoreDirectoryAssetsResult> {
  await fs.mkdir(targetDir, { recursive: true });
  const sourceEntries = await readDirectoryAssets(sourceDir, extensions);
  const existingEntries = await readDirectoryAssets(targetDir, extensions);
  const existingHashes = new Set(
    (await Promise.all(existingEntries.map((entry) => fileSha256(entry.path).catch(() => null))))
      .filter((hash): hash is string => hash !== null)
  );
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const entry of sourceEntries) {
    const sourceHash = await fileSha256(entry.path).catch(() => null);
    if (sourceHash !== null && existingHashes.has(sourceHash)) {
      skipped.push(`${entry.name}${entry.extension}`);
      continue;
    }
    const targetPath = path.join(targetDir, `${entry.name}${entry.extension}`);
    try {
      const handle = await fs.open(targetPath, "wx");
      await handle.close();
      await fs.copyFile(entry.path, targetPath);
      if (sourceHash !== null) existingHashes.add(sourceHash);
      restored.push(`${entry.name}${entry.extension}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        skipped.push(`${entry.name}${entry.extension}`);
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
  hashCache.delete(target);
}

export function expandHomePath(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  return input;
}

export async function builtInAssetKeySet(entries: readonly DirectoryAsset[]): Promise<Set<string>> {
  const keys = await Promise.all(entries.map(async (entry) => assetIdentityKey(entry)));
  return new Set(keys);
}

export async function isMatchingBuiltInAsset(filePath: string, builtInKeys: ReadonlySet<string>): Promise<boolean> {
  const extension = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath, path.extname(filePath));
  const hash = await fileSha256(filePath).catch(() => null);
  return hash !== null && builtInKeys.has(assetIdentityKeyFromParts(name, extension, hash));
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

async function reserveUniqueAssetPath(dir: string, baseName: string, extension: string, defaultBaseName: string): Promise<string> {
  const safeBase = baseName.trim().length > 0 ? baseName : defaultBaseName;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = path.join(dir, `${safeBase}${suffix}${extension}`);
    try {
      const handle = await fs.open(candidate, "wx");
      await handle.close();
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Could not find a free asset filename.");
}

async function assetIdentityKey(entry: DirectoryAsset): Promise<string> {
  return assetIdentityKeyFromParts(entry.name, entry.extension, await fileSha256(entry.path));
}

function assetIdentityKeyFromParts(name: string, extension: string, hash: string): string {
  return `${name}${extension.toLowerCase()}:${hash}`;
}

type HashCacheEntry = {
  size: number;
  mtimeMs: number;
  hash: string;
};

const hashCache = new Map<string, HashCacheEntry>();

async function fileSha256(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  const cached = hashCache.get(filePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.hash;
  }
  const hash = await streamSha256(filePath);
  hashCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, hash });
  return hash;
}

function streamSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", () => resolve(hash.digest("hex")));
    stream.once("error", reject);
  });
}
