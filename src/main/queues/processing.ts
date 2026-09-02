import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { nowIso } from "@shared/time";
import type { Project, Task, TaskError } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import type { OutputSettings, Pipeline } from "@shared/types/pipeline";
import { applyMetadataToOutput } from "@adapters/exiftool";
import { metadataPolicy } from "@main/metadata-policy";
import { sha256Bytes } from "@runtime/hash";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { resolveOutputFormat, outputFormatExtension } from "@shared/output-format";
import { writeTaskSidecarFile } from "@main/task-sidecar";
import { resolveProjectOutputDir } from "@main/output-paths";
import type { AppLogger } from "@main/logger";
import { PipelineError, isRetryableCategory } from "@runtime/pipeline-error";

export async function processTask(
  project: Project,
  taskId: string,
  settings: GlobalSettings,
  onUpdate: (() => void | Promise<void>) | undefined,
  workerPool: PipelineWorkerPool,
  logger?: AppLogger
): Promise<void> {
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const original = project.originals.find((item) => item.id === task.originalId);
  if (!original) {
    throw new Error(`Original not found for task: ${task.id}`);
  }

  const startedAt = performance.now();
  logger?.info("task processing started", { mod: "processing", taskId: task.id, originalId: original.id });

  task.status = "processing";
  task.error = null;
  task.updatedAt = nowIso();
  await onUpdate?.();

  let writtenOutputPath: string | null = null;
  try {
    const sourcePath = original.sourcePath;
    const outputPath = await stagedOutputPath(project, task, original, sourcePath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const result = await processOutputPipeline(task.pipeline, sourcePath, original, outputPath, settings, workerPool);

    if (result.kind !== "file") {
      throw new Error("Processing did not produce an output file.");
    }
    writtenOutputPath = result.outputPath;

    const savedAt = new Date();
    const finalFacts = await applyMetadataPolicy(result.outputPath, sourcePath, task, settings, savedAt);

    task.pipeline = result.appliedPipeline;
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
    // Publish `saved` only after every output artifact is complete. Until the sidecar write lands, the
    // task remains `processing`, which also keeps task/original removal from dropping ownership of work
    // that can still mutate the filesystem.
    task.status = "saved";
    task.updatedAt = nowIso();
    logger?.info("task processing done", { mod: "processing", taskId: task.id, ms: Math.round(performance.now() - startedAt) });
    await onUpdate?.();
  } catch (error) {
    if (writtenOutputPath) {
      try {
        await fs.rm(writtenOutputPath, { force: true });
        await fs.rm(`${writtenOutputPath}_original`, { force: true });
      } catch (cleanupError) {
        logger?.warn("failed to remove stranded output file after a processing failure", {
          mod: "processing",
          taskId: task.id,
          outputPath: writtenOutputPath,
          err: cleanupError
        });
      }
    }
    task.status = "error";
    task.error = taskError(error);
    task.updatedAt = nowIso();
    logger?.error("task processing failed", {
      mod: "processing",
      taskId: task.id,
      originalId: original.id,
      sourcePath: original.sourcePath,
      err: error
    });
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
  const policy = metadataPolicy(task);
  try {
    await applyMetadataToOutput({
      outputPath,
      sourcePath,
      stripActive: policy.stripActive,
      keep: policy.keep,
      injectFields: policy.injectFields,
      savedAt,
      writeSoftwareTag: settings.writeSoftwareTag,
      writeModifyDate: settings.writeModifyDate
    });
  } catch (error) {
    throw new PipelineError("metadata", `Failed to write metadata to the output file. ${errorMessage(error)}`);
  }
  const bytes = await fs.readFile(outputPath);
  return { outputHash: sha256Bytes(bytes) };
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
  // Retryability comes from the failure's category, not from scanning its message text.
  // Errors without a category (filesystem failures setting up the output path, internal
  // invariants) default to retryable — they are transient or harmless to re-attempt.
  const retryable = error instanceof PipelineError ? isRetryableCategory(error.category) : true;
  return {
    stage: "processing",
    message: processingFailureMessage(error),
    detail: known.stack ?? null,
    occurredAt: nowIso(),
    retryable
  };
}

function processingFailureMessage(error: unknown): string {
  if (!(error instanceof PipelineError)) {
    return "FotoReady could not save this task. The source and existing saved files are unchanged; try again.";
  }
  switch (error.category) {
    case "decode":
      return "FotoReady could not read the source image. Check that it is still available and supported.";
    case "process":
      return "FotoReady could not apply this task's adjustments. Review the enabled operations before saving again.";
    case "encode":
      return "FotoReady could not create the selected output format. Choose another format or adjust the task before saving again.";
    case "io":
      return "FotoReady could not write the output files. Check that the output folder is available, then retry.";
    case "metadata":
      return "The image was prepared, but its metadata could not be written. Check the output folder, then retry.";
    case "unknown":
      return "FotoReady could not save this task. The source and existing saved files are unchanged; try again.";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
