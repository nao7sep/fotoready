import fs from "node:fs/promises";
import { exiftool, type WriteTags } from "exiftool-vendored";
import type { MetadataFields, MetadataStripMode } from "@shared/types/settings";

const RETAIN_BY_FIELD: Record<MetadataStripMode[number], string[]> = {
  author: ["Artist", "Creator", "By-line", "XMP-dc:Creator"],
  copyright: ["Copyright", "CopyrightNotice", "Rights", "XMP-dc:Rights"],
  orientation: ["Orientation"],
  colorspace: ["ColorSpace", "ICC_Profile", "ProfileDescription"]
};

export async function stripMetadata(outputPath: string, keep: MetadataStripMode): Promise<void> {
  const retain = keep.flatMap((field) => RETAIN_BY_FIELD[field] ?? []);
  await exiftool.deleteAllTags(outputPath, { retain });
  await removeExiftoolOriginal(outputPath);
  await exiftool.write(
    outputPath,
    {
      "GPS:all": null,
      ThumbnailImage: null,
      PreviewImage: null,
      JpgFromRaw: null
    } as WriteTags,
    ["-overwrite_original"]
  );
}

export async function injectMetadata(outputPath: string, fields: MetadataFields): Promise<void> {
  const tags = metadataFieldsToTags(fields);
  if (Object.keys(tags).length === 0) return;
  await exiftool.write(outputPath, tags, ["-overwrite_original"]);
}

export async function writeOutputDates(outputPath: string, sourcePath: string, preserveSourceDates: boolean, savedAt: Date): Promise<void> {
  const sourceDates = preserveSourceDates ? await readSourceDates(sourcePath) : null;
  const modifyDate = exifDate(savedAt);
  await exiftool.write(
    outputPath,
    {
      DateTimeOriginal: sourceDates?.dateTimeOriginal ?? modifyDate,
      CreateDate: sourceDates?.createDate ?? sourceDates?.dateTimeOriginal ?? modifyDate,
      ModifyDate: modifyDate
    } as WriteTags,
    ["-overwrite_original"]
  );
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

async function readSourceDates(sourcePath: string): Promise<{ dateTimeOriginal?: string; createDate?: string }> {
  try {
    const tags = await exiftool.read(sourcePath);
    return {
      dateTimeOriginal: tagDate(tags.DateTimeOriginal),
      createDate: tagDate(tags.CreateDate)
    };
  } catch {
    return {};
  }
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
