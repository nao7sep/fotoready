import type sharp from "sharp";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import type { OpCategory } from "@shared/types/op";
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

export function validateAssetOverlayParams(value: unknown, path: string): AssetOverlayParams {
  const record = assertParamsShape(value, ["assetPath", "x", "y", "opacity", "width", "rotation"], path);
  return {
    assetPath: assertString(record.assetPath, `${path}.assetPath`),
    x: assertFiniteNumber(record.x, `${path}.x`, { min: 0, max: 1 }),
    y: assertFiniteNumber(record.y, `${path}.y`, { min: 0, max: 1 }),
    opacity: assertFiniteNumber(record.opacity, `${path}.opacity`, { min: 0, max: 1 }),
    width: assertFiniteNumber(record.width, `${path}.width`, { min: 0, max: 1, minExclusive: true }),
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
  const rendered = await renderAssetBitmap(params.assetPath, width, params.opacity);
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
    width: rendered.width,
    height: rendered.height,
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
  const sharpImpl = (await import("sharp")).default;
  const metadata = await sharpImpl(assetPath, { limitInputPixels: false }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const aspectRatio = width > 0 && height > 0 ? width / height : DEFAULT_ASSET_OVERLAY_ASPECT_RATIO;
  assetAspectRatioCache.set(key, aspectRatio);
  return aspectRatio;
}

async function renderAssetBitmap(assetPath: string, width: number, opacity: number): Promise<RenderedAssetBitmap> {
  const key = `${normalizeAssetCacheKey(assetPath)}|${width}|${opacity.toFixed(4)}`;
  const cached = assetBitmapCache.get(key);
  if (cached) {
    return {
      ...cached,
      data: Buffer.from(cached.data)
    };
  }
  const sharpImpl = (await import("sharp")).default;
  const rendered = await sharpImpl(assetPath, { limitInputPixels: false })
    .resize({ width })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
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

function normalizeAssetCacheKey(assetPath: string): string {
  return assetPath.trim();
}
