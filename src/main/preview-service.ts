import sharp from "sharp";
import type { Original } from "@shared/types/project";

export type OriginalThumbnail = {
  originalId: string;
  dataUrl: string;
  width: number;
  height: number;
};

export async function renderOriginalThumbnail(original: Original, longEdge = 160): Promise<OriginalThumbnail> {
  const image = sharp(original.sourcePath, { limitInputPixels: false }).rotate();
  const metadata = await image.metadata();
  const bytes = await image
    .resize({ width: longEdge, height: longEdge, fit: "cover" })
    .jpeg({ quality: 72 })
    .toBuffer();

  return {
    originalId: original.id,
    dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    width: metadata.width ?? original.width,
    height: metadata.height ?? original.height
  };
}
