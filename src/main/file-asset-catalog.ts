import fs from "node:fs/promises";
import path from "node:path";

export type DirectoryAsset = {
  extension: string;
  name: string;
  path: string;
};

export async function listDirectoryAssets(dir: string, extensions: readonly string[]): Promise<DirectoryAsset[]> {
  await fs.mkdir(dir, { recursive: true });
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
  const desiredBase = path.basename(absoluteSource, path.extname(absoluteSource));
  const targetPath = await uniqueAssetPath(dir, desiredBase, extension, defaultBaseName);
  if (absoluteSource !== targetPath) {
    await fs.copyFile(absoluteSource, targetPath);
  }
  return {
    extension,
    name: path.basename(targetPath, path.extname(targetPath)),
    path: targetPath
  };
}

export function expandHomePath(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  return input;
}

async function uniqueAssetPath(dir: string, baseName: string, extension: string, defaultBaseName: string): Promise<string> {
  const safeBase = baseName.trim().length > 0 ? baseName : defaultBaseName;
  let attempt = 0;
  while (attempt < 1000) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = path.join(dir, `${safeBase}${suffix}${extension}`);
    try {
      await fs.access(candidate);
      attempt += 1;
    } catch {
      return candidate;
    }
  }
  throw new Error("Could not find a free asset filename.");
}
