import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AssetThumbnail } from "@shared/types/ipc";
import { MAX_INPUT_PIXELS } from "@runtime/decode";

const MAX_THUMBNAIL_CACHE_ENTRIES = 512;

type CacheValue = AssetThumbnail | Promise<AssetThumbnail>;

export class AssetThumbnailCache {
  private readonly entries = new Map<string, CacheValue>();

  async get(assetPath: string, longEdge?: number): Promise<AssetThumbnail> {
    const size = thumbnailSize(longEdge);
    const key = await thumbnailCacheKey(assetPath, size);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }

    const pending = renderThumbnail(assetPath, size);
    this.entries.set(key, pending);
    this.trim();
    try {
      const thumbnail = await pending;
      this.entries.set(key, thumbnail);
      this.trim();
      return thumbnail;
    } catch (error) {
      if (this.entries.get(key) === pending) {
        this.entries.delete(key);
      }
      throw error;
    }
  }

  private trim(): void {
    while (this.entries.size > MAX_THUMBNAIL_CACHE_ENTRIES) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey === undefined) return;
      this.entries.delete(firstKey);
    }
  }
}

function thumbnailSize(longEdge?: number): number {
  return Number.isFinite(longEdge) ? Math.max(32, Math.min(512, Math.round(longEdge ?? 160))) : 160;
}

async function thumbnailCacheKey(assetPath: string, longEdge: number): Promise<string> {
  const resolvedPath = path.resolve(assetPath);
  const stat = await fs.stat(resolvedPath);
  return [resolvedPath, stat.size, stat.mtimeMs, longEdge].join("\0");
}

async function renderThumbnail(assetPath: string, longEdge: number): Promise<AssetThumbnail> {
  const isSvg = path.extname(assetPath).toLowerCase() === ".svg";
  // Letterbox onto a square (longEdge × longEdge) canvas with transparent padding so the whole
  // stamp is visible inside the 1:1 preview cell. `fit: "contain"` keeps the art's aspect ratio
  // and pads to a square, so a tall stamp like the cat fills the cell without being cropped —
  // regardless of how the cell's <img> is sized.
  const { data, info } = await sharp(assetPath, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize({ width: longEdge, height: longEdge, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: !isSvg })
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    dataUrl: `data:image/png;base64,${data.toString("base64")}`,
    width: info.width,
    height: info.height
  };
}
