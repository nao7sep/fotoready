import fs from "node:fs/promises";
import type sharp from "sharp";
import { clampAssetOverlay, type AssetOverlayParams } from "@shared/asset-overlay";
import type { OpCategory } from "@shared/types/op";
import { assertBoolean } from "@shared/validation/common";
import { MAX_INPUT_PIXELS } from "@runtime/decode";
import { applyTransformedOverlay, assertFiniteNumber, assertParamsShape, assertString } from "./_shared";
import type { OpApplyContext, OpModule } from "./op-module";

type RenderedAssetBitmap = {
  channels: 4;
  data: Buffer;
  height: number;
  width: number;
};

const assetAspectRatioCache = new Map<string, number>();
const assetBitmapCache = new Map<string, RenderedAssetBitmap>();
const ASSET_ASPECT_SAMPLE_WIDTH = 1024;

export function validateAssetOverlayParams(value: unknown, path: string): AssetOverlayParams {
  const record = assertParamsShape(value, ["assetPath", "x", "y", "width", "height", "lockAspectRatio", "flipHorizontal", "flipVertical", "opacity", "rotation"], path);
  return {
    assetPath: assertString(record.assetPath, `${path}.assetPath`),
    x: assertFiniteNumber(record.x, `${path}.x`, { min: 0, max: 1 }),
    y: assertFiniteNumber(record.y, `${path}.y`, { min: 0, max: 1 }),
    width: assertFiniteNumber(record.width, `${path}.width`, { min: 0, max: 1, minExclusive: true }),
    height: assertFiniteNumber(record.height, `${path}.height`, { min: 0, max: 1, minExclusive: true }),
    lockAspectRatio: assertBoolean(record.lockAspectRatio, `${path}.lockAspectRatio`),
    flipHorizontal: record.flipHorizontal === undefined ? false : assertBoolean(record.flipHorizontal, `${path}.flipHorizontal`),
    flipVertical: record.flipVertical === undefined ? false : assertBoolean(record.flipVertical, `${path}.flipVertical`),
    opacity: assertFiniteNumber(record.opacity, `${path}.opacity`, { min: 0, max: 1 }),
    rotation: assertFiniteNumber(record.rotation, `${path}.rotation`, { min: -180, max: 180 })
  };
}

export function createAssetOverlayModule(definition: {
  type: string;
  label: string;
  pickerLabel?: string;
  category: OpCategory;
  defaultParams: AssetOverlayParams;
}): OpModule<AssetOverlayParams> {
  return {
    ...definition,
    previewBehavior: "show-output",
    validate(value) {
      return validateAssetOverlayParams(value, `${definition.type}.params`);
    },
    async apply(image, params, ctx) {
      return applyAssetOverlay(image, params, ctx);
    }
  };
}

export async function applyAssetOverlay(image: sharp.Sharp, params: AssetOverlayParams, ctx: OpApplyContext) {
  if (!params.assetPath) return image;
  const longEdge = Math.max(ctx.sourceWidth, ctx.sourceHeight);
  const overlayParams = clampAssetOverlay(params, { maxX: ctx.sourceWidth / longEdge, maxY: ctx.sourceHeight / longEdge });
  const width = Math.max(1, Math.round(longEdge * overlayParams.width));
  const height = Math.max(1, Math.round(longEdge * overlayParams.height));
  const rendered = await renderAssetBitmap(
    overlayParams.assetPath,
    width,
    height,
    overlayParams.opacity,
    overlayParams.flipHorizontal,
    overlayParams.flipVertical
  );
  const sharpImpl = (await import("sharp")).default;
  const overlay = sharpImpl(rendered.data, {
    raw: {
      width: rendered.width,
      height: rendered.height,
      channels: 4
    }
  });
  return applyTransformedOverlay(image, overlay, {
    left: overlayParams.x * longEdge,
    top: overlayParams.y * longEdge,
    width,
    height,
    rotation: overlayParams.rotation
  });
}

export async function readAssetAspectRatio(assetPath: string): Promise<number> {
  if (!assetPath) return 1;
  const key = await assetCacheKey(assetPath);
  const cached = assetAspectRatioCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const rendered = await renderTrimmedAssetBitmap(assetPath, ASSET_ASPECT_SAMPLE_WIDTH, false);
  const aspectRatio = rendered.info.width > 0 && rendered.info.height > 0
    ? rendered.info.width / rendered.info.height
    : 1;
  assetAspectRatioCache.set(key, aspectRatio);
  return aspectRatio;
}

