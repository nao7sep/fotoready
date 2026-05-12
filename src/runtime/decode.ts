import fs from "node:fs/promises";
import sharp from "sharp";
import { detectFormat } from "./format";
import type { DecodeFacts, Image } from "./image";

export async function decodeImage(sourcePath: string): Promise<{ image: Image; facts: DecodeFacts }> {
  const bytes = await fs.readFile(sourcePath);
  const format = detectFormat(bytes);
  const source = sharp(bytes, { limitInputPixels: false });
  const metadata = await source.metadata();
  const colorSpaceTag = inferColorSpaceTag(metadata.space ?? null);
  const orientation = metadata.orientation ?? 1;

  const normalized = sharp(bytes, { limitInputPixels: false }).rotate().toColorspace("srgb");
  const normalizedMetadata = await normalized.metadata();
  const width = normalizedMetadata.width ?? metadata.width ?? 0;
  const height = normalizedMetadata.height ?? metadata.height ?? 0;

  return {
    image: {
      sharp: normalized,
      width,
      height,
      format
    },
    facts: {
      format,
      width,
      height,
      orientation,
      iccProfile: metadata.icc ?? null,
      iccProfileSummary: metadata.icc ? "embedded" : null,
      colorSpaceTag,
      exif: {
        colorSpace: null,
        interopIndex: null,
        dateTimeOriginal: null,
        createDate: null,
        offsetTimeOriginal: null
      },
      jpegQualityEstimate: null
    }
  };
}

function inferColorSpaceTag(space: string | null): DecodeFacts["colorSpaceTag"] {
  if (!space) return null;
  if (space.toLowerCase() === "srgb") return "srgb";
  if (space.toLowerCase().includes("rgb16")) return "uncalibrated";
  return null;
}
