import React from "react";
import { Rect } from "react-konva";
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

/** A solid dashed-outline rect drawn in image space and projected onto the stage. Used by every overlay that draws a region (crop preview, redact rect, etc.). */
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

/** Clamp a fractional rect to the image bounds; used by crop + redact overlays. */
export function clampFractionRect(rect: FractionRect, imageBounds: { maxX: number; maxY: number }): FractionRect {
  const maxX = clamp(imageBounds.maxX, 0.01, 1);
  const maxY = clamp(imageBounds.maxY, 0.01, 1);
  const x = clamp(rect.x, 0, maxX);
  const y = clamp(rect.y, 0, maxY);
  const maxWidth = Math.max(0.01, maxX - x);
  const maxHeight = Math.max(0.01, maxY - y);
  return { x, y, w: clamp(rect.w, 0.01, maxWidth), h: clamp(rect.h, 0.01, maxHeight) };
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

/** Decode a `params.rects` blob into a list of FractionRects. Used by every redact op. */
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

/** Compute anchor-based canvas position for watermark draggable overlays. */
export function anchorCanvasPos(
  anchor: string,
  imageSize: { width: number; height: number },
  longEdge: number,
  placement: OverlayPlacement,
  marginXFraction: number,
  marginYFraction: number,
  approxW: number,
  approxH: number
): { x: number; y: number } {
  const marginXPx = marginXFraction * longEdge;
  const marginYPx = marginYFraction * longEdge;
  const horizontal = anchor.includes("left") ? "left" : anchor.includes("right") ? "right" : "center";
  const vertical = anchor.includes("top") ? "top" : anchor.includes("bottom") ? "bottom" : "center";
  const imgLeft = horizontal === "left" ? marginXPx : horizontal === "right" ? imageSize.width - approxW - marginXPx : (imageSize.width - approxW) / 2;
  const imgTop = vertical === "top" ? marginYPx : vertical === "bottom" ? imageSize.height - approxH - marginYPx : (imageSize.height - approxH) / 2;
  return {
    x: placement.x + Math.max(0, imgLeft) * placement.scale,
    y: placement.y + Math.max(0, imgTop) * placement.scale
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export type { OverlayContext };
