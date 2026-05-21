import sharp from "sharp";
import { CONCEAL_SHAPES, type ConcealRegion, type ConcealShape } from "@shared/types/conceal";
import { normalizeAngle } from "@shared/rotation";
import { assertArray, assertFiniteNumber, assertOneOf, assertRecord, clamp, escapeXml } from "./_shared";

type PixelConcealRegion = {
  bounds: { left: number; top: number; width: number; height: number };
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
  shape: ConcealShape;
};

export function validateConcealRegionList(value: unknown, path: string): ConcealRegion[] {
  return assertArray(value, path).map((entry, index) => {
    const record = assertRecord(entry, `${path}[${index}]`);
    return {
      x: assertFiniteNumber(record.x, `${path}[${index}].x`, { min: 0, max: 1 }),
      y: assertFiniteNumber(record.y, `${path}[${index}].y`, { min: 0, max: 1 }),
      w: assertFiniteNumber(record.w, `${path}[${index}].w`, { min: 0, max: 1, minExclusive: true }),
      h: assertFiniteNumber(record.h, `${path}[${index}].h`, { min: 0, max: 1, minExclusive: true }),
      rotation: normalizeAngle(assertFiniteNumber(record.rotation, `${path}[${index}].rotation`)),
      shape: assertOneOf(record.shape, `${path}[${index}].shape`, CONCEAL_SHAPES)
    };
  });
}

export function fillOverlayFromConcealRegion(
  region: ConcealRegion,
  sourceWidth: number,
  sourceHeight: number,
  fill: string
): sharp.OverlayOptions {
  const projected = projectConcealRegion(region, sourceWidth, sourceHeight);
  return {
    input: shapeSvg(projected, fill),
    left: projected.bounds.left,
    top: projected.bounds.top
  };
}

export async function compositeMaskedOverlayFromConcealRegion(
  image: sharp.Sharp,
  region: ConcealRegion,
  sourceWidth: number,
  sourceHeight: number,
  transform: (regionImage: sharp.Sharp, size: { width: number; height: number }) => sharp.Sharp | Promise<sharp.Sharp>
): Promise<sharp.OverlayOptions> {
  const projected = projectConcealRegion(region, sourceWidth, sourceHeight);
  const transformedImage = await transform(image.clone().extract(projected.bounds), {
    width: projected.bounds.width,
    height: projected.bounds.height
  });
  const transformed = await transformedImage.ensureAlpha().png().toBuffer();
  const masked = await sharp(transformed)
    .composite([{ input: shapeSvg(projected, "#ffffff"), blend: "dest-in" }])
    .png()
    .toBuffer();
  return {
    input: masked,
    left: projected.bounds.left,
    top: projected.bounds.top
  };
}

function projectConcealRegion(region: ConcealRegion, sourceWidth: number, sourceHeight: number): PixelConcealRegion {
  const longEdge = Math.max(sourceWidth, sourceHeight, 1);
  const width = Math.max(1, region.w * longEdge);
  const height = Math.max(1, region.h * longEdge);
  const centerX = (region.x + region.w / 2) * longEdge;
  const centerY = (region.y + region.h / 2) * longEdge;
  const rotation = normalizeAngle(region.rotation);
  const bounds = rotatedBounds(centerX, centerY, width, height, rotation);
  const left = clamp(Math.floor(bounds.minX), 0, Math.max(0, sourceWidth - 1));
  const top = clamp(Math.floor(bounds.minY), 0, Math.max(0, sourceHeight - 1));
  const right = clamp(Math.ceil(bounds.maxX), left + 1, sourceWidth);
  const bottom = clamp(Math.ceil(bounds.maxY), top + 1, sourceHeight);
  return {
    bounds: {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    },
    centerX: centerX - left,
    centerY: centerY - top,
    width,
    height,
    rotation,
    shape: region.shape
  };
}

function rotatedBounds(centerX: number, centerY: number, width: number, height: number, rotation: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const radians = rotation * (Math.PI / 180);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const extentX = Math.abs(halfWidth * Math.cos(radians)) + Math.abs(halfHeight * Math.sin(radians));
  const extentY = Math.abs(halfWidth * Math.sin(radians)) + Math.abs(halfHeight * Math.cos(radians));
  return {
    minX: centerX - extentX,
    minY: centerY - extentY,
    maxX: centerX + extentX,
    maxY: centerY + extentY
  };
}

function shapeSvg(region: PixelConcealRegion, fill: string): Buffer {
  const centerX = formatSvgNumber(region.centerX);
  const centerY = formatSvgNumber(region.centerY);
  const width = formatSvgNumber(region.width);
  const height = formatSvgNumber(region.height);
  const rotation = formatSvgNumber(region.rotation);
  const shape = region.shape === "ellipse"
    ? `<ellipse cx="${centerX}" cy="${centerY}" rx="${formatSvgNumber(region.width / 2)}" ry="${formatSvgNumber(region.height / 2)}" transform="rotate(${rotation} ${centerX} ${centerY})" fill="${escapeXml(fill)}" />`
    : `<rect x="${formatSvgNumber(region.centerX - region.width / 2)}" y="${formatSvgNumber(region.centerY - region.height / 2)}" width="${width}" height="${height}" transform="rotate(${rotation} ${centerX} ${centerY})" fill="${escapeXml(fill)}" />`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${region.bounds.width}" height="${region.bounds.height}" viewBox="0 0 ${region.bounds.width} ${region.bounds.height}">${shape}</svg>`,
    "utf8"
  );
}

function formatSvgNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
