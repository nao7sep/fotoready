import type * as sharp from "sharp";
import type { OpApplyContext } from "./op-module";
import { assertArray, assertFiniteNumber, assertOneOf, assertRecord, assertString, assertNonEmptyString } from "@shared/validation/common";
import { clamp, clamp01 } from "@shared/numeric";

export { clamp, clamp01 };

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

/** An op's `apply` built from its in-place `transformPixels`: one full-frame RGBA buffer, changed and wrapped. */
export function applyPixels<P>(transform: (raw: Buffer, params: P, ctx: OpApplyContext) => Promise<void> | void) {
  return async (image: sharp.Sharp, params: P, ctx: OpApplyContext): Promise<sharp.Sharp> => {
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width <= 0 || info.height <= 0) return image;
    await transform(data, params, ctx);
    const sharpImpl = (await import("sharp")).default;
    return sharpImpl(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  };
}

/**
 * Sharp composite chains are lazy; materialize immediately so later ops see the
 * actual composited pixels rather than a still-deferred pipeline.
 */
export async function applyComposite(image: sharp.Sharp, overlays: sharp.OverlayOptions[]): Promise<{ image: sharp.Sharp; width: number; height: number }> {
  return materialize(image.composite(overlays));
}

export async function applyTransformedOverlay(
  image: sharp.Sharp,
  overlay: sharp.Sharp,
  box: { left: number; top: number; width: number; height: number; rotation: number }
): Promise<{ image: sharp.Sharp; width: number; height: number }> {
  const imageMetadata = await image.metadata();
  const imageWidth = imageMetadata.width ?? 0;
  const imageHeight = imageMetadata.height ?? 0;
  const rotated = await overlay
    .resize(Math.max(1, Math.round(box.width)), Math.max(1, Math.round(box.height)), { fit: "fill" })
    .ensureAlpha()
    .rotate(box.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  const compositeLeft = Math.round(centerX - rotated.info.width / 2);
  const compositeTop = Math.round(centerY - rotated.info.height / 2);
  const visibleLeft = Math.max(0, compositeLeft);
  const visibleTop = Math.max(0, compositeTop);
  const visibleRight = Math.min(imageWidth, compositeLeft + rotated.info.width);
  const visibleBottom = Math.min(imageHeight, compositeTop + rotated.info.height);
  const visibleWidth = visibleRight - visibleLeft;
  const visibleHeight = visibleBottom - visibleTop;
  if (visibleWidth <= 0 || visibleHeight <= 0) {
    return { image, width: imageWidth, height: imageHeight };
  }
  const input = visibleWidth === rotated.info.width && visibleHeight === rotated.info.height
    ? rotated.data
    : await (await import("sharp")).default(rotated.data, {
      raw: { width: rotated.info.width, height: rotated.info.height, channels: rotated.info.channels }
    })
      .extract({
        left: visibleLeft - compositeLeft,
        top: visibleTop - compositeTop,
        width: visibleWidth,
        height: visibleHeight
      })
      .raw()
      .toBuffer();
  return applyComposite(image, [{
    input,
    raw: { width: visibleWidth, height: visibleHeight, channels: rotated.info.channels },
    left: visibleLeft,
    top: visibleTop
  }]);
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
