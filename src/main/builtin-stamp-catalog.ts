import fs from "node:fs/promises";
import path from "node:path";
import { fileNameFromPath } from "@shared/file-path";
import { isBuiltinStampGroupId, type BuiltinStampGroupId } from "@shared/stamp-groups";
import type { Pipeline } from "@shared/types/pipeline";

const CATALOG_FILE_NAME = "catalog.json";
const STAMP_FILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|svg|webp)$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type BuiltinStampCatalogEntry = {
  slug: string;
  file: string;
  group: BuiltinStampGroupId;
  label: string;
};

export async function readBuiltinStampCatalog(
  bundledStampsDir: string,
  assetFileNames: readonly string[]
): Promise<BuiltinStampCatalogEntry[]> {
  const entries = await readBuiltinStampCatalogEntries(bundledStampsDir);
  assertBuiltinStampCatalogCompleteness(entries, assetFileNames);
  return entries;
}

/** The catalogue alone, without checking it against the packaged files. */
export async function readBuiltinStampCatalogEntries(bundledStampsDir: string): Promise<BuiltinStampCatalogEntry[]> {
  const source = await fs.readFile(path.join(bundledStampsDir, CATALOG_FILE_NAME), "utf8");
  return parseBuiltinStampCatalog(JSON.parse(source) as unknown);
}

/**
 * The packaged file of the built-in a stamp file name stands for: a catalogued slug plus any stamp
 * extension, whichever format the built-in has now. Null for any other name.
 */
export function builtinStampPathFor(
  fileName: string,
  entries: readonly BuiltinStampCatalogEntry[],
  bundledStampsDir: string
): string | null {
  if (!STAMP_FILE_PATTERN.test(fileName)) return null;
  const entry = entries.find((candidate) => candidate.slug === path.parse(fileName).name);
  return entry ? path.join(bundledStampsDir, entry.file) : null;
}

export function parseBuiltinStampCatalog(value: unknown): BuiltinStampCatalogEntry[] {
  const root = objectValue(value, "catalog");
  if (root.version !== 1) {
    throw new Error("Built-in stamp catalog version must be 1.");
  }
  if (!Array.isArray(root.stamps)) {
    throw new Error("Built-in stamp catalog stamps must be an array.");
  }

  const entries = root.stamps.map((entry, index) => parseEntry(entry, index));
  const slugs = new Set<string>();
  const files = new Set<string>();
  for (const entry of entries) {
    if (slugs.has(entry.slug)) throw new Error(`Built-in stamp catalog duplicates slug "${entry.slug}".`);
    if (files.has(entry.file)) throw new Error(`Built-in stamp catalog duplicates file "${entry.file}".`);
    slugs.add(entry.slug);
    files.add(entry.file);
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (compareText(entries[index - 1].slug, entries[index].slug) > 0) {
      throw new Error("Built-in stamp catalog entries must be sorted alphabetically by slug.");
    }
  }
  return entries;
}

export function assertBuiltinStampCatalogCompleteness(
  entries: readonly BuiltinStampCatalogEntry[],
  assetFileNames: readonly string[]
): void {
  const catalogFiles = new Set(entries.map((entry) => entry.file));
  const assetFiles = new Set(assetFileNames);
  const missingAssets = entries.filter((entry) => !assetFiles.has(entry.file)).map((entry) => entry.file);
  const missingCatalogEntries = assetFileNames.filter((fileName) => !catalogFiles.has(fileName));
  if (missingAssets.length > 0 || missingCatalogEntries.length > 0) {
    const details = [
      missingAssets.length > 0 ? `missing assets: ${missingAssets.join(", ")}` : "",
      missingCatalogEntries.length > 0 ? `uncatalogued assets: ${missingCatalogEntries.join(", ")}` : ""
    ].filter(Boolean).join("; ");
    throw new Error(`Built-in stamp catalog does not match packaged assets (${details}).`);
  }
}

/**
 * Points each stamp op whose file is gone at the current built-in its file name stands for, so a task
 * saved before the built-ins changed format, or under another install location, finds its stamp
 * again. A missing file that names no built-in is left as saved.
 */
export async function relinkMissingBuiltinStamps(pipeline: Pipeline, bundledStampsDir: string): Promise<Pipeline> {
  let entries: BuiltinStampCatalogEntry[] | null = null;
  const ops: Pipeline["ops"] = [];
  for (const op of pipeline.ops) {
    const assetPath = op.type === "stamp" ? op.params.assetPath : undefined;
    if (typeof assetPath !== "string" || !assetPath || await fileExists(assetPath)) {
      ops.push(op);
      continue;
    }
    entries ??= await readBuiltinStampCatalogEntries(bundledStampsDir);
    const current = builtinStampPathFor(fileNameFromPath(assetPath), entries, bundledStampsDir);
    ops.push(current ? { ...op, params: { ...op.params, assetPath: current } } : op);
  }
  return { ...pipeline, ops };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseEntry(value: unknown, index: number): BuiltinStampCatalogEntry {
  const entry = objectValue(value, `catalog.stamps[${index}]`);
  const slug = stringValue(entry.slug, `catalog.stamps[${index}].slug`);
  const file = stringValue(entry.file, `catalog.stamps[${index}].file`);
  const group = stringValue(entry.group, `catalog.stamps[${index}].group`);
  const label = stringValue(entry.label, `catalog.stamps[${index}].label`);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`catalog.stamps[${index}].slug must be an ASCII kebab-case slug.`);
  }
  if (!STAMP_FILE_PATTERN.test(file) || path.parse(file).name !== slug) {
    throw new Error(`catalog.stamps[${index}].file must be the slug plus .png, .svg or .webp.`);
  }
  if (!isBuiltinStampGroupId(group)) {
    throw new Error(`catalog.stamps[${index}].group is not a built-in stamp group.`);
  }
  return { slug, file, group, label };
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`${field} must be a non-empty trimmed string.`);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}
