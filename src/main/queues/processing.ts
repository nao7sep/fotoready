import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { nowIso } from "@shared/time";
import type { Project, Task, TaskError } from "@shared/types/project";
import type { GlobalSettings, MetadataFields, MetadataStripMode } from "@shared/types/settings";
import type { OutputSettings, Pipeline } from "@shared/types/pipeline";
import { injectMetadata, stripMetadata, writeOutputDates } from "@adapters/metadata/exiftool";
import { getOpModule, type MetadataDecision } from "@core/ops/catalog";
import { detectJpegQuality } from "@runtime/jpeg-quality/detect";
import { sha256Bytes } from "@runtime/hash";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";

export async function processTask(
  project: Project,
  taskId: string,
  settings: GlobalSettings,
  onUpdate: (() => void | Promise<void>) | undefined,
  workerPool: PipelineWorkerPool
): Promise<void> {
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const original = project.originals.find((item) => item.id === task.originalId);
  if (!original) {
    throw new Error(`Original not found for task: ${task.id}`);
  }

  task.status = "processing";
  task.error = null;
  task.updatedAt = nowIso();
  await onUpdate?.();

  try {
    const sourcePath = original.sourcePath;
    const outputPath = await stagedOutputPath(project, task, sourcePath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const result = await processOutputPipeline(task.pipeline, sourcePath, original, outputPath, settings, workerPool);

    if (result.kind !== "file") {
      throw new Error("Processing did not produce an output file.");
    }

    const savedAt = new Date();
    const finalFacts = await applyMetadataPolicy(result.outputPath, sourcePath, task, settings, savedAt);

    task.pipeline = result.appliedPipeline;
    task.status = "done";
    task.output = {
      stagedPath: result.outputPath,
      stagedAt: savedAt.toISOString(),
      outputHash: finalFacts.outputHash,
      vision: null,
      finalPath: null,
      renamedAt: null
    };
    task.updatedAt = nowIso();
    await onUpdate?.();
  } catch (error) {
    task.status = "error";
    task.error = taskError(error);
    task.updatedAt = nowIso();
    await onUpdate?.();
  }
}

async function processOutputPipeline(
  pipeline: Pipeline,
  sourcePath: string,
  original: { sourceHash: string; size: number; format: string },
  outputPath: string,
  settings: GlobalSettings,
  workerPool: PipelineWorkerPool
): Promise<{ kind: "file"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline }> {
  if (pipeline.output.format === "jpeg" && pipeline.output.quality === "match-source-size") {
    return processMatchSourceSize(pipeline, sourcePath, original, outputPath, settings, workerPool);
  }

  const resolved = pipeline.output.format === "jpeg" && pipeline.output.quality === "match-source-quality"
    ? { ...pipeline, output: { ...pipeline.output, quality: await sourceJpegQuality(sourcePath, original.format, settings) } }
    : pipeline;
  const result = await workerPool.process({ sourcePath, sourceHash: original.sourceHash, outputPath, pipeline: resolved });
  return { ...result, kind: "file" };
}

/** Estimate the source JPEG quality at save time. Returns the fallback for non-JPEG sources or detection failures. */
async function sourceJpegQuality(sourcePath: string, format: string, settings: GlobalSettings): Promise<number> {
  if (format !== "jpeg") return settings.jpegQualityOnDetectionFailure;
  const bytes = await fs.readFile(sourcePath);
  return detectJpegQuality(bytes).jpegQualityEstimate?.value ?? settings.jpegQualityOnDetectionFailure;
}

async function processMatchSourceSize(
  pipeline: Pipeline,
  sourcePath: string,
  original: { sourceHash: string; size: number; format: string },
  outputPath: string,
  settings: GlobalSettings,
  workerPool: PipelineWorkerPool
): Promise<{ kind: "file"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline }> {
  const rendered = await workerPool.renderBuffer({ sourcePath, sourceHash: original.sourceHash, pipeline, previewLongEdge: null });
  const startQuality = await sourceJpegQuality(sourcePath, original.format, settings);
  const encoded = await encodeJpegToTargetSize(Buffer.from(rendered.bitmap), rendered.width, rendered.height, pipeline.output, original.size, startQuality);
  await fs.writeFile(outputPath, encoded.bytes);

  return {
    kind: "file",
    outputPath,
    outputHash: sha256Bytes(encoded.bytes),
    bytes: encoded.bytes.byteLength,
    appliedPipeline: {
      ...rendered.appliedPipeline,
      output: {
        ...rendered.appliedPipeline.output,
        quality: encoded.quality
      }
    }
  };
}

async function encodeJpegToTargetSize(
  raw: Buffer,
  width: number,
  height: number,
  output: OutputSettings,
  targetBytes: number,
  startQuality: number
): Promise<{ bytes: Buffer; quality: number }> {
  let low = 1;
  let high = 100;
  let best: { bytes: Buffer; quality: number } | null = null;

  for (let iteration = 0; iteration < 7 && low <= high; iteration += 1) {
    const quality = iteration === 0 ? clampQuality(startQuality) : Math.floor((low + high) / 2);
    const bytes = await encodeJpeg(raw, width, height, output, quality);

    if (bytes.byteLength <= targetBytes) {
      best = { bytes, quality };
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }

  if (best) return best;
  const bytes = await encodeJpeg(raw, width, height, output, 1);
  return { bytes, quality: 1 };
}

async function encodeJpeg(raw: Buffer, width: number, height: number, output: OutputSettings, quality: number): Promise<Buffer> {
  return sharp(raw, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .flatten({ background: output.backgroundForTransparency })
    .jpeg({
      quality,
      progressive: output.jpegProgressive,
      chromaSubsampling: output.jpegChromaSubsampling
    })
    .toBuffer();
}

function clampQuality(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

async function applyMetadataPolicy(outputPath: string, sourcePath: string, task: Task, settings: GlobalSettings, savedAt: Date): Promise<{ outputHash: string }> {
  const policy = metadataPolicy(task, settings);
  try {
    await stripMetadata(outputPath, policy.keep);
  } catch (error) {
    throw new Error(`Failed to strip metadata from the output file. ${errorMessage(error)}`);
  }
  try {
    await writeOutputDates(outputPath, sourcePath, settings.preserveSourceDates, savedAt);
  } catch (error) {
    throw new Error(`Failed to write output dates. ${errorMessage(error)}`);
  }
  if (Object.keys(policy.injectFields).length > 0) {
    try {
      await injectMetadata(outputPath, policy.injectFields);
    } catch (error) {
      throw new Error(`Failed to inject metadata into the output file. ${errorMessage(error)}`);
    }
  }
  const bytes = await fs.readFile(outputPath);
  return { outputHash: sha256Bytes(bytes) };
}

function metadataPolicy(task: Task, settings: GlobalSettings): { keep: MetadataStripMode; injectFields: MetadataFields } {
  const decision: MetadataDecision = {
    keep: null,
    inject: settings.injectAuthorCopyright ? { ...settings.injectFields } : {}
  };

  for (const op of task.pipeline.ops) {
    if (!op.enabled) continue;
    const module = getOpModule(op.type);
    module?.contributeMetadata?.(op.params, decision);
  }

  return {
    keep: decision.keep ?? settings.defaultMetadataStrip,
    injectFields: decision.inject
  };
}

async function stagedOutputPath(project: Project, task: Task, sourcePath: string): Promise<string> {
  const outputDir = resolveOutputDir(project.outputDir, sourcePath);
  const parsed = path.parse(sourcePath);
  const ext = task.pipeline.output.format === "jpeg" ? "jpg" : task.pipeline.output.format;
  return path.join(outputDir, `${parsed.name}-${nanoid(8)}.${ext}`);
}

function resolveOutputDir(outputDir: string | null, sourcePath: string): string {
  if (!outputDir || outputDir.trim().length === 0) return path.dirname(sourcePath);
  if (path.isAbsolute(outputDir)) return outputDir;
  return path.resolve(process.cwd(), outputDir);
}

function taskError(error: unknown): TaskError {
  const known = error instanceof Error ? error : new Error(String(error));
  return {
    stage: "processing",
    message: known.message,
    detail: known.stack ?? null,
    occurredAt: nowIso(),
    retryable: !/unsupported|format/i.test(known.message)
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
