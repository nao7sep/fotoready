import React from "react";
import { Rect } from "react-konva";
import { clamp } from "@shared/numeric";
import type { OverlayContext, OverlayPlacement } from "./op-renderer";

export type ImageFitMode = "fit" | "shrink-only";

/** Fit an image of (imageWidth, imageHeight) into (frameWidth, frameHeight) while preserving aspect. */
export function fitImage(imageWidth: number, imageHeight: number, frameWidth: number, frameHeight: number, mode: ImageFitMode = "fit"): OverlayPlacement {
  const scale = mode === "fit"
    ? Math.min(frameWidth / imageWidth, frameHeight / imageHeight)
    : Math.min(1, frameWidth / imageWidth, frameHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height,
    scale
  };
}

export type FractionRect = { x: number; y: number; w: number; h: number };

/** A solid dashed-outline rect drawn in image space and projected onto the stage. Used by every overlay that draws a region (crop preview, conceal rect, etc.). */
export function OverlayRect({
  color,
  placement,
  rect,
  longEdge
}: {
  color: string;
  placement: OverlayPlacement;
  rect: FractionRect;
  longEdge: number;
}): React.JSX.Element {
  return (
    <Rect
      dash={[6, 4]}
      height={rect.h * longEdge * placement.scale}
      stroke={color}
      strokeWidth={2}
      width={rect.w * longEdge * placement.scale}
      x={placement.x + rect.x * longEdge * placement.scale}
      y={placement.y + rect.y * longEdge * placement.scale}
    />
  );
}

/** Dark mask for crop overlays — dims the four regions outside the crop rectangle. */
export function CropDarkenMask({
  placement,
  rect,
  longEdge,
  stageSize
}: {
  placement: OverlayPlacement;
  rect: FractionRect;
  longEdge: number;
  stageSize: { width: number; height: number };
}): React.JSX.Element {
  const left = placement.x + rect.x * longEdge * placement.scale;
  const top = placement.y + rect.y * longEdge * placement.scale;
  const right = left + rect.w * longEdge * placement.scale;
  const bottom = top + rect.h * longEdge * placement.scale;
  const maskProps = { fill: "#0f172a", listening: false, opacity: 0.46 };
  return (
    <>
      <Rect {...maskProps} height={Math.max(0, top)} width={stageSize.width} x={0} y={0} />
      <Rect {...maskProps} height={Math.max(0, stageSize.height - bottom)} width={stageSize.width} x={0} y={bottom} />
      <Rect {...maskProps} height={Math.max(0, bottom - top)} width={Math.max(0, left)} x={0} y={top} />
      <Rect {...maskProps} height={Math.max(0, bottom - top)} width={Math.max(0, stageSize.width - right)} x={right} y={top} />
    </>
  );
}

/** Clamp a fractional rect to the image bounds; used by crop + conceal overlays. */
export function clampFractionRect(rect: FractionRect, imageBounds: { maxX: number; maxY: number }, minSize: number = 0.01): FractionRect {
  const maxX = clamp(imageBounds.maxX, minSize, 1);
  const maxY = clamp(imageBounds.maxY, minSize, 1);
  const x = clamp(rect.x, 0, maxX);
  const y = clamp(rect.y, 0, maxY);
  const maxWidth = Math.max(minSize, maxX - x);
  const maxHeight = Math.max(minSize, maxY - y);
  return { x, y, w: clamp(rect.w, minSize, maxWidth), h: clamp(rect.h, minSize, maxHeight) };
}

export type UpdateFractionRectOptions = {
  /** Smallest allowed width/height after clamping. Defaults to 0.01. */
  minSize?: number;
  /**
   * Positive number = lock width/height to this ratio (w/h). Updating one dimension
   * derives the other, and clamping respects both axes so the locked ratio survives.
   * `null` / `undefined` / `0` = free. Text watermark passes `null`; image watermark
   * and stamp pass the asset's natural aspect ratio when the user enables the toggle.
   */
  aspectLock?: number | null;
};

