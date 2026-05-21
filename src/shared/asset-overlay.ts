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
  const maxX = clamp(validPositive(bounds.maxX, 1), MIN_ASSET_OVERLAY_SIZE, 1);
  const maxY = clamp(validPositive(bounds.maxY, 1), MIN_ASSET_OVERLAY_SIZE, 1);
  const minWidth = Math.min(MIN_ASSET_OVERLAY_SIZE, maxX);
  const minHeight = Math.min(MIN_ASSET_OVERLAY_SIZE, maxY);
  let width = clamp(validPositive(params.width, DEFAULT_ASSET_OVERLAY_WIDTH), minWidth, maxX);
  let height = clamp(validPositive(params.height, DEFAULT_ASSET_OVERLAY_WIDTH), minHeight, maxY);
  const rotation = normalizeRotation(validFinite(params.rotation, 0));
  let next = {
    x: clamp(validFinite(params.x, 0), 0, Math.max(0, maxX - width)),
    y: clamp(validFinite(params.y, 0), 0, Math.max(0, maxY - height)),
    width,
    height
  };
  let rotated = rotatedBounds(next, rotation);
  const scale = Math.min(
    1,
    rotated.width > 0 ? maxX / rotated.width : 1,
    rotated.height > 0 ? maxY / rotated.height : 1
  );
  if (scale < 1) {
    width = Math.max(minWidth, width * scale);
    height = Math.max(minHeight, height * scale);
    next = { ...next, width, height };
    rotated = rotatedBounds(next, rotation);
  }
  const deltaX = rotated.x < 0 ? -rotated.x : rotated.x + rotated.width > maxX ? maxX - (rotated.x + rotated.width) : 0;
  const deltaY = rotated.y < 0 ? -rotated.y : rotated.y + rotated.height > maxY ? maxY - (rotated.y + rotated.height) : 0;
  return { ...params, x: next.x + deltaX, y: next.y + deltaY, width, height, rotation };
}

function validPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function validFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeRotation(value: number): number {
  const normalized = value % 360;
  return normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
}

function rotatedBounds(rect: { x: number; y: number; width: number; height: number }, rotation: number): { x: number; y: number; width: number; height: number } {
  const radians = rotation * (Math.PI / 180);
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const extentX = Math.abs(halfWidth * Math.cos(radians)) + Math.abs(halfHeight * Math.sin(radians));
  const extentY = Math.abs(halfWidth * Math.sin(radians)) + Math.abs(halfHeight * Math.cos(radians));
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    x: centerX - extentX,
    y: centerY - extentY,
    width: extentX * 2,
    height: extentY * 2
  };
}
