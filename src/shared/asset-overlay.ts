import { clamp } from "./numeric";

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

export const DEFAULT_ASSET_OVERLAY_WIDTH = 0.15;
export const MIN_ASSET_OVERLAY_SIZE = 0.01;

export function clampAssetOverlay(params: AssetOverlayParams, bounds: OverlayImageBounds): AssetOverlayParams {
  const width = clamp(validPositive(params.width, DEFAULT_ASSET_OVERLAY_WIDTH), MIN_ASSET_OVERLAY_SIZE, bounds.maxX);
  const height = clamp(validPositive(params.height, DEFAULT_ASSET_OVERLAY_WIDTH), MIN_ASSET_OVERLAY_SIZE, bounds.maxY);
  const x = clamp(validFinite(params.x, 0), 0, Math.max(0, bounds.maxX - width));
  const y = clamp(validFinite(params.y, 0), 0, Math.max(0, bounds.maxY - height));
  return { ...params, x, y, width, height };
}

function validPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function validFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
