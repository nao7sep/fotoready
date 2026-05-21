import { clampFractionBox } from "./box-geometry";

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

export type OverlayImageBounds = { maxX: number; maxY: number };

export const DEFAULT_ASSET_OVERLAY_WIDTH = 0.12;
export const MIN_ASSET_OVERLAY_SIZE = 0.01;

export function clampAssetOverlay(params: AssetOverlayParams, bounds: OverlayImageBounds): AssetOverlayParams {
  const rotation = normalizeRotation(validFinite(params.rotation, 0));
  const box = clampFractionBox({
    x: params.x,
    y: params.y,
    w: params.width,
    h: params.height,
    rotation
  }, bounds, MIN_ASSET_OVERLAY_SIZE);
  return { ...params, x: box.x, y: box.y, width: box.w, height: box.h, rotation };
}

function validFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeRotation(value: number): number {
  const normalized = value % 360;
  return normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
}
