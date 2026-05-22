import fs from "node:fs/promises";
import { exiftool, type WriteTags } from "exiftool-vendored";
import type { SourceMetadataSummary } from "@shared/types/project";
import type { MetadataFields, MetadataStripMode } from "@shared/types/settings";

const APP_SOFTWARE_TAG = "FotoReady";

// Tags shown in the source-metadata summary. ModifyDate is intentionally excluded:
// this app re-stamps it on every save, so it never carries source content into output
// and should not contribute to the privacy warning.
const DATE_TAGS = ["DateTimeOriginal", "CreateDate"] as const;
const GPS_TAGS = [
  "GPSLatitude",
  "GPSLatitudeRef",
  "GPSLongitude",
  "GPSLongitudeRef",
  "GPSAltitude",
  "GPSAltitudeRef",
  "GPSDateStamp",
  "GPSTimeStamp",
  "GPSMapDatum",
  "GPSImgDirection",
  "GPSImgDirectionRef",
  "GPSDestLatitude",
  "GPSDestLatitudeRef",
  "GPSDestLongitude",
  "GPSDestLongitudeRef",
  "GPSDestBearing",
  "GPSDestBearingRef"
] as const;

const EDITORIAL_TAGS = [
  "EXIF:Artist", "IPTC:By-line", "XMP-dc:Creator",
  "EXIF:Copyright", "IPTC:CopyrightNotice", "XMP-dc:Rights",
  "XMP-xmpRights:WebStatement", "XMP-xmpRights:UsageTerms",
  "IPTC:Credit", "XMP-photoshop:Credit",
  "IPTC:Source", "XMP-photoshop:Source",
  "XMP-iptcCore:CiEmailWork", "XMP-iptcCore:CiUrlWork",
  "EXIF:ImageDescription", "IPTC:Caption-Abstract", "XMP-dc:Description"
] as const;

// Fields that no longer describe the output after this app re-encodes the image.
// Always cleared regardless of strip policy.
const ALWAYS_STALE_TAGS = {
  ThumbnailImage: null,
  PreviewImage: null,
  JpgFromRaw: null,
  Orientation: null,
  ImageWidth: null,
  ImageHeight: null,
  ExifImageWidth: null,
  ExifImageHeight: null,
  PixelXDimension: null,
  PixelYDimension: null,
  ICC_Profile: null,
  "MakerNotes:all": null
} as unknown as WriteTags;

export type ApplyMetadataInput = {
  outputPath: string;
  sourcePath: string;
  stripActive: boolean;
  keep: MetadataStripMode;
  injectFields: MetadataFields;
  savedAt: Date;
  writeSoftwareTag: boolean;
  writeModifyDate: boolean;
};

/**
 * Sets the output file's metadata for a save. Default: copy all source metadata, clear
 * fields that are no longer accurate after re-encoding, and optionally stamp this app
 * as Software / set ModifyDate to the save time (both opt-out via settings).
 * When `stripActive`, additionally strip every group not in `keep`.
 * `injectFields` are written last and win over any same-named source values.
 */
export async function applyMetadataToOutput(input: ApplyMetadataInput): Promise<void> {
  const { outputPath, sourcePath, stripActive, keep, injectFields, savedAt, writeSoftwareTag, writeModifyDate } = input;
  const modifyDate = exifDate(savedAt);

  // Pass 1: copy every tag from the source. Use a no-op write target (just the args)
  // when both stamps are off — exiftool-vendored requires the tags object, but it can
  // be empty as long as the args carry the -TagsFromFile copy.
  const pass1Tags: Record<string, string> = {};
  if (writeSoftwareTag) pass1Tags.Software = APP_SOFTWARE_TAG;
  if (writeModifyDate) pass1Tags.ModifyDate = modifyDate;
  await exiftool.write(
    outputPath,
    pass1Tags as WriteTags,
    ["-TagsFromFile", sourcePath, "-all:all", "-overwrite_original"]
  );
  await removeExiftoolOriginal(outputPath);

  // Pass 2: clear always-stale tags + any user-requested strip groups.
  const cleanup: Record<string, string | null> = { ...(ALWAYS_STALE_TAGS as Record<string, null>) };
  if (stripActive) {
    if (!keep.includes("editorial")) {
      for (const tag of EDITORIAL_TAGS) cleanup[tag] = null;
    }
    if (!keep.includes("dates")) {
      cleanup.DateTimeOriginal = null;
      cleanup.CreateDate = null;
    }
    if (!keep.includes("gps")) {
      cleanup["GPS:all"] = null;
    }
  }
  // Re-stamp or clear Software/ModifyDate. When off, explicitly null so any source
  // value doesn't leak through. When on, re-stamp in case Pass 1's copy clobbered them.
  cleanup.Software = writeSoftwareTag ? APP_SOFTWARE_TAG : null;
  cleanup.ModifyDate = writeModifyDate ? modifyDate : null;

  await exiftool.write(outputPath, cleanup as unknown as WriteTags, ["-overwrite_original"]);
  await removeExiftoolOriginal(outputPath);

  // Pass 3: inject user-configured fields.
  if (Object.keys(injectFields).length > 0) {
    await injectMetadata(outputPath, injectFields);
  }
}

