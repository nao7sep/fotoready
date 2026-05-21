import type sharp from "sharp";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import type { OpCategory } from "@shared/types/op";
import { assertBoolean } from "@shared/validation/common";
import { DEFAULT_ASSET_OVERLAY_ASPECT_RATIO } from "@shared/asset-overlay";
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
  const record = assertParamsShape(value, ["assetPath", "x", "y", "width", "height", "lockAspectRatio", "opacity", "rotation"], path);
  return {
    assetPath: assertString(record.assetPath, `${path}.assetPath`),
    x: assertFiniteNumber(record.x, `${path}.x`, { min: 0, max: 1 }),
    y: assertFiniteNumber(record.y, `${path}.y`, { min: 0, max: 1 }),
    width: assertFiniteNumber(record.width, `${path}.width`, { min: 0, max: 1, minExclusive: true }),
    height: assertFiniteNumber(record.height, `${path}.height`, { min: 0, max: 1, minExclusive: true }),
    lockAspectRatio: assertBoolean(record.lockAspectRatio, `${path}.lockAspectRatio`),
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
  const width = Math.max(1, Math.round(longEdge * params.width));
  const height = Math.max(1, Math.round(longEdge * params.height));
  const rendered = await renderAssetBitmap(params.assetPath, width, height, params.opacity);
  const sharpImpl = (await import("sharp")).default;
  const overlay = sharpImpl(rendered.data, {
    raw: {
      width: rendered.width,
      height: rendered.height,
      channels: 4
    }
  });
  return applyTransformedOverlay(image, overlay, {
    left: params.x * longEdge,
    top: params.y * longEdge,
    width,
    height,
    rotation: params.rotation
  });
}

export async function readAssetAspectRatio(assetPath: string): Promise<number> {
  if (!assetPath) return DEFAULT_ASSET_OVERLAY_ASPECT_RATIO;
  const key = normalizeAssetCacheKey(assetPath);
  const cached = assetAspectRatioCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const rendered = await renderTrimmedAssetBitmap(assetPath, ASSET_ASPECT_SAMPLE_WIDTH, false);
  const aspectRatio = rendered.info.width > 0 && rendered.info.height > 0
    ? rendered.info.width / rendered.info.height
    : DEFAULT_ASSET_OVERLAY_ASPECT_RATIO;
  assetAspectRatioCache.set(key, aspectRatio);
  return aspectRatio;
}

async function renderAssetBitmap(assetPath: string, width: number, height: number, opacity: number): Promise<RenderedAssetBitmap> {
  const aspectRatio = await readAssetAspectRatio(assetPath);
  const sampleWidth = Math.max(width, Math.round(height * aspectRatio));
  const key = `${normalizeAssetCacheKey(assetPath)}|${sampleWidth}|${opacity.toFixed(4)}`;
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
  const bitmap = {
    channels: 4 as const,
    data: pixels,
    height: rendered.info.height,
    width: rendered.info.width
  };
  assetBitmapCache.set(key, bitmap);
  return {
    ...bitmap,
    data: Buffer.from(bitmap.data)
  };
}

async function renderTrimmedAssetBitmap(
  assetPath: string,
  width: number,
  allowEnlargement: boolean
): Promise<{ data: Buffer; info: { width: number; height: number; channels: 4 } }> {
  const sharpImpl = (await import("sharp")).default;
  const rendered = await sharpImpl(assetPath, { limitInputPixels: false })
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

function normalizeAssetCacheKey(assetPath: string): string {
  return assetPath.trim();
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
