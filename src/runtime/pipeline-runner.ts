import fs from "node:fs/promises";
import type { Pipeline } from "@shared/types/pipeline";
import { getOpModule } from "@core/ops/catalog";
import { decodeImage } from "./decode";
import { applyOutputEncoding } from "./encode";
import { sha256Bytes } from "./hash";
import type { CubeLut } from "./lut-cube";
import type sharp from "sharp";

type PipelineRunContext = {
  sourcePath: string;
  outputPath?: string;
  previewLongEdge?: number;
  resolveLut?: (cubePath: string) => Promise<CubeLut>;
};

type PipelineRunResult =
  | { kind: "buffer"; bytes: Buffer; width: number; height: number; appliedPipeline: Pipeline }
  | { kind: "file"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline };

type RawPipelineRunContext = Pick<PipelineRunContext, "resolveLut">;

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

  const rendered = await applyPipelineOps(work, workWidth, workHeight, pipeline, ctx);
  work = rendered.image;
  workWidth = rendered.width;
  workHeight = rendered.height;

  const appliedPipeline: Pipeline = { ...pipeline, ops: pipeline.ops };

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

export async function runPipelineFromRaw(
  pipeline: Pipeline,
  source: { bytes: Buffer; width: number; height: number },
  ctx: RawPipelineRunContext
): Promise<Extract<PipelineRunResult, { kind: "buffer" }>> {
  const sharpImpl = (await import("sharp")).default;
  const image = sharpImpl(source.bytes, {
    raw: {
      width: source.width,
      height: source.height,
      channels: 4
    }
  });
  const rendered = await applyPipelineOps(image, source.width, source.height, pipeline, ctx);
  const { data: raw, info } = await rendered.image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { kind: "buffer", bytes: raw, width: info.width, height: info.height, appliedPipeline: pipeline };
}

async function applyPipelineOps(
  image: sharp.Sharp,
  width: number,
  height: number,
  pipeline: Pipeline,
  ctx: RawPipelineRunContext
): Promise<{ image: sharp.Sharp; width: number; height: number }> {
  let work = image;
  let workWidth = width;
  let workHeight = height;

  for (const op of pipeline.ops) {
    if (!op.enabled) continue;
    const module = getOpModule(op.type);
    if (!module || module.metadataOnly || !module.apply) continue;

    const result = await module.apply(work, op.params, {
      sourceWidth: workWidth,
      sourceHeight: workHeight,
      resolveLut: ctx.resolveLut
    });

    if (isImageFrame(result)) {
      work = result.image;
      workWidth = result.width;
      workHeight = result.height;
    } else {
      work = result;
    }
  }

  return { image: work, width: workWidth, height: workHeight };
}

function isImageFrame(value: sharp.Sharp | { image: sharp.Sharp; width: number; height: number }): value is { image: sharp.Sharp; width: number; height: number } {
  return typeof value === "object"
    && value !== null
    && "image" in value
    && "width" in value
    && "height" in value;
}
