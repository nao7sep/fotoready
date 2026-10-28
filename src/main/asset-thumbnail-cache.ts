import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AssetThumbnail } from "@shared/types/ipc";
import { NO_PIXEL_LIMIT } from "@runtime/decode";

type CacheEntry = { version: string; value: AssetThumbnail | Promise<AssetThumbnail> };

/**
 * One thumbnail per stamp file, so the cache holds at most the library; a new size or file version
 * replaces it, and library changes clear it. Reopening the picker or switching its group asks for
 * every visible thumbnail again: the bundled 363 stamps take 0.7 s six at a time to render and are
 * immediate from here.
 */
export class AssetThumbnailCache {
  private readonly entries = new Map<string, CacheEntry>();

  clear(): void { this.entries.clear(); }

  async get(assetPath: string, longEdge?: number): Promise<AssetThumbnail> {
    const size = thumbnailSize(longEdge);
    const resolvedPath = path.resolve(assetPath);
    const version = await thumbnailVersion(resolvedPath, size);
    const cached = this.entries.get(resolvedPath);
    if (cached?.version === version) return cached.value;

    const pending = renderThumbnail(assetPath, size);
    const entry: CacheEntry = { version, value: pending };
    this.entries.set(resolvedPath, entry);
    try {
      const thumbnail = await pending;
      if (this.entries.get(resolvedPath) === entry) entry.value = thumbnail;
      return thumbnail;
    } catch (error) {
      if (this.entries.get(resolvedPath) === entry) this.entries.delete(resolvedPath);
      throw error;
    }
  }
}

function thumbnailSize(longEdge?: number): number {
  return Number.isFinite(longEdge) ? Math.max(32, Math.min(512, Math.round(longEdge ?? 160))) : 160;
}

async function thumbnailVersion(resolvedPath: string, longEdge: number): Promise<string> {
  const stat = await fs.stat(resolvedPath);
  return [stat.size, stat.mtimeMs, longEdge].join("\0");
}

async function renderThumbnail(assetPath: string, longEdge: number): Promise<AssetThumbnail> {
  const isSvg = path.extname(assetPath).toLowerCase() === ".svg";
  // Letterbox onto a square (longEdge × longEdge) canvas with transparent padding so the whole
  // stamp is visible inside the 1:1 preview cell. `fit: "contain"` keeps the art's aspect ratio
  // and pads to a square, so a tall stamp like the cat fills the cell without being cropped —
  // regardless of how the cell's <img> is sized.
  const { data, info } = await sharp(assetPath, NO_PIXEL_LIMIT)
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
