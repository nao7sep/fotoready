import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { nowIso } from "@shared/time";
import type { Project, Task, TaskError } from "@shared/types/project";
import type { GlobalSettings, MetadataFields, MetadataStripMode } from "@shared/types/settings";
import type { OutputSettings, Pipeline } from "@shared/types/pipeline";
import { copySourceMetadataGroups, injectMetadata, stripMetadata, writeOutputDates } from "@adapters/exiftool";
import { getOpModule, type MetadataDecision } from "@core/ops/catalog";
import { sha256Bytes } from "@runtime/hash";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { resolveOutputFormat, outputFormatExtension } from "@shared/output-format";
import { writeTaskSidecarFile } from "@main/task-sidecar";
import { resolveProjectOutputDir } from "@main/output-paths";

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
    const outputPath = await stagedOutputPath(project, task, original, sourcePath);
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
      stagedParamsPath: "",
      stagedAt: savedAt.toISOString(),
      outputHash: finalFacts.outputHash,
      vision: null,
      finalPath: null,
      finalParamsPath: null,
      renamedAt: null
    };
    task.output.stagedParamsPath = await writeTaskSidecarFile(result.outputPath, original, task, result.appliedPipeline);
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
  original: { size: number; format: string; jpegQualityEstimate: number | null },
  outputPath: string,
  settings: GlobalSettings,
  workerPool: PipelineWorkerPool
): Promise<{ kind: "file"; outputPath: string; outputHash: string; bytes: number; appliedPipeline: Pipeline }> {
  const resolved = resolvePipelineForSave(pipeline, original, settings);
  const result = await workerPool.process({ sourcePath, outputPath, pipeline: resolved });
  return { ...result, kind: "file" };
}

async function applyMetadataPolicy(outputPath: string, sourcePath: string, task: Task, settings: GlobalSettings, savedAt: Date): Promise<{ outputHash: string }> {
  const policy = metadataPolicy(task, settings);
  try {
    await stripMetadata(outputPath);
  } catch (error) {
    throw new Error(`Failed to strip metadata from the output file. ${errorMessage(error)}`);
  }
  if (policy.preserveSourceDates) {
    try {
      await writeOutputDates(outputPath, sourcePath, true, savedAt);
    } catch (error) {
      throw new Error(`Failed to write output dates. ${errorMessage(error)}`);
    }
  }
  if (policy.keep.length > 0) {
    try {
      await copySourceMetadataGroups(outputPath, sourcePath, policy.keep);
    } catch (error) {
      throw new Error(`Failed to copy retained metadata to the output file. ${errorMessage(error)}`);
    }
  }
  if (Object.keys(policy.injectFields).length > 0) {
    try {
      await injectMetadata(outputPath, policy.injectFields);
    } catch (error) {
      throw new Error(`Failed to write metadata to the output file. ${errorMessage(error)}`);
    }
  }
  const bytes = await fs.readFile(outputPath);
  return { outputHash: sha256Bytes(bytes) };
}

function metadataPolicy(task: Task, settings: GlobalSettings): { keep: MetadataStripMode; injectFields: MetadataFields; preserveSourceDates: boolean } {
  const decision: MetadataDecision = {
    keep: null,
    inject: settings.injectAuthorCopyright ? { ...settings.injectFields } : {}
  };

  for (const op of task.pipeline.ops) {
    if (!op.enabled) continue;
    const module = getOpModule(op.type);
    module?.contributeMetadata?.(op.params, decision);
  }

  const keep = decision.keep ?? settings.defaultMetadataStrip;
  return {
    keep,
    injectFields: decision.inject,
    preserveSourceDates: decision.keep ? false : settings.preserveSourceDates
  };
}

function resolvePipelineForSave(
  pipeline: Pipeline,
  original: { format: string; jpegQualityEstimate: number | null },
  settings: GlobalSettings
): Pipeline {
  const resolvedFormat = resolveOutputFormat(pipeline.output.format, original.format);
  return {
    ...pipeline,
    output: {
      ...pipeline.output,
      format: resolvedFormat,
      quality: resolveQualityForSave(pipeline.output, resolvedFormat, original, settings)
    }
  };
}

function resolveQualityForSave(
  output: OutputSettings,
  resolvedFormat: ReturnType<typeof resolveOutputFormat>,
  original: { format: string; jpegQualityEstimate: number | null },
  settings: GlobalSettings
): number {
  if (resolvedFormat === "jpeg") {
    if (typeof output.quality === "number") return output.quality;
    if (original.format === "jpeg" && original.jpegQualityEstimate !== null) return original.jpegQualityEstimate;
    return settings.jpegFixedQuality;
  }
  if (typeof output.quality === "number") return output.quality;
  if (resolvedFormat === "webp") return settings.defaultWebpQuality;
  if (resolvedFormat === "avif") return settings.defaultAvifQuality;
  return 82;
}

async function stagedOutputPath(project: Project, task: Task, original: { format: string }, sourcePath: string): Promise<string> {
  const outputDir = resolveProjectOutputDir(project.outputDir, sourcePath);
  const parsed = path.parse(sourcePath);
  const ext = outputFormatExtension(resolveOutputFormat(task.pipeline.output.format, original.format));
  return path.join(outputDir, `${parsed.name}-${nanoid(8)}.${ext}`);
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
