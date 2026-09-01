import fs from "node:fs/promises";
import path from "node:path";
import { isBuiltinStampGroupId, type BuiltinStampGroupId } from "@shared/stamp-groups";

const CATALOG_FILE_NAME = "catalog.json";
const STAMP_FILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|svg)$/;
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
  const catalogPath = path.join(bundledStampsDir, CATALOG_FILE_NAME);
  const source = await fs.readFile(catalogPath, "utf8");
  const entries = parseBuiltinStampCatalog(JSON.parse(source) as unknown);
  assertBuiltinStampCatalogCompleteness(entries, assetFileNames);
  return entries;
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
    throw new Error(`catalog.stamps[${index}].file must be the slug plus .png or .svg.`);
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
