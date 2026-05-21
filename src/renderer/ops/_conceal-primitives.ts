import { DEFAULT_CONCEAL_REGION, CONCEAL_SHAPES, type ConcealRegion, type ConcealShape } from "@shared/types/conceal";
import { normalizeAngle } from "@shared/rotation";
import { clampFractionRect, rectFromStage, rectToStage, updateFractionRect, type FractionRect } from "./_overlay-primitives";
import type { OverlayPlacement } from "./op-renderer";

export type StageConcealRegion = { x: number; y: number; w: number; h: number; rotation: number };

export function readConcealRegionList(value: unknown): ConcealRegion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const region = entry as Partial<ConcealRegion>;
    if (
      typeof region.x !== "number"
      || typeof region.y !== "number"
      || typeof region.w !== "number"
      || typeof region.h !== "number"
      || typeof region.rotation !== "number"
      || !CONCEAL_SHAPES.includes(region.shape as ConcealShape)
    ) {
      return [];
    }
    return [normalizeRegion(region as ConcealRegion)];
  });
}

export function replacePrimaryConcealRegion(value: unknown, updates: Partial<ConcealRegion>): ConcealRegion[] {
  const regions = readConcealRegionList(value);
  const first = normalizeRegion({ ...(regions[0] ?? DEFAULT_CONCEAL_REGION), ...updates });
  return regions.length === 0 ? [first] : [first, ...regions.slice(1)];
}

export function clampConcealRegion(region: ConcealRegion, imageBounds: { maxX: number; maxY: number }): ConcealRegion {
  const clamped = clampFractionRect(region, imageBounds);
  return normalizeRegion({ ...region, ...clamped });
}

export function updateConcealRegion(region: ConcealRegion, updates: Partial<ConcealRegion>, imageBounds: { maxX: number; maxY: number }): ConcealRegion {
  const next = updateFractionRect(region, updates as Partial<FractionRect>, imageBounds);
  return normalizeRegion({ ...region, ...updates, ...next });
}

export function concealRegionToStage(region: ConcealRegion, longEdge: number, placement: OverlayPlacement): StageConcealRegion {
  return {
    ...rectToStage(region, longEdge, placement),
    rotation: normalizeAngle(region.rotation)
  };
}

export function concealRegionFromStage(
  region: { x: number; y: number; w: number; h: number; rotation?: number },
  longEdge: number,
  placement: OverlayPlacement,
  shape: ConcealShape
): ConcealRegion {
  return normalizeRegion({
    ...rectFromStage(region, longEdge, placement),
    rotation: region.rotation ?? 0,
    shape
  });
}

function normalizeRegion(region: ConcealRegion): ConcealRegion {
  return {
    ...region,
    rotation: normalizeAngle(region.rotation)
  };
}
