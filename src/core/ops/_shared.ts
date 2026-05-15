import type sharp from "sharp";
import { assertArray, assertFiniteNumber, assertOneOf, assertRecord, assertString, assertNonEmptyString } from "@shared/validation/common";

export const ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;

export type Rect = { x: number; y: number; w: number; h: number };

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Materialize the current sharp work image to a fresh raw-RGBA-backed sharp instance and
 * return the new instance plus its dimensions. Used by ops that change dimensions (crop,
 * resize, rotate) so subsequent ops see accurate width/height.
 */
export async function materialize(image: sharp.Sharp): Promise<{ image: sharp.Sharp; width: number; height: number }> {
  const sharpImpl = (await import("sharp")).default;
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const next = sharpImpl(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  return { image: next, width: info.width, height: info.height };
}

export async function compositeOverlayFromRegion(
  image: sharp.Sharp,
  region: { left: number; top: number; width: number; height: number },
  transform: (regionImage: sharp.Sharp) => sharp.Sharp
): Promise<sharp.OverlayOptions> {
  const { data, info } = await transform(image.clone().extract(region)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    input: data,
    raw: { width: info.width, height: info.height, channels: info.channels },
    left: region.left,
    top: region.top
  };
}

export function rectsToList(value: unknown): Rect[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Rect =>
    item !== null
    && typeof item === "object"
    && typeof (item as Rect).x === "number"
    && typeof (item as Rect).y === "number"
    && typeof (item as Rect).w === "number"
    && typeof (item as Rect).h === "number"
  );
}

export function regionFromRect(rect: Rect, sourceWidth: number, sourceHeight: number): { left: number; top: number; width: number; height: number } {
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const left = Math.max(0, Math.round(rect.x * longEdge));
  const top = Math.max(0, Math.round(rect.y * longEdge));
  const width = Math.max(1, Math.min(Math.round(rect.w * longEdge), sourceWidth - left));
  const height = Math.max(1, Math.min(Math.round(rect.h * longEdge), sourceHeight - top));
  return { left, top, width, height };
}

export function anchorPosition(
  anchor: string,
  imageWidth: number,
  imageHeight: number,
  width: number,
  height: number,
  marginX: number,
  marginY: number
): { left: number; top: number } {
  const horizontal = anchor.includes("left") ? "left" : anchor.includes("right") ? "right" : "center";
  const vertical = anchor.includes("top") ? "top" : anchor.includes("bottom") ? "bottom" : "center";
  const left = horizontal === "left" ? marginX : horizontal === "right" ? imageWidth - width - marginX : Math.round((imageWidth - width) / 2);
  const top = vertical === "top" ? marginY : vertical === "bottom" ? imageHeight - height - marginY : Math.round((imageHeight - height) / 2);
  return { left: Math.max(0, left), top: Math.max(0, top) };
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Validate a record + reject unknown keys against an allow-list. Used by every op's validate(). */
export function assertParamsShape(value: unknown, allowedKeys: readonly string[], path: string): Record<string, unknown> {
  const record = assertRecord(value, path);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${path}.${key} is not a recognized param.`);
    }
  }
  return record;
}

export function validateRectList(value: unknown, path: string): Rect[] {
  return assertArray(value, path).map((entry, index) => {
    const record = assertRecord(entry, `${path}[${index}]`);
    return {
      x: assertFiniteNumber(record.x, `${path}[${index}].x`, { min: 0, max: 1 }),
      y: assertFiniteNumber(record.y, `${path}[${index}].y`, { min: 0, max: 1 }),
      w: assertFiniteNumber(record.w, `${path}[${index}].w`, { min: 0, max: 1, minExclusive: true }),
      h: assertFiniteNumber(record.h, `${path}[${index}].h`, { min: 0, max: 1, minExclusive: true })
    };
  });
}

export function validateOptionalSamplePoint(value: unknown, path: string): [number, number] | null {
  if (value === undefined || value === null) return null;
  const tuple = assertArray(value, path);
  if (tuple.length < 2) {
    throw new Error(`${path} must contain two numeric values.`);
  }
  return [
    assertFiniteNumber(tuple[0], `${path}[0]`, { min: 0, max: 1 }),
    assertFiniteNumber(tuple[1], `${path}[1]`, { min: 0, max: 1 })
  ];
}

export { assertArray, assertFiniteNumber, assertOneOf, assertRecord, assertString, assertNonEmptyString };
