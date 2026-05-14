import fs from "node:fs/promises";
import type sharp from "sharp";
import type { OpInstance } from "@shared/types/op";
import type { Pipeline } from "@shared/types/pipeline";
import { decodeImage } from "./decode";
import { applyOutputEncoding } from "./encode";
import { sha256Bytes } from "./hash";
import { sampleCubeLut, type CubeLut } from "./lut/cube";

export type PipelineRunContext = {
  sourcePath: string;
  sourceHash: string;
  outputPath?: string;
  previewLongEdge?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
  resolveLut?: (cubePath: string) => Promise<CubeLut>;
};

export type PipelineRunResult =
  | { kind: "buffer"; bytes: Buffer; width: number; height: number; appliedPipeline: Pipeline }
  | { kind: "file"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline };

export async function runPipeline(pipeline: Pipeline, ctx: PipelineRunContext): Promise<PipelineRunResult> {
  const { image } = await decodeImage(ctx.sourcePath);
  let work = image.sharp;
  let workWidth = image.width;
  let workHeight = image.height;

  if (ctx.previewLongEdge) {
    const longest = Math.max(workWidth, workHeight);
    if (longest > 0) {
      const { data, info } = await work
        .resize({ width: ctx.previewLongEdge, height: ctx.previewLongEdge, fit: "inside" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      work = (await import("sharp")).default(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      workWidth = info.width;
      workHeight = info.height;
    }
  }

  const executedOps = orderOpsForExecution(pipeline.ops, ctx.log);

  for (const op of executedOps) {
    if (!op.enabled) continue;
    work = await applyOp(work, op, workWidth, workHeight, ctx);
    // After any op that changes image dimensions, materialize the result so subsequent ops
    // receive accurate workWidth/workHeight values.  Using an analytical formula for crop
    // is fragile (any rounding divergence from applyCrop causes a cascade); materializing
    // is slower but correct for all three dimension-changing op types.
    if (op.type === "crop" || op.type === "resize" || op.type === "rotate") {
      const sharpImpl = await import("sharp");
      const { data, info } = await work.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      work = sharpImpl.default(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      workWidth = info.width;
      workHeight = info.height;
    }
  }

  const appliedPipeline: Pipeline = {
    ...pipeline,
    ops: executedOps
  };

  if (ctx.outputPath) {
    const encoded = await applyOutputEncoding(work, pipeline.output).toBuffer();
    await fs.writeFile(ctx.outputPath, encoded);
    return {
      kind: "file",
      outputPath: ctx.outputPath,
      outputHash: sha256Bytes(encoded),
      bytes: encoded.byteLength,
      appliedPipeline
    };
  }

  const { data: raw, info } = await work.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    kind: "buffer",
    bytes: raw,
    width: info.width,
    height: info.height,
    appliedPipeline
  };
}

export function orderOpsForExecution(ops: OpInstance[], log?: PipelineRunContext["log"]): OpInstance[] {
  const resizeIndex = ops.findIndex((op) => op.enabled && op.type === "resize");
  if (resizeIndex === -1) return ops;

  const outputSharpenOps = ops.filter(
    (op, index) => index < resizeIndex && op.enabled && op.type === "unsharp-mask" && op.params.outputSharpen === true
  );
  if (outputSharpenOps.length === 0) return ops;

  log?.("reordered output sharpening after resize", { count: outputSharpenOps.length });

  const withoutMoved = ops.filter((op) => !outputSharpenOps.includes(op));
  const afterResize = withoutMoved.findIndex((op) => op.enabled && op.type === "resize") + 1;
  return [...withoutMoved.slice(0, afterResize), ...outputSharpenOps, ...withoutMoved.slice(afterResize)];
}

async function applyOp(
  image: sharp.Sharp,
  op: OpInstance,
  sourceWidth: number,
  sourceHeight: number,
  ctx: Pick<PipelineRunContext, "resolveLut">
): Promise<sharp.Sharp> {
  switch (op.type) {
    case "crop":
      return applyCrop(image, op, sourceWidth, sourceHeight);
    case "rotate":
      return image.rotate(numberParam(op, "degrees", 0), { background: stringParam(op, "fillColor", "#ffffff") });
    case "resize":
      return applyResize(image, op);
    case "levels":
      return applyLevels(image, op);
    case "curves":
      return applyCurves(image, op);
    case "hsl":
      return applyHsl(image, op);
    case "white-balance":
      return applyWhiteBalance(image, op);
    case "auto-tone":
      return op.params.enabled === false ? image : image.normalize();
    case "unsharp-mask":
      return image.sharpen({
        sigma: Math.max(0.3, numberParam(op, "radius", 1)),
        m1: numberParam(op, "amount", 1)
      });
    case "denoise":
      return image.median(Math.max(1, Math.round(numberParam(op, "strength", 0.3) * 3)));
    case "redact-fill":
      return applyFillRedaction(image, op, sourceWidth, sourceHeight);
    case "redact-blur":
      return applyBlurRedaction(image, op, sourceWidth, sourceHeight);
    case "redact-pixelate":
      return applyPixelateRedaction(image, op, sourceWidth, sourceHeight);
    case "watermark-text":
      return applyTextWatermark(image, op, sourceWidth, sourceHeight);
    case "watermark-image":
      return applyImageWatermark(image, op, sourceWidth, sourceHeight);
    case "lut":
      return applyLut(image, op, ctx.resolveLut);
    default:
      return image;
  }
}

function applyCrop(image: sharp.Sharp, op: OpInstance, sourceWidth: number, sourceHeight: number): sharp.Sharp {
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const left = Math.max(0, Math.round(numberParam(op, "x", 0) * longEdge));
  const top = Math.max(0, Math.round(numberParam(op, "y", 0) * longEdge));
  const width = Math.max(1, Math.round(numberParam(op, "w", sourceWidth / longEdge) * longEdge));
  const height = Math.max(1, Math.round(numberParam(op, "h", sourceHeight / longEdge) * longEdge));
  return image.extract({ left, top, width: Math.min(width, sourceWidth - left), height: Math.min(height, sourceHeight - top) });
}

function applyResize(image: sharp.Sharp, op: OpInstance): sharp.Sharp {
  const mode = stringParam(op, "mode", "long-edge");
  const value = Math.max(1, Math.round(numberParam(op, "value", 1920)));

  if (mode === "width") return image.resize({ width: value });
  if (mode === "height") return image.resize({ height: value });
  if (mode === "fill") return image.resize({ width: value, height: value, fit: "cover" });
  if (mode === "fit") return image.resize({ width: value, height: value, fit: "inside" });
  if (mode === "short-edge") return image.resize({ width: value, height: value, fit: "outside" });
  return resizeLongEdge(image, value);
}

function resizeLongEdge(image: sharp.Sharp, value: number): sharp.Sharp {
  return image.resize({ width: value, height: value, fit: "inside", withoutEnlargement: true });
}

function applyLevels(image: sharp.Sharp, op: OpInstance): sharp.Sharp {
  const blackPoint = Math.max(0, Math.min(254, numberParam(op, "blackPoint", 0)));
  const whitePoint = Math.max(blackPoint + 1, Math.min(255, numberParam(op, "whitePoint", 255)));
  const gamma = Math.max(0.1, Math.min(5, numberParam(op, "gamma", 1)));
  const multiplier = 255 / (whitePoint - blackPoint);
  const offset = -blackPoint * multiplier;
  return image.linear(multiplier, offset).gamma(gamma);
}

async function applyWhiteBalance(image: sharp.Sharp, op: OpInstance): Promise<sharp.Sharp> {
  const samplePoint = samplePointParam(op.params.samplePoint);
  if (samplePoint) {
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width > 0 && height > 0) {
      const longEdge = Math.max(width, height);
      const sampleX = Math.max(0, Math.min(width - 1, Math.round(samplePoint[0] * longEdge)));
      const sampleY = Math.max(0, Math.min(height - 1, Math.round(samplePoint[1] * longEdge)));
      const raw = await image.clone().ensureAlpha().raw().toBuffer();
      const offset = (sampleY * width + sampleX) * 4;
      const redSample = raw[offset] ?? 0;
      const greenSample = raw[offset + 1] ?? 0;
      const blueSample = raw[offset + 2] ?? 0;
      const target = Math.max(1, (redSample + greenSample + blueSample) / 3);
      return image.linear([
        clamp(target / Math.max(1, redSample), 0.2, 4),
        clamp(target / Math.max(1, greenSample), 0.2, 4),
        clamp(target / Math.max(1, blueSample), 0.2, 4)
      ], [0, 0, 0]);
    }
  }

  const temperature = Math.max(-100, Math.min(100, numberParam(op, "temperature", 0)));
  const tint = Math.max(-100, Math.min(100, numberParam(op, "tint", 0)));
  const red = 1 + temperature / 500;
  const blue = 1 - temperature / 500;
  const green = 1 + tint / 700;
  return image.linear([red, green, blue], [0, 0, 0]);
}

async function applyCurves(image: sharp.Sharp, op: OpInstance): Promise<sharp.Sharp> {
  const lut = curveLookup(curvePointsParam(op.params.rgb));
  const { data: raw, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width <= 0 || height <= 0) return image;

  for (let offset = 0; offset < raw.length; offset += 4) {
    raw[offset] = lut[raw[offset]];
    raw[offset + 1] = lut[raw[offset + 1]];
    raw[offset + 2] = lut[raw[offset + 2]];
  }

  return (await import("sharp")).default(raw, {
    raw: {
      width,
      height,
      channels: 4
    }
  });
}

async function applyHsl(image: sharp.Sharp, op: OpInstance): Promise<sharp.Sharp> {
  const { data: raw, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width <= 0 || height <= 0) return image;

  for (let offset = 0; offset < raw.length; offset += 4) {
    const hsl = rgbToHsl(raw[offset], raw[offset + 1], raw[offset + 2]);
    const adjustment = hslAdjustmentForHue(op, hsl.h);
    if (!adjustment) continue;
    const rgb = hslToRgb(
      wrapHue(hsl.h + adjustment.hue),
      clamp01(hsl.s * (1 + adjustment.sat)),
      clamp01(hsl.l + adjustment.lum)
    );
    raw[offset] = rgb.r;
    raw[offset + 1] = rgb.g;
    raw[offset + 2] = rgb.b;
  }

  return (await import("sharp")).default(raw, {
    raw: {
      width,
      height,
      channels: 4
    }
  });
}

function applyFillRedaction(image: sharp.Sharp, op: OpInstance, sourceWidth: number, sourceHeight: number): sharp.Sharp {
  const rects = rectsParam(op.params.rects);
  if (rects.length === 0) return image;

  const longEdge = Math.max(sourceWidth, sourceHeight);
  return image.composite(rects.map((rect) => {
    const left = Math.max(0, Math.round(rect.x * longEdge));
    const top = Math.max(0, Math.round(rect.y * longEdge));
    const width = Math.max(1, Math.round(rect.w * longEdge));
    const height = Math.max(1, Math.round(rect.h * longEdge));
    return {
      input: {
        create: {
          width: Math.min(width, sourceWidth - left),
          height: Math.min(height, sourceHeight - top),
          channels: 4 as const,
          background: stringParam(op, "color", "#000000")
        }
      },
      left,
      top
    };
  }));
}

function applyTextWatermark(image: sharp.Sharp, op: OpInstance, sourceWidth: number, sourceHeight: number): sharp.Sharp {
  const text = stringParam(op, "text", "");
  if (!text.trim()) return image;

  const longEdge = Math.max(sourceWidth, sourceHeight);
  const fontSize = Math.max(8, Math.round(numberParam(op, "size", 0.03) * longEdge));
  const opacity = Math.max(0, Math.min(1, numberParam(op, "opacity", 0.7)));
  const marginX = Math.round(numberParam(op, "marginX", 0.02) * longEdge);
  const marginY = Math.round(numberParam(op, "marginY", 0.02) * longEdge);
  const svgWidth = Math.min(sourceWidth, Math.max(fontSize * 4, text.length * fontSize));
  const svgHeight = Math.ceil(fontSize * 1.6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
  <text x="0" y="${Math.round(fontSize * 1.15)}" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize}" fill="${escapeXml(stringParam(op, "color", "#ffffff"))}" fill-opacity="${opacity}">${escapeXml(text)}</text>
</svg>`;
  const anchor = stringParam(op, "anchor", "bottom-right");
  const { left, top } = anchorPosition(anchor, sourceWidth, sourceHeight, svgWidth, svgHeight, marginX, marginY);

  return image.composite([{ input: Buffer.from(svg), left, top }]);
}

async function applyBlurRedaction(image: sharp.Sharp, op: OpInstance, sourceWidth: number, sourceHeight: number): Promise<sharp.Sharp> {
  const rects = rectsParam(op.params.rects);
  if (rects.length === 0) return image;

  const overlays = await Promise.all(rects.map(async (rect) => {
    const region = regionFromRect(rect, sourceWidth, sourceHeight);
    const input = await image
      .clone()
      .extract(region)
      .blur(Math.max(0.3, numberParam(op, "radius", 20)))
      .toBuffer();
    return { input, left: region.left, top: region.top };
  }));

  return image.composite(overlays);
}

async function applyPixelateRedaction(image: sharp.Sharp, op: OpInstance, sourceWidth: number, sourceHeight: number): Promise<sharp.Sharp> {
  const rects = rectsParam(op.params.rects);
  if (rects.length === 0) return image;

  const longEdge = Math.max(sourceWidth, sourceHeight);
  const blockSize = Math.max(2, Math.round(numberParam(op, "blockSize", 0.015) * longEdge));
  const overlays = await Promise.all(rects.map(async (rect) => {
    const region = regionFromRect(rect, sourceWidth, sourceHeight);
    const tinyWidth = Math.max(1, Math.ceil(region.width / blockSize));
    const tinyHeight = Math.max(1, Math.ceil(region.height / blockSize));
    const input = await image
      .clone()
      .extract(region)
      .resize(tinyWidth, tinyHeight, { kernel: "nearest" })
      .resize(region.width, region.height, { kernel: "nearest" })
      .toBuffer();
    return { input, left: region.left, top: region.top };
  }));

  return image.composite(overlays);
}

async function applyImageWatermark(image: sharp.Sharp, op: OpInstance, sourceWidth: number, sourceHeight: number): Promise<sharp.Sharp> {
  const pngPath = stringParam(op, "pngPath", "");
  if (!pngPath) return image;

  const longEdge = Math.max(sourceWidth, sourceHeight);
  const scale = Math.max(0.01, Math.min(1, numberParam(op, "scale", 0.15)));
  const width = Math.max(1, Math.round(longEdge * scale));
  const marginX = Math.round(numberParam(op, "marginX", 0.02) * longEdge);
  const marginY = Math.round(numberParam(op, "marginY", 0.02) * longEdge);
  const opacity = Math.max(0, Math.min(1, numberParam(op, "opacity", 0.7)));
  const watermark = await (await import("sharp")).default(pngPath)
    .resize({ width, withoutEnlargement: true })
    .ensureAlpha()
    .modulate({ brightness: opacity })
    .toBuffer({ resolveWithObject: true });
  const { left, top } = anchorPosition(stringParam(op, "anchor", "bottom-right"), sourceWidth, sourceHeight, watermark.info.width, watermark.info.height, marginX, marginY);

  return image.composite([{ input: watermark.data, left, top }]);
}

async function applyLut(
  image: sharp.Sharp,
  op: OpInstance,
  resolveLut: PipelineRunContext["resolveLut"]
): Promise<sharp.Sharp> {
  const cubePath = stringParam(op, "cubePath", "");
  if (!cubePath) return image;
  if (!resolveLut) {
    throw new Error("LUT loading is not configured for this pipeline run.");
  }

  const lut = await resolveLut(cubePath);
  const strength = Math.max(0, Math.min(1, numberParam(op, "strength", 1)));
  const { data: raw, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width <= 0 || height <= 0) return image;

  for (let offset = 0; offset < raw.length; offset += 4) {
    const r = raw[offset] / 255;
    const g = raw[offset + 1] / 255;
    const b = raw[offset + 2] / 255;
    const sampled = sampleCubeLut(lut, r, g, b);
    raw[offset] = Math.max(0, Math.min(255, Math.round((r + (sampled[0] - r) * strength) * 255)));
    raw[offset + 1] = Math.max(0, Math.min(255, Math.round((g + (sampled[1] - g) * strength) * 255)));
    raw[offset + 2] = Math.max(0, Math.min(255, Math.round((b + (sampled[2] - b) * strength) * 255)));
  }

  return (await import("sharp")).default(raw, {
    raw: {
      width,
      height,
      channels: 4
    }
  });
}

function curvePointsParam(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [[0, 0], [255, 255]];
  const points = value
    .filter((point): point is [number, number] =>
      Array.isArray(point) &&
      point.length >= 2 &&
      typeof point[0] === "number" &&
      typeof point[1] === "number"
    )
    .map(([x, y]) => [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  return points.length >= 2 ? points : [[0, 0], [255, 255]];
}

function curveLookup(points: Array<[number, number]>): Uint8Array {
  const lut = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    const upperIndex = points.findIndex(([x]) => x >= value);
    if (upperIndex === -1) {
      lut[value] = Math.round(points[points.length - 1][1]);
      continue;
    }
    if (upperIndex <= 0) {
      lut[value] = Math.round(points[0][1]);
      continue;
    }
    const lower = points[upperIndex - 1];
    const upper = points[upperIndex];
    const span = Math.max(1, upper[0] - lower[0]);
    const t = (value - lower[0]) / span;
    lut[value] = Math.round(lower[1] + (upper[1] - lower[1]) * t);
  }
  return lut;
}

function hslAdjustmentForHue(op: OpInstance, hue: number): { hue: number; sat: number; lum: number } | null {
  const range = hueRangeName(hue);
  const params = op.params[range];
  if (!params || typeof params !== "object") return null;
  const values = params as Record<string, unknown>;
  return {
    hue: clampNumber(values.hue, -180, 180, 0),
    sat: clampNumber(values.sat, -1, 1, 0),
    lum: clampNumber(values.lum, -1, 1, 0)
  };
}

function hueRangeName(hue: number): string {
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 45) return "orange";
  if (hue < 75) return "yellow";
  if (hue < 165) return "green";
  if (hue < 195) return "aqua";
  if (hue < 255) return "blue";
  if (hue < 285) return "purple";
  return "magenta";
}

function rgbToHsl(rByte: number, gByte: number, bByte: number): { h: number; s: number; l: number } {
  const r = rByte / 255;
  const g = gByte / 255;
  const b = bByte / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const h = max === r
    ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
    : max === g
      ? ((b - r) / delta + 2) * 60
      : ((r - g) / delta + 4) * 60;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hueToRgb(p, q, h / 360 + 1 / 3);
  const g = hueToRgb(p, q, h / 360);
  const b = hueToRgb(p, q, h / 360 - 1 / 3);
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function hueToRgb(p: number, q: number, tValue: number): number {
  let t = tValue;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function wrapHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function samplePointParam(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (typeof value[0] !== "number" || typeof value[1] !== "number") return null;
  return [clamp(value[0], 0, 1), clamp(value[1], 0, 1)];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function numberParam(op: OpInstance, key: string, fallback: number): number {
  const value = op.params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(op: OpInstance, key: string, fallback: string): string {
  const value = op.params[key];
  return typeof value === "string" ? value : fallback;
}

function rectsParam(value: unknown): Array<{ x: number; y: number; w: number; h: number }> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { x: number; y: number; w: number; h: number } =>
    item !== null &&
    typeof item === "object" &&
    typeof (item as { x?: unknown }).x === "number" &&
    typeof (item as { y?: unknown }).y === "number" &&
    typeof (item as { w?: unknown }).w === "number" &&
    typeof (item as { h?: unknown }).h === "number"
  );
}

function regionFromRect(rect: { x: number; y: number; w: number; h: number }, sourceWidth: number, sourceHeight: number): { left: number; top: number; width: number; height: number } {
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const left = Math.max(0, Math.round(rect.x * longEdge));
  const top = Math.max(0, Math.round(rect.y * longEdge));
  const width = Math.max(1, Math.min(Math.round(rect.w * longEdge), sourceWidth - left));
  const height = Math.max(1, Math.min(Math.round(rect.h * longEdge), sourceHeight - top));
  return { left, top, width, height };
}

function anchorPosition(anchor: string, imageWidth: number, imageHeight: number, width: number, height: number, marginX: number, marginY: number): { left: number; top: number } {
  const horizontal = anchor.includes("left") ? "left" : anchor.includes("right") ? "right" : "center";
  const vertical = anchor.includes("top") ? "top" : anchor.includes("bottom") ? "bottom" : "center";
  const left = horizontal === "left" ? marginX : horizontal === "right" ? imageWidth - width - marginX : Math.round((imageWidth - width) / 2);
  const top = vertical === "top" ? marginY : vertical === "bottom" ? imageHeight - height - marginY : Math.round((imageHeight - height) / 2);
  return {
    left: Math.max(0, left),
    top: Math.max(0, top)
  };
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
