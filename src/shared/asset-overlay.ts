export type AssetOverlayParams = {
  assetPath: string;
  x: number;
  y: number;
  width: number;
  opacity: number;
  rotation: number;
};

export const DEFAULT_ASSET_OVERLAY_ASPECT_RATIO = 1.5;
export const MIN_ASSET_OVERLAY_WIDTH = 0.01;

export function normalizeAssetAspectRatio(aspectRatio: number | null | undefined): number {
  return typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0.01
    ? aspectRatio
    : DEFAULT_ASSET_OVERLAY_ASPECT_RATIO;
}

export function assetOverlayHeight(width: number, aspectRatio: number | null | undefined): number {
  return width / normalizeAssetAspectRatio(aspectRatio);
}

export function maxAssetOverlayWidth(bounds: { maxX: number; maxY: number }, aspectRatio: number | null | undefined): number {
  return Math.max(0.01, Math.min(bounds.maxX, bounds.maxY * normalizeAssetAspectRatio(aspectRatio)));
}

export function maxAssetOverlayWidthAtPosition(
  bounds: { maxX: number; maxY: number },
  aspectRatio: number | null | undefined,
  x: number,
  y: number,
  minWidth: number
): number {
  return Math.max(
    minWidth,
    Math.min(
      Math.max(minWidth, bounds.maxX - x),
      Math.max(minWidth, (bounds.maxY - y) * normalizeAssetAspectRatio(aspectRatio))
    )
  );
}

export function normalizeAssetOverlay<T extends Partial<AssetOverlayParams>>(
  params: T,
  bounds: { maxX: number; maxY: number },
  aspectRatio: number | null | undefined,
  minWidth: number
): T {
  const normalizedAspectRatio = normalizeAssetAspectRatio(aspectRatio);
  const maxWidth = maxAssetOverlayWidth(bounds, normalizedAspectRatio);
  const width = clamp(params.width ?? 0.15, Math.min(minWidth, maxWidth), Math.max(minWidth, maxWidth));
  const height = assetOverlayHeight(width, normalizedAspectRatio);
  return {
    ...params,
    width,
    x: clamp(params.x ?? 0, 0, Math.max(0, bounds.maxX - width)),
    y: clamp(params.y ?? 0, 0, Math.max(0, bounds.maxY - height))
  };
}

export function updateAssetOverlay(
  currentOverlay: AssetOverlayParams,
  updates: Partial<AssetOverlayParams>,
  bounds: { maxX: number; maxY: number },
  aspectRatio: number | null | undefined,
  minWidth: number
): AssetOverlayParams {
  const normalizedAspectRatio = normalizeAssetAspectRatio(aspectRatio);
  const normalizedOverlay = normalizeAssetOverlay(currentOverlay, bounds, normalizedAspectRatio, minWidth);
  let x = normalizedOverlay.x;
  let y = normalizedOverlay.y;
  let width = normalizedOverlay.width;

  if (updates.x !== undefined) {
    x = clamp(updates.x, 0, Math.max(0, bounds.maxX - width));
  }
  if (updates.y !== undefined) {
    y = clamp(updates.y, 0, Math.max(0, bounds.maxY - assetOverlayHeight(width, normalizedAspectRatio)));
  }
  if (updates.width !== undefined) {
    width = clamp(updates.width, minWidth, maxAssetOverlayWidthAtPosition(bounds, normalizedAspectRatio, x, y, minWidth));
    y = clamp(y, 0, Math.max(0, bounds.maxY - assetOverlayHeight(width, normalizedAspectRatio)));
  } else {
    width = clamp(width, minWidth, maxAssetOverlayWidthAtPosition(bounds, normalizedAspectRatio, x, y, minWidth));
  }

  return {
    ...normalizedOverlay,
    ...updates,
    x,
    y,
    width
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
