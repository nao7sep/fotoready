import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { nowIso } from "@shared/time";
import type { Project, Task, TaskError } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import { runPipeline } from "@runtime/pipeline-runner";
import { injectMetadata, stripMetadata } from "@adapters/metadata/exiftool";

export async function processTask(project: Project, taskId: string, projectPath: string | null, settings: GlobalSettings): Promise<void> {
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

    const result = await runPipeline(task.pipeline, {
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
