import fs from "node:fs/promises";
import sharp from "sharp";
import { detectFormat } from "./format";
import type { Image } from "./image";

export async function decodeImage(sourcePath: string): Promise<{ image: Image }> {
  const bytes = await fs.readFile(sourcePath);
  const { format, metadata } = await inspectSourceImage(bytes);

  const normalized = sharp(bytes, { limitInputPixels: false }).rotate().toColorspace("srgb");
  const normalizedMetadata = await normalized.metadata();
  const width = normalizedMetadata.width ?? metadata.width ?? 0;
  const height = normalizedMetadata.height ?? metadata.height ?? 0;

  return {
    image: { sharp: normalized, width, height, format }
  };
}

export async function inspectSourceImage(bytes: Buffer): Promise<{ format: string; metadata: sharp.Metadata }> {
  const format = detectFormat(bytes);
  if (format === "unknown") {
    throw new Error("Unsupported image format. Convert the source image to JPEG, PNG, WebP, AVIF, TIFF, GIF, or HEIC and retry.");
  }
  if (format === "heic" && !supportsHeicInput()) {
    throw new Error("HEIC/HEIF decoding is not available in this Sharp build. Convert the image to JPEG, PNG, WebP, AVIF, or TIFF and retry.");
  }

  try {
    const source = sharp(bytes, { limitInputPixels: false });
    return {
      format,
      metadata: await source.metadata()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't decode this ${format.toUpperCase()} image. ${message}`);
  }
}

function supportsHeicInput(): boolean {
  const suffixes = sharp.format.heif?.input?.fileSuffix ?? [];
  return suffixes.includes(".heic") || suffixes.includes(".heif");
}
