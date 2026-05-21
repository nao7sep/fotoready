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
  let width = readPositive(params.width, DEFAULT_ASSET_OVERLAY_WIDTH);
  let height = readPositive(params.height, DEFAULT_ASSET_OVERLAY_HEIGHT);

  if (lockAspectRatio) {
    if (!isPositive(params.width) && isPositive(params.height)) {
      width = assetOverlayWidth(height, normalizedAspectRatio);
    }
    width = clampDimension(width, maxLockedWidth(bounds, normalizedAspectRatio), minSize);
    height = assetOverlayHeight(width, normalizedAspectRatio);
  } else {
    width = clampDimension(width, bounds.maxX, minSize);
    height = clampDimension(height, bounds.maxY, minSize);
  }

  return {
    ...params,
    lockAspectRatio,
    width,
    height,
    x: clamp(readFinite(params.x, 0), 0, Math.max(0, bounds.maxX - width)),
    y: clamp(readFinite(params.y, 0), 0, Math.max(0, bounds.maxY - height))
  };
}

export function updateAssetOverlay(
  currentOverlay: AssetOverlayParams,
  updates: Partial<AssetOverlayParams>,
  bounds: OverlayBounds,
  aspectRatio: number | null | undefined,
  minSize: number
): AssetOverlayParams {
  const normalizedAspectRatio = normalizeAssetAspectRatio(aspectRatio);
  const normalizedOverlay = normalizeAssetOverlay(currentOverlay, bounds, normalizedAspectRatio, minSize);
  const lockAspectRatio = updates.lockAspectRatio ?? normalizedOverlay.lockAspectRatio;

  if (isPositionOnlyUpdate(updates)) {
    return {
      ...normalizedOverlay,
      ...updates,
      x: clamp(readFinite(updates.x, normalizedOverlay.x), 0, Math.max(0, bounds.maxX - normalizedOverlay.width)),
      y: clamp(readFinite(updates.y, normalizedOverlay.y), 0, Math.max(0, bounds.maxY - normalizedOverlay.height))
    };
  }

  let x = clamp(readFinite(updates.x, normalizedOverlay.x), 0, bounds.maxX);
  let y = clamp(readFinite(updates.y, normalizedOverlay.y), 0, bounds.maxY);
  let width = readPositive(updates.width, normalizedOverlay.width);
  let height = readPositive(updates.height, normalizedOverlay.height);

  if (lockAspectRatio) {
    if (updates.height !== undefined && updates.width === undefined) {
      height = clampDimension(height, maxAssetOverlayHeightAtPosition(bounds, normalizedAspectRatio, true, x, y, minSize), minSize);
      width = assetOverlayWidth(height, normalizedAspectRatio);
      const maxWidth = maxAssetOverlayWidthAtPosition(bounds, normalizedAspectRatio, true, x, y, minSize);
      if (width > maxWidth) {
        width = clampDimension(width, maxWidth, minSize);
        height = assetOverlayHeight(width, normalizedAspectRatio);
      }
    } else {
      width = clampDimension(width, maxAssetOverlayWidthAtPosition(bounds, normalizedAspectRatio, true, x, y, minSize), minSize);
      height = assetOverlayHeight(width, normalizedAspectRatio);
      const maxHeight = maxAssetOverlayHeightAtPosition(bounds, normalizedAspectRatio, true, x, y, minSize);
      if (height > maxHeight) {
        height = clampDimension(height, maxHeight, minSize);
        width = assetOverlayWidth(height, normalizedAspectRatio);
      }
    }
  } else {
    width = clampDimension(width, Math.max(0.000001, bounds.maxX - x), minSize);
    height = clampDimension(height, Math.max(0.000001, bounds.maxY - y), minSize);
  }

  return {
    ...normalizedOverlay,
    ...updates,
    lockAspectRatio,
    x: clamp(x, 0, Math.max(0, bounds.maxX - width)),
    y: clamp(y, 0, Math.max(0, bounds.maxY - height)),
    width,
    height
  };
}

export function maxAssetOverlayWidthAtPosition(
  bounds: OverlayBounds,
  aspectRatio: number | null | undefined,
  lockAspectRatio: boolean,
  x: number,
  y: number,
  minSize: number
): number {
  const maxWidth = Math.max(0.000001, bounds.maxX - x);
  if (!lockAspectRatio) {
    return maxWidth;
  }
  return Math.max(0.000001, Math.min(maxWidth, assetOverlayWidth(Math.max(0.000001, bounds.maxY - y), aspectRatio), maxLockedWidth(bounds, aspectRatio)));
}

export function maxAssetOverlayHeightAtPosition(
  bounds: OverlayBounds,
  aspectRatio: number | null | undefined,
  lockAspectRatio: boolean,
  x: number,
  y: number,
  minSize: number
): number {
  const maxHeight = Math.max(0.000001, bounds.maxY - y);
  if (!lockAspectRatio) {
    return maxHeight;
  }
  return Math.max(0.000001, Math.min(maxHeight, assetOverlayHeight(Math.max(0.000001, bounds.maxX - x), aspectRatio)));
}

function maxLockedWidth(bounds: OverlayBounds, aspectRatio: number | null | undefined): number {
  return Math.max(0.000001, Math.min(bounds.maxX, assetOverlayWidth(bounds.maxY, aspectRatio)));
}

function isPositionOnlyUpdate(updates: Partial<AssetOverlayParams>): boolean {
  return (
    updates.width === undefined
    && updates.height === undefined
    && updates.lockAspectRatio === undefined
    && updates.assetPath === undefined
  );
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
