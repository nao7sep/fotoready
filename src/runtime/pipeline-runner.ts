import fs from "node:fs/promises";
import type { OpInstance } from "@shared/types/op";
import type { Pipeline } from "@shared/types/pipeline";
import { getOpModule, reorderHintFor } from "@core/ops/catalog";
import { decodeImage } from "./decode";
import { applyOutputEncoding } from "./encode";
import { sha256Bytes } from "./hash";
import type { CubeLut } from "./lut-cube";

type PipelineRunContext = {
  sourcePath: string;
  sourceHash: string;
  outputPath?: string;
  previewLongEdge?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
  resolveLut?: (cubePath: string) => Promise<CubeLut>;
};

type PipelineRunResult =
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
      const sharpImpl = (await import("sharp")).default;
      const { data, info } = await work
        .resize({ width: ctx.previewLongEdge, height: ctx.previewLongEdge, fit: "inside" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      work = sharpImpl(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      workWidth = info.width;
      workHeight = info.height;
    }
  }

  const executedOps = orderOpsForExecution(pipeline.ops, ctx.log);
  for (const op of executedOps) {
    if (!op.enabled) continue;
    const module = getOpModule(op.type);
    if (!module || module.metadataOnly || !module.apply) continue;

    work = await module.apply(work, op.params, {
      sourceWidth: workWidth,
      sourceHeight: workHeight,
      resolveLut: ctx.resolveLut
    });

    // Crop/resize/rotate change dimensions; materialize so subsequent ops see accurate width/height.
    if (op.type === "crop" || op.type === "resize" || op.type === "rotate") {
      const sharpImpl = (await import("sharp")).default;
      const { data, info } = await work.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      work = sharpImpl(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      workWidth = info.width;
      workHeight = info.height;
    }
  }

  const appliedPipeline: Pipeline = { ...pipeline, ops: executedOps };

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
  return { kind: "buffer", bytes: raw, width: info.width, height: info.height, appliedPipeline };
}

/**
 * Move ops marked `after-resize` to immediately follow the first enabled resize op.
 * Today only unsharp-mask with `outputSharpen: true` uses this.
 */
function orderOpsForExecution(ops: OpInstance[], log?: PipelineRunContext["log"]): OpInstance[] {
  const resizeIndex = ops.findIndex((op) => op.enabled && op.type === "resize");
  if (resizeIndex === -1) return ops;

  const moveable = ops.filter((op, index) => index < resizeIndex && op.enabled && reorderHintFor(op) === "after-resize");
  if (moveable.length === 0) return ops;

  log?.("reordered output sharpening after resize", { count: moveable.length });
  const remaining = ops.filter((op) => !moveable.includes(op));
  const afterResize = remaining.findIndex((op) => op.enabled && op.type === "resize") + 1;
  return [...remaining.slice(0, afterResize), ...moveable, ...remaining.slice(afterResize)];
}

