import { DEFAULT_STAMP_FOLDER } from "@shared/constants";
import type { StampEntry } from "@shared/types/ipc";
import { expandHomePath, importDirectoryAsset, listDirectoryAssets } from "./file-asset-catalog";

const STAMP_EXTENSIONS = [".png", ".svg"] as const;

export async function listStamps(homeDir: string): Promise<StampEntry[]> {
  const dir = expandHomePath(DEFAULT_STAMP_FOLDER, homeDir);
  const entries = await listDirectoryAssets(dir, STAMP_EXTENSIONS);
  return entries.map((entry) => ({
    format: entry.extension.slice(1) as StampEntry["format"],
    name: entry.name,
    path: entry.path
  }));
}

export async function importStamp(filePath: string, homeDir: string): Promise<StampEntry> {
  const dir = expandHomePath(DEFAULT_STAMP_FOLDER, homeDir);
  const entry = await importDirectoryAsset(filePath, dir, STAMP_EXTENSIONS, "stamp");
  return {
    format: entry.extension.slice(1) as StampEntry["format"],
    name: entry.name,
    path: entry.path
  };
}
