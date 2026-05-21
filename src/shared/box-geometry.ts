import { clamp } from "./numeric";

export type BoxBounds = { maxX: number; maxY: number };
export type FractionBox = { x: number; y: number; w: number; h: number; rotation?: number };

export function clampFractionBox(box: FractionBox, bounds: BoxBounds, minSize: number = 0.01): FractionBox {
  const maxX = clamp(validPositive(bounds.maxX, 1), minSize, 1);
  const maxY = clamp(validPositive(bounds.maxY, 1), minSize, 1);
  let w = clamp(validPositive(box.w, minSize), Math.min(minSize, maxX), maxX);
  let h = clamp(validPositive(box.h, minSize), Math.min(minSize, maxY), maxY);
  let next = {
    x: clamp(validFinite(box.x, 0), 0, Math.max(0, maxX - w)),
    y: clamp(validFinite(box.y, 0), 0, Math.max(0, maxY - h)),
    w,
    h
  };
  const rotation = validFinite(box.rotation ?? 0, 0);
  let rotated = rotatedFractionBoxBounds(next, rotation);
  const scale = Math.min(
    1,
    rotated.width > 0 ? maxX / rotated.width : 1,
    rotated.height > 0 ? maxY / rotated.height : 1
  );
  if (scale < 1) {
    w = Math.max(Math.min(minSize, maxX), w * scale);
    h = Math.max(Math.min(minSize, maxY), h * scale);
    next = { ...next, w, h };
    rotated = rotatedFractionBoxBounds(next, rotation);
  }
  const deltaX = rotated.x < 0 ? -rotated.x : rotated.x + rotated.width > maxX ? maxX - (rotated.x + rotated.width) : 0;
  const deltaY = rotated.y < 0 ? -rotated.y : rotated.y + rotated.height > maxY ? maxY - (rotated.y + rotated.height) : 0;
  return { ...box, x: next.x + deltaX, y: next.y + deltaY, w, h, rotation };
}

export function placeFractionBoxRandomly(box: FractionBox, bounds: BoxBounds, minSize: number = 0.01, random: () => number = Math.random): FractionBox {
  const sized = clampFractionBox({ ...box, x: 0, y: 0 }, bounds, minSize);
  const maxX = clamp(validPositive(bounds.maxX, 1), minSize, 1);
  const maxY = clamp(validPositive(bounds.maxY, 1), minSize, 1);
  return clampFractionBox({
    ...sized,
    x: Math.max(0, maxX - sized.w) * clamp(random(), 0, 1),
    y: Math.max(0, maxY - sized.h) * clamp(random(), 0, 1)
  }, bounds, minSize);
}

export function rotatedFractionBoxBounds(box: Pick<FractionBox, "x" | "y" | "w" | "h">, rotation: number): { x: number; y: number; width: number; height: number } {
  const radians = rotation * (Math.PI / 180);
  const halfWidth = box.w / 2;
  const halfHeight = box.h / 2;
  const extentX = Math.abs(halfWidth * Math.cos(radians)) + Math.abs(halfHeight * Math.sin(radians));
  const extentY = Math.abs(halfWidth * Math.sin(radians)) + Math.abs(halfHeight * Math.cos(radians));
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  return {
    x: centerX - extentX,
    y: centerY - extentY,
    width: extentX * 2,
    height: extentY * 2
  };
}

function validPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function validFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
