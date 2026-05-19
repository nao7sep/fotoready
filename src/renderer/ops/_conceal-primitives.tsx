import React from "react";
import { Ellipse, Rect } from "react-konva";
import { DEFAULT_CONCEAL_REGION, CONCEAL_SHAPES, type ConcealRegion, type ConcealShape } from "@shared/types/conceal";
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

export function patchFirstConcealRegion(value: unknown, patch: Partial<ConcealRegion>): ConcealRegion[] {
  const regions = readConcealRegionList(value);
  const first = normalizeRegion({ ...(regions[0] ?? DEFAULT_CONCEAL_REGION), ...patch });
  return regions.length === 0 ? [first] : [first, ...regions.slice(1)];
}

export function clampConcealRegion(region: ConcealRegion, imageBounds: { maxX: number; maxY: number }): ConcealRegion {
  const maxX = clamp(imageBounds.maxX, 0.01, 1);
  const maxY = clamp(imageBounds.maxY, 0.01, 1);
  const x = clamp(region.x, 0, maxX);
  const y = clamp(region.y, 0, maxY);
  const maxWidth = Math.max(0.01, maxX - x);
  const maxHeight = Math.max(0.01, maxY - y);
  return normalizeRegion({
    ...region,
    x,
    y,
    w: clamp(region.w, 0.01, maxWidth),
    h: clamp(region.h, 0.01, maxHeight)
  });
}

export function concealRegionToStage(region: ConcealRegion, longEdge: number, placement: OverlayPlacement): StageConcealRegion {
  return {
    x: placement.x + region.x * longEdge * placement.scale,
    y: placement.y + region.y * longEdge * placement.scale,
    w: region.w * longEdge * placement.scale,
    h: region.h * longEdge * placement.scale,
    rotation: normalizeRotation(region.rotation)
  };
}

export function concealRegionFromStage(
  region: { x: number; y: number; w: number; h: number; rotation?: number },
  longEdge: number,
  placement: OverlayPlacement,
  shape: ConcealShape
): ConcealRegion {
  return normalizeRegion({
    x: (region.x - placement.x) / (longEdge * placement.scale),
    y: (region.y - placement.y) / (longEdge * placement.scale),
    w: region.w / (longEdge * placement.scale),
    h: region.h / (longEdge * placement.scale),
    rotation: region.rotation ?? 0,
    shape
  });
}

export function OverlayConcealShape({
  color,
  placement,
  region,
  longEdge
}: {
  color: string;
  placement: OverlayPlacement;
  region: ConcealRegion;
  longEdge: number;
}): React.JSX.Element {
  const stage = concealRegionToStage(region, longEdge, placement);
  const centerX = stage.x + stage.w / 2;
  const centerY = stage.y + stage.h / 2;
  if (region.shape === "ellipse") {
    return (
      <Ellipse
        dash={[6, 4]}
        listening={false}
        radiusX={stage.w / 2}
        radiusY={stage.h / 2}
        rotation={stage.rotation}
        stroke={color}
        strokeWidth={2}
        x={centerX}
        y={centerY}
      />
    );
  }
  return (
    <Rect
      dash={[6, 4]}
      height={stage.h}
      listening={false}
      offsetX={stage.w / 2}
      offsetY={stage.h / 2}
      rotation={stage.rotation}
      stroke={color}
      strokeWidth={2}
      width={stage.w}
      x={centerX}
      y={centerY}
    />
  );
}

function normalizeRegion(region: ConcealRegion): ConcealRegion {
  return {
    ...region,
    rotation: normalizeRotation(region.rotation)
  };
}

function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360;
  return normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
