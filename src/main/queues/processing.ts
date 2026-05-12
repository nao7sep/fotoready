import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { nowIso } from "@shared/time";
import type { Project, Task, TaskError } from "@shared/types/project";
import type { GlobalSettings, MetadataFields, MetadataStripMode } from "@shared/types/settings";
import type { OutputSettings, Pipeline } from "@shared/types/pipeline";
import { runPipeline } from "@runtime/pipeline-runner";
import { injectMetadata, stripMetadata, writeOutputDates } from "@adapters/metadata/exiftool";
import { loadCubeLut } from "@adapters/lut/cube-loader";
import type { SourceJpegFacts } from "@runtime/jpeg-quality/detect";
import { sha256Bytes } from "@runtime/hash";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { resolveOriginalSourcePath } from "@main/project/source-resolver";

export async function processTask(
  project: Project,
  taskId: string,
  projectPath: string | null,
  settings: GlobalSettings,
  sourceFacts: SourceJpegFacts | null = null,
  onUpdate?: () => void | Promise<void>,
  workerPool?: PipelineWorkerPool | null
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
    const sourcePath = await resolveOriginalSourcePath(original, { projectPath, outputDir: project.outputDir });
    const outputPath = await stagedOutputPath(project, task, sourcePath, projectPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const result = await processOutputPipeline(task.pipeline, sourcePath, original.sourceHash, original.size, outputPath, settings, sourceFacts, workerPool);

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
  sourceHash: string,
  sourceBytes: number,
  outputPath: string,
  settings: GlobalSettings,
  sourceFacts: SourceJpegFacts | null,
  workerPool?: PipelineWorkerPool | null
): Promise<{ kind: "file"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline }> {
  if (pipeline.output.format === "jpeg" && pipeline.output.quality === "match-source-size") {
    return processMatchSourceSize(pipeline, sourcePath, sourceHash, sourceBytes, outputPath, settings, sourceFacts, workerPool);
  }

  const resolved = resolveOutputQuality(pipeline, settings, sourceFacts);
  if (workerPool) {
    const result = await workerPool.process({ sourcePath, sourceHash, outputPath, pipeline: resolved });
    return { ...result, kind: "file" };
  }

  const result = await runPipeline(resolved, { sourcePath, sourceHash, outputPath, resolveLut: loadCubeLut });
  if (result.kind !== "file") throw new Error("Processing did not produce an output file.");
  return result;
}

function resolveOutputQuality(pipeline: Pipeline, settings: GlobalSettings, sourceFacts: SourceJpegFacts | null): Pipeline {
  if (pipeline.output.format !== "jpeg") return pipeline;
  if (pipeline.output.quality === "match-source-quality") {
    return {
      ...pipeline,
      output: {
        ...pipeline.output,
        quality: sourceFacts?.jpegQualityEstimate?.value ?? settings.jpegQualityOnDetectionFailure
      }
    };
  }
  return pipeline;
}

async function processMatchSourceSize(
  pipeline: Pipeline,
  sourcePath: string,
  sourceHash: string,
  targetBytes: number,
  outputPath: string,
  settings: GlobalSettings,
  sourceFacts: SourceJpegFacts | null,
  workerPool?: PipelineWorkerPool | null
): Promise<{ kind: "file"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline }> {
  const rendered = workerPool
    ? await workerPool.renderBuffer({ sourcePath, sourceHash, pipeline, previewLongEdge: null })
    : await runPipeline(pipeline, { sourcePath, sourceHash, resolveLut: loadCubeLut });
  if (rendered.kind !== "buffer" && rendered.kind !== "preview") throw new Error("Match-source-size render did not produce a raw buffer.");

  const startQuality = sourceFacts?.jpegQualityEstimate?.value ?? settings.jpegQualityOnDetectionFailure;
  const bytes = rendered.kind === "preview" ? Buffer.from(rendered.bitmap) : rendered.bytes;
  const encoded = await encodeJpegToTargetSize(bytes, rendered.width, rendered.height, pipeline.output, targetBytes, startQuality);
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
  const keep = task.metadataStripOverride ?? policy.keep;
  await stripMetadata(outputPath, keep);
  await writeOutputDates(outputPath, sourcePath, settings.preserveSourceDates, savedAt);
  if (Object.keys(policy.injectFields).length > 0) {
    await injectMetadata(outputPath, policy.injectFields);
  }
  const bytes = await fs.readFile(outputPath);
  return { outputHash: sha256Bytes(bytes) };
}

function metadataPolicy(task: Task, settings: GlobalSettings): { keep: MetadataStripMode; injectFields: MetadataFields } {
  let keep = settings.defaultMetadataStrip;
  let injectFields = settings.injectAuthorCopyright ? settings.injectFields : {};

  for (const op of task.pipeline.ops) {
    if (!op.enabled) continue;
    if (op.type === "strip-metadata" && Array.isArray(op.params.keep)) {
      keep = op.params.keep.filter((field): field is MetadataStripMode[number] =>
        field === "author" || field === "copyright" || field === "orientation" || field === "colorspace"
      );
    }
    if (op.type === "inject-metadata" && op.params.fields && typeof op.params.fields === "object") {
      injectFields = { ...injectFields, ...(op.params.fields as MetadataFields) };
    }
  }

  return { keep, injectFields };
}

async function stagedOutputPath(project: Project, task: Task, sourcePath: string, projectPath: string | null): Promise<string> {
  const outputDir = resolveOutputDir(project.outputDir, projectPath);
  const parsed = path.parse(sourcePath);
  const ext = task.pipeline.output.format === "jpeg" ? "jpg" : task.pipeline.output.format;
  return path.join(outputDir, `${parsed.name}-${nanoid(8)}.${ext}`);
}

function resolveOutputDir(outputDir: string, projectPath: string | null): string {
  if (path.isAbsolute(outputDir)) return outputDir;
  const baseDir = projectPath ? path.dirname(projectPath) : process.cwd();
  return path.resolve(baseDir, outputDir);
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
