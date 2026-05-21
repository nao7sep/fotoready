export type AssetOverlayParams = {
  assetPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lockAspectRatio: boolean;
  opacity: number;
  rotation: number;
};

export const DEFAULT_ASSET_OVERLAY_ASPECT_RATIO = 1.5;
export const DEFAULT_ASSET_OVERLAY_WIDTH = 0.15;
export const DEFAULT_ASSET_OVERLAY_HEIGHT = DEFAULT_ASSET_OVERLAY_WIDTH / DEFAULT_ASSET_OVERLAY_ASPECT_RATIO;
export const MIN_ASSET_OVERLAY_SIZE = 0.01;

type OverlayBounds = { maxX: number; maxY: number };
type SizeDriver = "width" | "height";

export function normalizeAssetAspectRatio(aspectRatio: number | null | undefined): number {
  return typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0.01
    ? aspectRatio
    : DEFAULT_ASSET_OVERLAY_ASPECT_RATIO;
}

export function assetOverlayHeight(width: number, aspectRatio: number | null | undefined): number {
  return width / normalizeAssetAspectRatio(aspectRatio);
}

export function assetOverlayWidth(height: number, aspectRatio: number | null | undefined): number {
  return height * normalizeAssetAspectRatio(aspectRatio);
}

export function normalizeAssetOverlay<T extends Partial<AssetOverlayParams>>(
  params: T,
  bounds: OverlayBounds,
  aspectRatio: number | null | undefined,
  minSize: number
): T {
  const normalizedAspectRatio = normalizeAssetAspectRatio(aspectRatio);
  const lockAspectRatio = params.lockAspectRatio ?? true;
  const width = readPositive(params.width, DEFAULT_ASSET_OVERLAY_WIDTH);
  const height = readPositive(params.height, DEFAULT_ASSET_OVERLAY_HEIGHT);
  const driver: SizeDriver = isPositive(params.width) ? "width" : "height";
  const size = lockAspectRatio
    ? fitLockedSize({ width, height }, bounds, normalizedAspectRatio, minSize, driver)
    : clampFreeSize({ width, height }, bounds, minSize);
  return {
    ...params,
    lockAspectRatio,
    width: size.width,
    height: size.height,
    x: clamp(readFinite(params.x, 0), 0, Math.max(0, bounds.maxX - size.width)),
    y: clamp(readFinite(params.y, 0), 0, Math.max(0, bounds.maxY - size.height))
  };
}

function fitLockedSize(
  requested: { width: number; height: number },
  bounds: OverlayBounds,
  aspectRatio: number,
  minSize: number,
  driver: SizeDriver
): { width: number; height: number } {
  let width = readPositive(requested.width, DEFAULT_ASSET_OVERLAY_WIDTH);
  let height = readPositive(requested.height, DEFAULT_ASSET_OVERLAY_HEIGHT);

  if (driver === "height") {
    height = clampDimension(height, bounds.maxY, minSize);
    width = assetOverlayWidth(height, aspectRatio);
  } else {
    width = clampDimension(width, bounds.maxX, minSize);
    height = assetOverlayHeight(width, aspectRatio);
  }

  const widthScale = bounds.maxX / Math.max(width, 0.000001);
  const heightScale = bounds.maxY / Math.max(height, 0.000001);
  const scale = Math.min(1, widthScale, heightScale);
  width *= scale;
  height *= scale;

  return {
    width: clampDimension(width, bounds.maxX, minSize),
    height: clampDimension(height, bounds.maxY, minSize)
  };
}

function clampFreeSize(
  requested: { width: number; height: number },
  bounds: OverlayBounds,
  minSize: number
): { width: number; height: number } {
  return {
    width: clampDimension(readPositive(requested.width, DEFAULT_ASSET_OVERLAY_WIDTH), bounds.maxX, minSize),
    height: clampDimension(readPositive(requested.height, DEFAULT_ASSET_OVERLAY_HEIGHT), bounds.maxY, minSize)
  };
}

function readFinite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readPositive(value: number | undefined, fallback: number): number {
  return isPositive(value) ? value : fallback;
}

function isPositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampDimension(value: number, max: number, minSize: number): number {
  return clamp(value, Math.min(minSize, max), max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