/**
 * Canonical "apply a position/size patch to a fraction rect, then re-clamp inside bounds"
 * helper. Used by every box-shaped op (conceal, text watermark, image watermark, stamp,
 * crop's overlay) so the slider/drag semantics never drift between cards:
 *
 * - Sliders should set their `max` to the full axis bound (`imageBounds.maxX` / `maxY`)
 *   so the track shows the entire space; this helper does the clamping. A thumb that
 *   refuses to advance is the user's signal that the coupled dimension is using the
 *   remaining room.
 * - Moves preserve size: bumping x against the right edge stops the thumb rather than
 *   shrinking the rect.
 * - Resizes preserve position: dragging w/h past the available room stops the thumb
 *   rather than nudging x/y.
 * - With `aspectLock`, the unspecified dimension is derived from the specified one and
 *   the clamp respects both axes so the ratio always holds.
 */
export function updateFractionRect(
  rect: FractionRect,
  updates: Partial<FractionRect>,
  imageBounds: { maxX: number; maxY: number },
  options: UpdateFractionRectOptions = {}
): FractionRect {
  const minSize = options.minSize ?? 0.01;
  const aspectLock = options.aspectLock && options.aspectLock > 0 ? options.aspectLock : null;
  const current = clampFractionRect(rect, imageBounds, minSize);

  let nextW = updates.w !== undefined ? updates.w : current.w;
  let nextH = updates.h !== undefined ? updates.h : current.h;
  if (aspectLock) {
    if (updates.w !== undefined && updates.h === undefined) nextH = nextW / aspectLock;
    else if (updates.h !== undefined && updates.w === undefined) nextW = nextH * aspectLock;
  }

  const x = updates.x !== undefined ? clamp(updates.x, 0, Math.max(0, imageBounds.maxX - current.w)) : current.x;
  const y = updates.y !== undefined ? clamp(updates.y, 0, Math.max(0, imageBounds.maxY - current.h)) : current.y;

  if (aspectLock) {
    const maxWidth = Math.max(minSize, Math.min(imageBounds.maxX - x, (imageBounds.maxY - y) * aspectLock));
    const w = clamp(nextW, minSize, maxWidth);
    return { x, y, w, h: w / aspectLock };
  }
  const w = clamp(nextW, minSize, Math.max(minSize, imageBounds.maxX - x));
  const h = clamp(nextH, minSize, Math.max(minSize, imageBounds.maxY - y));
  return { x, y, w, h };
}

/** Map an image-bound-aware FractionRect into stage-space pixel coordinates. */
export function rectToStage(rect: FractionRect, longEdge: number, placement: OverlayPlacement): { x: number; y: number; w: number; h: number } {
  return {
    x: placement.x + rect.x * longEdge * placement.scale,
    y: placement.y + rect.y * longEdge * placement.scale,
    w: rect.w * longEdge * placement.scale,
    h: rect.h * longEdge * placement.scale
  };
}

/** Inverse: stage-space pixel coords back to a fractional rect. */
export function rectFromStage(rect: { x: number; y: number; w: number; h: number }, longEdge: number, placement: OverlayPlacement): FractionRect {
  return {
    x: (rect.x - placement.x) / (longEdge * placement.scale),
    y: (rect.y - placement.y) / (longEdge * placement.scale),
    w: rect.w / (longEdge * placement.scale),
    h: rect.h / (longEdge * placement.scale)
  };
}

export function imageBoundsFromSize(imageSize: { width: number; height: number }): { maxX: number; maxY: number } {
  const longEdge = Math.max(imageSize.width, imageSize.height, 1);
  return {
    maxX: clamp(imageSize.width / longEdge, 0.01, 1),
    maxY: clamp(imageSize.height / longEdge, 0.01, 1)
  };
}

/** Same as imageBoundsFromSize but tolerates a null originalSize and falls back to a 1:1 square. */
export function imageBoundsFromOriginalSize(originalSize: { width: number; height: number } | null): { maxX: number; maxY: number } {
  return originalSize ? imageBoundsFromSize(originalSize) : { maxX: 1, maxY: 1 };
}

/** Decode a `params.rects` blob into a list of FractionRects. Used by every conceal op. */
export function readRectList(value: unknown): FractionRect[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const rect = entry as Partial<FractionRect>;
    if (typeof rect.x !== "number" || typeof rect.y !== "number" || typeof rect.w !== "number" || typeof rect.h !== "number") {
      return [];
    }
    return [rect as FractionRect];
  });
}

export type { OverlayContext };
