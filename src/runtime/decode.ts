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

// Formats detectFormat can name but the app will not take. Both are readable by Sharp
// and neither can be written by it, so accepting them meant "Same as original" resolved
// to null and quietly produced a PNG — the app promising the source format and handing
// back another. Named individually rather than lumped into "unsupported" so the message
// can say which format it is and why, instead of implying the file is corrupt.
//
// heic additionally cannot be decoded at all by this Sharp build (format.heif.input
// accepts only .avif), so it was never openable regardless.
const READABLE_BUT_UNWRITABLE: Record<string, string> = {
  gif: "GIF",
  heic: "HEIC/HEIF"
};

export async function inspectSourceImage(bytes: Buffer): Promise<{ format: string; metadata: Metadata }> {
  const format = detectFormat(bytes);
  if (format === "unknown") {
    throw new Error("Unsupported image format. Convert the source image to JPEG, PNG, WebP, AVIF, or TIFF and retry.");
  }
  const unwritable = READABLE_BUT_UNWRITABLE[format];
  if (unwritable) {
    throw new Error(
      `${unwritable} is not supported: FotoReady can only save the formats it opens, and it cannot write ${unwritable}. Convert the image to JPEG, PNG, WebP, AVIF, or TIFF and retry.`
    );
  }

  let metadata: Metadata;
  try {
    const source = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
    metadata = await source.metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/pixel limit/i.test(message)) {
      throw new Error(`This ${format.toUpperCase()} image is too large to open (over ~1 gigapixel). Resize or crop it externally and retry.`);
    }
    throw new Error(`Couldn't decode this ${format.toUpperCase()} image. ${message}`);
  }

  // A multi-page TIFF is refused rather than quietly reduced to page 1. Sharp reads only
  // the first page, and now that TIFF is also an OUTPUT format, .tif in -> .tif out looks
  // like a round trip while the other pages are gone from the result. Refusing is the only
  // honest answer for a one-image-per-file editor: the alternative is a saved file that
  // claims to be the scan and is not. (Deliberately TIFF-only. An animated GIF loses its
  // frames the same way, but GIF cannot be written here, so nothing implies otherwise.)
  if (format === "tiff" && (metadata.pages ?? 1) > 1) {
    const pages = metadata.pages ?? 1;
    throw new Error(
      `This TIFF holds ${pages} pages. FotoReady edits one image per file — split it into single-page files and retry.`
    );
  }

  return { format, metadata };
}
