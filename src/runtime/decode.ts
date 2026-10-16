import fs from "node:fs/promises";
import sharp from "sharp";
import type { Metadata } from "sharp";
import { detectFormat } from "./format";
import type { Image } from "./image";

// No pixel limit (volume-handling-conventions, no fixed caps). The image library checks its limit
// against the size a file's own header states, so a limit guards only against a size, never against
// a file that lies; a photo too large for the machine fails inside the save, which contains it.
export const NO_PIXEL_LIMIT = { limitInputPixels: false } as const;

/**
 * The source image ready to edit. The image library reads the file itself, so a save never holds the
 * whole file in memory beside the decoded pixels (volume-handling-conventions, Data size).
 */
export async function decodeImage(sourcePath: string): Promise<{ image: Image }> {
  const { format, metadata } = await inspectSourceImage(await readHead(sourcePath), sourcePath);

  const normalized = sharp(sourcePath, NO_PIXEL_LIMIT).rotate().toColorspace("srgb");
  const { width, height } = uprightSize(metadata);

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

/**
 * The size the photo has once turned upright by its orientation tag, which is the size every edit
 * and the saved image see. The image library's own width and height are the stored, unturned size,
 * so a portrait phone photo would otherwise be measured on its side.
 */
export function uprightSize(metadata: Pick<Metadata, "width" | "height" | "autoOrient">): { width: number; height: number } {
  return {
    width: metadata.autoOrient?.width ?? metadata.width ?? 0,
    height: metadata.autoOrient?.height ?? metadata.height ?? 0
  };
}

/** The first bytes of a file, enough for its format's signature. */
async function readHead(sourcePath: string): Promise<Buffer> {
  const file = await fs.open(sourcePath, "r");
  try {
    const head = Buffer.alloc(32);
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/**
 * Checks that an image is one FotoReady edits: `head` is at least the file's first bytes, for its
 * format's signature, and `source` is its path or its whole bytes, for the image library.
 */
export async function inspectSourceImage(head: Buffer, source: Buffer | string = head): Promise<{ format: string; metadata: Metadata }> {
  const format = detectFormat(head);
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
    metadata = await sharp(source, NO_PIXEL_LIMIT).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
