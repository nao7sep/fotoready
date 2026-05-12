import fs from "node:fs/promises";
import path from "node:path";
import type { Original } from "@shared/types/project";
import { sha256Bytes } from "@runtime/hash";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".heic", ".gif", ".tif", ".tiff"]);

export async function resolveOriginalSourcePath(original: Original, options: { projectPath: string | null; outputDir: string }): Promise<string> {
  if (await matchesOriginal(original.sourcePath, original.sourceHash)) {
    return original.sourcePath;
  }

  for await (const candidate of candidateFiles(original, options)) {
    if (candidate === original.sourcePath) continue;
    if (await matchesOriginal(candidate, original.sourceHash)) {
      original.sourcePath = candidate;
      return candidate;
    }
  }

  throw new Error(`Source file is missing and could not be recovered by hash: ${path.basename(original.sourcePath)}`);
}

async function* candidateFiles(original: Original, options: { projectPath: string | null; outputDir: string }): AsyncGenerator<string> {
  const dirs = candidateDirs(original, options);
  const seen = new Set<string>();
  for (const dir of dirs) {
    for await (const filePath of walkImages(dir, 3)) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      yield filePath;
    }
  }
}

function candidateDirs(original: Original, options: { projectPath: string | null; outputDir: string }): string[] {
  const dirs = [
    path.dirname(original.sourcePath),
    options.projectPath ? path.dirname(options.projectPath) : null,
    resolveOutputDir(options.outputDir, options.projectPath)
  ].filter((dir): dir is string => dir !== null);
  return [...new Set(dirs)];
}

function resolveOutputDir(outputDir: string, projectPath: string | null): string {
  if (path.isAbsolute(outputDir)) return outputDir;
  const baseDir = projectPath ? path.dirname(projectPath) : process.cwd();
  return path.resolve(baseDir, outputDir);
}

async function* walkImages(dir: string, depth: number): AsyncGenerator<string> {
  if (depth < 0) return;
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkImages(entryPath, depth - 1);
    } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield entryPath;
    }
  }
}

async function matchesOriginal(filePath: string, sourceHash: string): Promise<boolean> {
  try {
    const bytes = await fs.readFile(filePath);
    return sha256Bytes(bytes) === sourceHash;
  } catch {
    return false;
  }
}