async function renderAssetBitmap(
  assetPath: string,
  width: number,
  height: number,
  opacity: number,
  flipHorizontal: boolean,
  flipVertical: boolean
): Promise<RenderedAssetBitmap> {
  const aspectRatio = await readAssetAspectRatio(assetPath);
  const sampleWidth = Math.max(width, Math.round(height * aspectRatio));
  const key = `${await assetCacheKey(assetPath)}|${sampleWidth}|${opacity.toFixed(4)}|${flipHorizontal ? "h" : "-"}${flipVertical ? "v" : "-"}`;
  const cached = assetBitmapCache.get(key);
  if (cached) {
    return {
      ...cached,
      data: Buffer.from(cached.data)
    };
  }
  const rendered = await renderTrimmedAssetBitmap(assetPath, sampleWidth, true);
  const pixels = Buffer.from(rendered.data);
  for (let index = 3; index < pixels.length; index += rendered.info.channels) {
    pixels[index] = Math.round((pixels[index] ?? 255) * opacity);
  }
  const flipped = await transformAssetPixels(pixels, rendered.info, flipHorizontal, flipVertical);
  const bitmap = {
    channels: 4 as const,
    data: flipped.data,
    height: flipped.info.height,
    width: flipped.info.width
  };
  assetBitmapCache.set(key, bitmap);
  return {
    ...bitmap,
    data: Buffer.from(bitmap.data)
  };
}

async function transformAssetPixels(
  pixels: Buffer,
  info: { width: number; height: number; channels: 4 },
  flipHorizontal: boolean,
  flipVertical: boolean
): Promise<{ data: Buffer; info: { width: number; height: number; channels: 4 } }> {
  if (!flipHorizontal && !flipVertical) {
    return { data: pixels, info };
  }
  const sharpImpl = (await import("sharp")).default;
  let image = sharpImpl(pixels, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  });
  if (flipHorizontal) image = image.flop();
  if (flipVertical) image = image.flip();
  const transformed = await image.raw().toBuffer({ resolveWithObject: true });
  return {
    data: Buffer.from(transformed.data),
    info: {
      width: transformed.info.width,
      height: transformed.info.height,
      channels: 4
    }
  };
}

async function renderTrimmedAssetBitmap(
  assetPath: string,
  width: number,
  allowEnlargement: boolean
): Promise<{ data: Buffer; info: { width: number; height: number; channels: 4 } }> {
  const sharpImpl = (await import("sharp")).default;
  const rendered = await sharpImpl(assetPath, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize({ width, withoutEnlargement: !allowEnlargement })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = alphaBounds(rendered.data, rendered.info.width, rendered.info.height, rendered.info.channels);
  if (!bounds) {
    return {
      data: Buffer.from([0, 0, 0, 0]),
      info: { width: 1, height: 1, channels: 4 }
    };
  }
  if (
    bounds.left === 0
    && bounds.top === 0
    && bounds.width === rendered.info.width
    && bounds.height === rendered.info.height
  ) {
    return {
      data: Buffer.from(rendered.data),
      info: { width: rendered.info.width, height: rendered.info.height, channels: 4 }
    };
  }
  const trimmed = await sharpImpl(rendered.data, {
    raw: {
      width: rendered.info.width,
      height: rendered.info.height,
      channels: rendered.info.channels
    }
  })
    .extract(bounds)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: Buffer.from(trimmed.data),
    info: { width: trimmed.info.width, height: trimmed.info.height, channels: 4 }
  };
}

// Cache key includes the file's size + mtime so replacing or re-importing a stamp at the
// same path invalidates the cached aspect ratio and bitmap. Keying by path alone made the
// overlay keep an old (e.g. square placeholder) shape after the file was swapped, even though
// the picker — which keys on size+mtime — already showed the new art.
async function assetCacheKey(assetPath: string): Promise<string> {
  const normalized = assetPath.trim();
  try {
    const stat = await fs.stat(normalized);
    return `${normalized}\0${stat.size}\0${stat.mtimeMs}`;
  } catch {
    return normalized;
  }
}

function alphaBounds(data: Buffer, width: number, height: number, channels: number): { left: number; top: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + 3] ?? 0;
      if (alpha <= 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    return null;
  }
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}
