import fs from "node:fs/promises";
import sharp from "sharp";
import type { Metadata } from "sharp";
import { detectFormat } from "./format";
import type { Image } from "./image";

// Hard upper bound on decoded pixels. Sharp's default of 268M pixels is too low for
// modern phone cameras but unbounded decoding lets a malformed or hostile file OOM
// the worker. 1 Gpix covers any realistic photo (~30000x30000) while still failing
// fast on absurd inputs.
export const MAX_INPUT_PIXELS = 1_000_000_000;

export async function decodeImage(sourcePath: string): Promise<{ image: Image }> {
  const bytes = await fs.readFile(sourcePath);
  const { format, metadata } = await inspectSourceImage(bytes);

  const normalized = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().toColorspace("srgb");
  const normalizedMetadata = await normalized.metadata();
  const width = normalizedMetadata.width ?? metadata.width ?? 0;
  const height = normalizedMetadata.height ?? metadata.height ?? 0;

  return {
    image: { sharp: normalized, width, height, format }
  };
}

export async function inspectSourceImage(bytes: Buffer): Promise<{ format: string; metadata: Metadata }> {
  const format = detectFormat(bytes);
  if (format === "unknown") {
    throw new Error("Unsupported image format. Convert the source image to JPEG, PNG, WebP, AVIF, TIFF, GIF, or HEIC and retry.");
  }
  if (format === "heic" && !supportsHeicInput()) {
    throw new Error("HEIC/HEIF decoding is not available in this Sharp build. Convert the image to JPEG, PNG, WebP, AVIF, or TIFF and retry.");
  }

  try {
    const source = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
    return {
      format,
      metadata: await source.metadata()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/pixel limit/i.test(message)) {
      throw new Error(`This ${format.toUpperCase()} image is too large to open (over ~1 gigapixel). Resize or crop it externally and retry.`);
    }
    throw new Error(`Couldn't decode this ${format.toUpperCase()} image. ${message}`);
  }
}

function supportsHeicInput(): boolean {
  const suffixes = sharp.format.heif?.input?.fileSuffix ?? [];
  return suffixes.includes(".heic") || suffixes.includes(".heif");
}
