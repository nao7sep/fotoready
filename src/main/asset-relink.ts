import fs from "node:fs/promises";
import path from "node:path";
import { fileNameFromPath } from "@shared/file-path";
import type { Pipeline } from "@shared/types/pipeline";
import { builtinStampPathFor, readBuiltinStampCatalogEntries, type BuiltinStampCatalogEntry } from "./builtin-stamp-catalog";

/** The folders a saved task's stamps and LUTs can be found in now. */
export type AssetFolders = {
  bundledStamps: string;
  /** The current imported-stamp folder, or null when it cannot be resolved. */
  importedStamps: string | null;
  bundledLuts: string | null;
  importedLuts: string | null;
};

/**
 * Points each stamp and LUT op whose file is gone at the file of the same name where it lives now, so
 * a task saved under another data root, install location, library folder or machine finds its assets
 * again (storage-path-conventions, Ownership decides location). A stamp is looked up first among the
 * built-ins, by the name its file stands for, then in the imported folder; a LUT in the imported
 * folder, then among the built-ins. Import keeps names unique across a library and its built-ins, so a
 * name finds at most one file. A missing file found nowhere is left as saved, and fails where it is
 * drawn as any missing asset does. Watermark images are files the user picked from anywhere, so they
 * are left as they are.
 */
export async function relinkMissingAssets(pipeline: Pipeline, folders: AssetFolders): Promise<Pipeline> {
  let builtinStamps: BuiltinStampCatalogEntry[] | null = null;
  const ops: Pipeline["ops"] = [];
  for (const op of pipeline.ops) {
    const key = op.type === "stamp" ? "assetPath" : op.type === "lut" ? "cubePath" : null;
    const saved = key === null ? undefined : op.params[key];
    if (key === null || typeof saved !== "string" || !saved || await fileExists(saved)) {
      ops.push(op);
      continue;
    }
    const fileName = fileNameFromPath(saved);
    let current: string | null = null;
    if (op.type === "stamp") {
      builtinStamps ??= await readBuiltinStampCatalogEntries(folders.bundledStamps);
      current = builtinStampPathFor(fileName, builtinStamps, folders.bundledStamps) ?? await existingIn(folders.importedStamps, fileName);
    } else {
      current = await existingIn(folders.importedLuts, fileName) ?? await existingIn(folders.bundledLuts, fileName);
    }
    ops.push(current ? { ...op, params: { ...op.params, [key]: current } } : op);
  }
  return { ...pipeline, ops };
}

async function existingIn(dir: string | null, fileName: string): Promise<string | null> {
  if (dir === null) return null;
  const candidate = path.join(dir, fileName);
  return (await fileExists(candidate)) ? candidate : null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
