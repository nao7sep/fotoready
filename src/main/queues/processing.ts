import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { nowIso } from "@shared/time";
import type { Project, Task, TaskError } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import type { OutputSettings, Pipeline } from "@shared/types/pipeline";
import { runPipeline } from "@runtime/pipeline-runner";
import { injectMetadata, stripMetadata } from "@adapters/metadata/exiftool";
import type { SourceJpegFacts } from "@runtime/jpeg-quality/detect";
import { sha256Bytes } from "@runtime/hash";

export async function processTask(
  project: Project,
  taskId: string,
  projectPath: string | null,
  settings: GlobalSettings,
  sourceFacts: SourceJpegFacts | null = null
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

  try {
    const outputPath = await stagedOutputPath(project, task, original.sourcePath, projectPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const result = task.pipeline.output.format === "jpeg" && task.pipeline.output.quality === "match-source-size"
      ? await processMatchSourceSize(task.pipeline, original.sourcePath, original.sourceHash, original.size, outputPath, settings, sourceFacts)
      : await runPipeline(resolveOutputQuality(task.pipeline, settings, sourceFacts), {
        sourcePath: original.sourcePath,
        sourceHash: original.sourceHash,
        outputPath
      });

    if (result.kind !== "file") {
      throw new Error("Processing did not produce an output file.");
    }

    await applyMetadataPolicy(result.outputPath, task, settings);

    task.pipeline = result.appliedPipeline;
    task.status = "done";
    task.output = {
      stagedPath: result.outputPath,
      stagedAt: nowIso(),
      outputHash: result.outputHash,
      vision: null,
      finalPath: null,
      renamedAt: null
    };
    task.updatedAt = nowIso();
  } catch (error) {
    task.status = "error";
    task.error = taskError(error);
    task.updatedAt = nowIso();
  }
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
  sourceFacts: SourceJpegFacts | null
): Promise<{ kind: "file"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline }> {
  const rendered = await runPipeline(pipeline, {
    sourcePath,
    sourceHash
  });
  if (rendered.kind !== "buffer") {
    throw new Error("Match-source-size render did not produce a raw buffer.");
  }

  const startQuality = sourceFacts?.jpegQualityEstimate?.value ?? settings.jpegQualityOnDetectionFailure;
  const encoded = await encodeJpegToTargetSize(rendered.bytes, rendered.width, rendered.height, pipeline.output, targetBytes, startQuality);
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

async function applyMetadataPolicy(outputPath: string, task: Task, settings: GlobalSettings): Promise<void> {
  const keep = task.metadataStripOverride ?? settings.defaultMetadataStrip;
  await stripMetadata(outputPath, keep);
  if (settings.injectAuthorCopyright) {
    await injectMetadata(outputPath, settings.injectFields);
  }
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
