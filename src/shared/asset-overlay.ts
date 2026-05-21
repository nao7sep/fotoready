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
export const MIN_ASSET_OVERLAY_SIZE = 0.01;

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
  bounds: { maxX: number; maxY: number },
  aspectRatio: number | null | undefined,
  minSize: number
): T {
  const normalizedAspectRatio = normalizeAssetAspectRatio(aspectRatio);
  const lockAspectRatio = params.lockAspectRatio ?? true;
  let width = readPositive(params.width, 0.15);
  let height = readPositive(params.height, assetOverlayHeight(width, normalizedAspectRatio));
  if (lockAspectRatio) {
    if (!isPositive(params.width) && isPositive(params.height)) {
      width = assetOverlayWidth(height, normalizedAspectRatio);
    }
    height = assetOverlayHeight(width, normalizedAspectRatio);
  }
  let x = clamp(readFinite(params.x, 0), 0, Math.max(0, bounds.maxX));
  let y = clamp(readFinite(params.y, 0), 0, Math.max(0, bounds.maxY));
  ({ width, height } = clampAssetOverlaySize(
    { width, height },
    maxAssetOverlaySizeAtPosition(bounds, x, y, normalizedAspectRatio, lockAspectRatio, minSize),
    normalizedAspectRatio,
    lockAspectRatio,
    minSize
  ));
  x = clamp(x, 0, Math.max(0, bounds.maxX - width));
  y = clamp(y, 0, Math.max(0, bounds.maxY - height));
  return {
    ...params,
    width,
    height,
    lockAspectRatio,
    x,
    y
  };
}

export function updateAssetOverlay(
  currentOverlay: AssetOverlayParams,
  updates: Partial<AssetOverlayParams>,
  bounds: { maxX: number; maxY: number },
  aspectRatio: number | null | undefined,
  minSize: number
): AssetOverlayParams {
  const normalizedAspectRatio = normalizeAssetAspectRatio(aspectRatio);
  const normalizedOverlay = normalizeAssetOverlay(currentOverlay, bounds, normalizedAspectRatio, minSize);
  const lockAspectRatio = updates.lockAspectRatio ?? normalizedOverlay.lockAspectRatio;
  let x = updates.x ?? normalizedOverlay.x;
  let y = updates.y ?? normalizedOverlay.y;
  let width = updates.width ?? normalizedOverlay.width;
  let height = updates.height ?? normalizedOverlay.height;

  if (lockAspectRatio) {
    if (updates.height !== undefined && updates.width === undefined) {
      width = assetOverlayWidth(height, normalizedAspectRatio);
    } else {
      height = assetOverlayHeight(width, normalizedAspectRatio);
    }
  }

  x = clamp(x, 0, Math.max(0, bounds.maxX));
  y = clamp(y, 0, Math.max(0, bounds.maxY));
  ({ width, height } = clampAssetOverlaySize(
    { width, height },
    maxAssetOverlaySizeAtPosition(bounds, x, y, normalizedAspectRatio, lockAspectRatio, minSize),
    normalizedAspectRatio,
    lockAspectRatio,
    minSize
  ));
  x = clamp(x, 0, Math.max(0, bounds.maxX - width));
  y = clamp(y, 0, Math.max(0, bounds.maxY - height));

  return {
    ...normalizedOverlay,
    ...updates,
    lockAspectRatio,
    x,
    y,
    width,
    height
  };
}

export function maxAssetOverlayWidthAtPosition(
  bounds: { maxX: number; maxY: number },
  aspectRatio: number | null | undefined,
  lockAspectRatio: boolean,
  x: number,
  y: number,
  minSize: number
): number {
  const maxWidth = Math.max(minSize, bounds.maxX - x);
  if (!lockAspectRatio) {
    return maxWidth;
  }
  return Math.max(minSize, Math.min(maxWidth, assetOverlayWidth(Math.max(minSize, bounds.maxY - y), aspectRatio)));
}

export function maxAssetOverlayHeightAtPosition(
  bounds: { maxX: number; maxY: number },
  aspectRatio: number | null | undefined,
  lockAspectRatio: boolean,
  x: number,
  y: number,
  minSize: number
): number {
  const maxHeight = Math.max(minSize, bounds.maxY - y);
  if (!lockAspectRatio) {
    return maxHeight;
  }
  return Math.max(minSize, Math.min(maxHeight, assetOverlayHeight(Math.max(minSize, bounds.maxX - x), aspectRatio)));
}

function clampAssetOverlaySize(
  size: { width: number; height: number },
  maxSize: { width: number; height: number },
  aspectRatio: number,
  lockAspectRatio: boolean,
  minSize: number
): { width: number; height: number } {
  let width = readPositive(size.width, minSize);
  let height = readPositive(size.height, minSize);
  const maxWidth = Math.max(0.000001, maxSize.width);
  const maxHeight = Math.max(0.000001, maxSize.height);

  if (lockAspectRatio) {
    let scale = Math.min(1, maxWidth / width, maxHeight / height);
    if (!Number.isFinite(scale) || scale <= 0) {
      scale = 1;
    }
    width *= scale;
    height *= scale;
    const minScale = Math.max(minSize / width, minSize / height, 1);
    width *= minScale;
    height *= minScale;
    if (width > maxWidth || height > maxHeight) {
      const fallbackScale = Math.min(maxWidth / width, maxHeight / height);
      if (Number.isFinite(fallbackScale) && fallbackScale > 0) {
        width *= fallbackScale;
        height *= fallbackScale;
      }
    }
    width = clamp(width, 0.000001, maxWidth);
    height = clamp(height, 0.000001, maxHeight);
    if (height <= 0.000001) {
      height = assetOverlayHeight(width, aspectRatio);
    }
    return { width, height };
  }

  return {
    width: clamp(width, Math.min(minSize, maxWidth), maxWidth),
    height: clamp(height, Math.min(minSize, maxHeight), maxHeight)
  };
}

function maxAssetOverlaySizeAtPosition(
  bounds: { maxX: number; maxY: number },
  x: number,
  y: number,
  aspectRatio: number,
  lockAspectRatio: boolean,
  minSize: number
): { width: number; height: number } {
  return {
    width: maxAssetOverlayWidthAtPosition(bounds, aspectRatio, lockAspectRatio, x, y, minSize),
    height: maxAssetOverlayHeightAtPosition(bounds, aspectRatio, lockAspectRatio, x, y, minSize)
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
