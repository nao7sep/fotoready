import fs from "node:fs/promises";
import type { AppPaths } from "@main/paths";

export type CacheSizes = {
  sourceFactsBytes: number;
  visionFactsBytes: number;
};

export async function getCacheSizes(paths: AppPaths): Promise<CacheSizes> {
  return {
    sourceFactsBytes: await fileSize(paths.sourceFactsPath),
    visionFactsBytes: await fileSize(paths.visionFactsPath)
  };
}

export async function clearCaches(paths: AppPaths): Promise<void> {
  await Promise.all([
    fs.rm(paths.sourceFactsPath, { force: true }),
    fs.rm(paths.visionFactsPath, { force: true })
  ]);
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return 0;
  }
}
