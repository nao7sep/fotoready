import { placeFractionBoxRandomly, type BoxBounds } from "@shared/box-geometry";

export function placeNewBoxOverlay(opType: string, params: Record<string, unknown>, bounds: BoxBounds): void {
  if (opType === "watermark-image" || opType === "stamp") {
    placeAssetOverlay(params, bounds);
    return;
  }
  if (opType === "watermark-text") {
    placeTextOverlay(params, bounds);
    return;
  }
  if (opType === "cover" || opType === "blur" || opType === "mosaic") {
    placeConcealOverlay(params, bounds);
  }
}

function placeAssetOverlay(params: Record<string, unknown>, bounds: BoxBounds): void {
  if (
    typeof params.x !== "number"
    || typeof params.y !== "number"
    || typeof params.width !== "number"
    || typeof params.height !== "number"
  ) {
    return;
  }
  const placed = placeFractionBoxRandomly({
    x: params.x,
    y: params.y,
    w: params.width,
    h: params.height,
    rotation: typeof params.rotation === "number" ? params.rotation : 0
  }, bounds);
  params.x = placed.x;
  params.y = placed.y;
  params.width = placed.w;
  params.height = placed.h;
}

function placeTextOverlay(params: Record<string, unknown>, bounds: BoxBounds): void {
  if (
    typeof params.x !== "number"
    || typeof params.y !== "number"
    || typeof params.w !== "number"
    || typeof params.h !== "number"
  ) {
    return;
  }
  const placed = placeFractionBoxRandomly({
    x: params.x,
    y: params.y,
    w: params.w,
    h: params.h,
    rotation: typeof params.rotation === "number" ? params.rotation : 0
  }, bounds, 0.02);
  params.x = placed.x;
  params.y = placed.y;
  params.w = placed.w;
  params.h = placed.h;
}

function placeConcealOverlay(params: Record<string, unknown>, bounds: BoxBounds): void {
  if (!Array.isArray(params.rects) || params.rects.length === 0) return;
  const firstRect = params.rects[0];
  if (
    !firstRect
    || typeof firstRect !== "object"
    || typeof (firstRect as Record<string, unknown>).x !== "number"
    || typeof (firstRect as Record<string, unknown>).y !== "number"
    || typeof (firstRect as Record<string, unknown>).w !== "number"
    || typeof (firstRect as Record<string, unknown>).h !== "number"
  ) {
    return;
  }
  const rect = firstRect as Record<string, unknown>;
  const placed = placeFractionBoxRandomly({
    x: rect.x as number,
    y: rect.y as number,
    w: rect.w as number,
    h: rect.h as number,
    rotation: typeof rect.rotation === "number" ? rect.rotation : 0
  }, bounds);
  rect.x = placed.x;
  rect.y = placed.y;
  rect.w = placed.w;
  rect.h = placed.h;
}
