import fs from "node:fs/promises";
import type sharp from "sharp";
import type { OpInstance } from "@shared/types/op";
import type { Pipeline } from "@shared/types/pipeline";
import { decodeImage } from "./decode";
import { applyOutputEncoding } from "./encode";
import { sha256Bytes } from "./hash";

export type PipelineRunContext = {
  sourcePath: string;
  sourceHash: string;
  outputPath?: string;
  previewLongEdge?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

export type PipelineRunResult =
  | { kind: "buffer"; bytes: Buffer; width: number; height: number; appliedPipeline: Pipeline }
  | { kind: "file"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline };

export async function runPipeline(pipeline: Pipeline, ctx: PipelineRunContext): Promise<PipelineRunResult> {
  const { image, facts } = await decodeImage(ctx.sourcePath);
  let work = image.sharp;
  const executedOps = orderOpsForExecution(pipeline.ops, ctx.log);

  for (const op of executedOps) {
    if (!op.enabled) continue;
    work = applyOp(work, op, image.width, image.height);
  }

  if (ctx.previewLongEdge) {
    work = resizeLongEdge(work, ctx.previewLongEdge);
  }

  const metadata = await work.metadata();
  const appliedPipeline: Pipeline = {
    ...pipeline,
    ops: executedOps,
    appliedColorNormalization: {
      detectedProfile: facts.iccProfileSummary,
      detectedColorSpaceTag: facts.colorSpaceTag,
      assumed: facts.iccProfile ? null : facts.colorSpaceTag === null ? "srgb" : null,
      iccBakedIntoPixels: facts.iccProfile !== null
    },
    sourceSnapshot: {
      sha256: ctx.sourceHash,
      width: facts.width,
      height: facts.height,
      format: facts.format,
      jpegQualityEstimate: facts.jpegQualityEstimate
    },
    toolVersions: {
      fotoready: "0.1.0",
      sharp: "runtime",
      libvips: "runtime",
      exiftool: "runtime"
    }
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

  const raw = await work.ensureAlpha().raw().toBuffer();
  return {
    kind: "buffer",
    bytes: raw,
    width: metadata.width ?? facts.width,
    height: metadata.height ?? facts.height,
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

function applyOp(image: sharp.Sharp, op: OpInstance, sourceWidth: number, sourceHeight: number): sharp.Sharp {
  switch (op.type) {
    case "crop":
      return applyCrop(image, op, sourceWidth, sourceHeight);
    case "rotate":
      return image.rotate(numberParam(op, "degrees", 0), { background: stringParam(op, "fillColor", "#ffffff") });
    case "resize":
      return applyResize(image, op);
    case "unsharp-mask":
      return image.sharpen({
        sigma: Math.max(0.3, numberParam(op, "radius", 1)),
        m1: numberParam(op, "amount", 1)
      });
    case "denoise":
      return image.median(Math.max(1, Math.round(numberParam(op, "strength", 0.3) * 3)));
    case "redact-fill":
      return applyFillRedaction(image, op, sourceWidth, sourceHeight);
    case "watermark-text":
      return applyTextWatermark(image, op, sourceWidth, sourceHeight);
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
