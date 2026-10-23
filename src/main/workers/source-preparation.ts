import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { nowIso } from "@shared/time";
import type { Original } from "@shared/types/project";
import type { AppLogger } from "@main/logger";
import { inspectSourceImage, uprightSize } from "@runtime/decode";
import { detectJpegQuality } from "@runtime/jpeg-quality";
import { sha256BytesYielding } from "@runtime/hash";
import { readSourceMetadataSummary } from "@adapters/exiftool";

export async function buildOriginal(sourcePath: string, enableJpegQualityEstimate: boolean, logger?: AppLogger): Promise<Original> {
  const bytes = await fs.readFile(sourcePath);
  const { format, metadata } = await inspectSourceImage(bytes);
  const jpegQualityEstimate = enableJpegQualityEstimate && format === "jpeg" ? detectJpegQuality(bytes).jpegQualityEstimate?.value ?? null : null;
  const metadataSummary = await readSourceMetadataSummary(sourcePath, logger);

  return {
    id: nanoid(),
    sourcePath: path.resolve(sourcePath),
    sourceHash: await sha256BytesYielding(bytes),
    size: bytes.byteLength,
    format,
    jpegQualityEstimate,
    metadataSummary,
    ...uprightSize(metadata),
    addedAt: nowIso()
  };
}