export async function readSourceMetadataSummary(sourcePath: string): Promise<SourceMetadataSummary> {
  try {
    const tags = await exiftool.read(sourcePath);
    return metadataSummaryFromTags(tags as Record<string, unknown>);
  } catch {
    return emptyMetadataSummary();
  }
}

export async function injectMetadata(outputPath: string, fields: MetadataFields): Promise<void> {
  const tags = metadataFieldsToTags(fields);
  if (Object.keys(tags).length === 0) return;
  await exiftool.write(outputPath, tags, ["-overwrite_original"]);
  await removeExiftoolOriginal(outputPath);
}

function metadataFieldsToTags(fields: MetadataFields): WriteTags {
  const tags: Record<string, string | string[] | boolean> = {};
  assign(tags, ["EXIF:Artist", "IPTC:By-line", "XMP-dc:Creator"], fields.author);
  assign(tags, ["EXIF:Copyright", "IPTC:CopyrightNotice", "XMP-dc:Rights"], fields.copyright);
  assign(tags, ["XMP-xmpRights:WebStatement"], fields.webStatement);
  assign(tags, ["XMP-xmpRights:UsageTerms"], fields.usageTerms);
  assign(tags, ["IPTC:Credit", "XMP-photoshop:Credit"], fields.credit);
  assign(tags, ["IPTC:Source", "XMP-photoshop:Source"], fields.source);
  assign(tags, ["XMP-iptcCore:CiEmailWork"], fields.contactEmail);
  assign(tags, ["XMP-iptcCore:CiUrlWork"], fields.contactUrl);
  assign(tags, ["EXIF:ImageDescription", "IPTC:Caption-Abstract", "XMP-dc:Description"], fields.description);
  if (Object.keys(tags).some((key) => key.startsWith("IPTC:"))) tags["IPTC:CodedCharacterSet"] = "UTF8";
  return tags as WriteTags;
}

function assign(target: Record<string, string | string[] | boolean>, keys: string[], value: string | undefined): void {
  if (!value) return;
  for (const key of keys) {
    target[key] = key.endsWith("Creator") || key.endsWith("Rights") || key.endsWith("Description") ? [value] : value;
  }
}

async function removeExiftoolOriginal(outputPath: string): Promise<void> {
  await fs.rm(`${outputPath}_original`, { force: true });
}

function metadataFieldsFromTags(tags: Record<string, unknown>): MetadataFields {
  return {
    author: firstString(tags, ["Artist", "Creator", "By-line"]),
    copyright: firstString(tags, ["Copyright", "CopyrightNotice", "Rights"]),
    webStatement: firstString(tags, ["WebStatement"]),
    usageTerms: firstString(tags, ["UsageTerms"]),
    credit: firstString(tags, ["Credit"]),
    source: firstString(tags, ["Source"]),
    contactEmail: firstString(tags, ["CiEmailWork"]),
    contactUrl: firstString(tags, ["CiUrlWork"]),
    description: firstString(tags, ["ImageDescription", "Caption-Abstract", "Description"])
  };
}

function metadataSummaryFromTags(tags: Record<string, unknown>): SourceMetadataSummary {
  return {
    editorial: metadataFieldsFromTags(tags),
    dates: Object.fromEntries(DATE_TAGS.flatMap((key) => {
      const value = tagDate(tags[key]);
      return value ? [[dateLabel(key), value]] : [];
    })),
    gps: Object.fromEntries(GPS_TAGS.flatMap((key) => {
      const value = tagText(tags[key]);
      return value ? [[gpsLabel(key), value]] : [];
    }))
  };
}

function emptyMetadataSummary(): SourceMetadataSummary {
  return { editorial: {}, dates: {}, gps: {} };
}

function firstString(tags: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = tags[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const text = value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (text) return text.trim();
    }
  }
  return undefined;
}

function cleanTagString(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Exiftool appends "(rawValue)" to human-readable descriptions via its PrintConv
  // DEFAULT fallback (e.g. "Unknown ($val)", "Reserved ($val)"). When the raw value
  // is empty the parentheses contain nothing and add no information — strip them.
  const cleaned = trimmed.replace(/\s*\(\s*\)$/, "").trim();
  return cleaned || undefined;
}

function tagText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return exifDate(value);
  if (typeof value === "object" && "rawValue" in value && typeof value.rawValue === "string") return cleanTagString(value.rawValue);
  if (typeof value === "string" && value.trim()) return cleanTagString(value.trim());
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const text = value.map(tagText).filter((item): item is string => Boolean(item)).join(", ");
    return text || undefined;
  }
  return undefined;
}

function dateLabel(key: (typeof DATE_TAGS)[number]): string {
  if (key === "DateTimeOriginal") return "Captured";
  return "Created";
}

function gpsLabel(key: (typeof GPS_TAGS)[number]): string {
  return key.replace(/^GPS/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function tagDate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return exifDate(value);
  if (typeof value === "object" && "rawValue" in value && typeof value.rawValue === "string") return value.rawValue;
  return typeof value === "string" ? value : undefined;
}

function exifDate(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
