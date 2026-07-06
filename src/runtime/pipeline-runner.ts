import fs from "node:fs/promises";
import type { Pipeline } from "@shared/types/pipeline";
import { getOpModule } from "@core/ops/catalog";
import { decodeImage } from "./decode";
import { applyOutputEncoding } from "./encode";
import { sha256Bytes } from "./hash";
import { asPipelineError, type PipelineErrorCategory } from "./pipeline-error";
import type { CubeLut } from "./lut-cube";
import type * as sharp from "sharp";

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
  const { image } = await runPhase("decode", () => decodeImage(ctx.sourcePath));
  let work = image.sharp;
  let workWidth = image.width;
  let workHeight = image.height;

  if (ctx.previewLongEdge) {
    const previewLongEdge = ctx.previewLongEdge;
    const longest = Math.max(workWidth, workHeight);
    if (longest > 0) {
      const sharpImpl = (await import("sharp")).default;
      // Down-resizing the decoded source is a transform, not source parsing, so a failure
      // here is categorized "process" (deterministic), not "decode".
      const { data, info } = await runPhase("process", () => work
        .resize({ width: previewLongEdge, height: previewLongEdge, fit: "inside" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }));
      work = sharpImpl(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      workWidth = info.width;
      workHeight = info.height;
    }
  }

  const rendered = await runPhase("process", () => applyPipelineOps(work, workWidth, workHeight, pipeline, ctx));
  work = rendered.image;
  workWidth = rendered.width;
  workHeight = rendered.height;

  const appliedPipeline: Pipeline = { ...pipeline, ops: pipeline.ops };

  if (ctx.outputPath) {
    const outputPath = ctx.outputPath;
    const encoded = await runPhase("encode", () => applyOutputEncoding(work, pipeline.output).toBuffer());
    // not recorded: this is the rendered OUTPUT image — a binary the app writes for the user to keep, not
    // managed text the app reloads as its own state. It is a plain (non-atomic) write that never touches the
    // managed-text choke point, so it never reaches the backup hook (data-backup conventions: binaries and
    // harvest-then-keep output are excluded by write-path).
    await runPhase("io", () => fs.writeFile(outputPath, encoded));
    return {
      kind: "file",
      outputPath,
      outputHash: sha256Bytes(encoded),
      bytes: encoded.byteLength,
      appliedPipeline
    };
  }

  const { data: raw, info } = await runPhase("encode", () => work.ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  return { kind: "buffer", bytes: raw, width: info.width, height: info.height, appliedPipeline };
}

// Run a pipeline phase, tagging any failure with the phase it occurred in so the caller
// can decide retryability from the category instead of parsing the error message.
async function runPhase<T>(phase: PipelineErrorCategory, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw asPipelineError(error, phase);
  }
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
  const rendered = await runPhase("process", () => applyPipelineOps(image, source.width, source.height, pipeline, ctx));
  const { data: raw, info } = await runPhase("encode", () => rendered.image.ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
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
