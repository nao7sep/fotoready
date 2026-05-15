import fs from "node:fs/promises";
import path from "node:path";
import { TASK_SIDECAR_SUFFIX } from "@shared/constants";
import { createTaskSidecar, isTaskSidecar, type TaskSidecar } from "@shared/task-sidecar";
import type { Original, Task } from "@shared/types/project";
import type { Pipeline } from "@shared/types/pipeline";
import { validateOpInstance } from "@shared/validation/ops";
import { validateOutputSettings } from "@shared/validation/pipeline";
import { getOpModule } from "@core/ops/catalog";

export type LoadedTaskSidecar = {
  path: string;
  sidecar: TaskSidecar;
};

export async function writeTaskSidecarFile(outputPath: string, original: Original, task: Task, pipeline: Pipeline): Promise<string> {
  const sidecarPath = sidecarPathForOutput(outputPath);
  const payload = createTaskSidecar({
    original: {
      fileName: path.basename(original.sourcePath),
      size: original.size,
      format: original.format,
      width: original.width,
      height: original.height
    },
    generateDescription: task.generateDescription,
    generateSlug: task.generateSlug,
    customSlug: task.customSlug,
    pipeline,
    vision: task.output?.vision ?? null
  });
  await fs.writeFile(sidecarPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return sidecarPath;
}

export async function loadTaskSidecars(filePaths: string[]): Promise<LoadedTaskSidecar[]> {
  const loaded: LoadedTaskSidecar[] = [];
  for (const filePath of filePaths) {
    if (!isTaskSidecarPath(filePath)) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (!isTaskSidecar(parsed)) continue;
      loaded.push({ path: filePath, sidecar: normalizeTaskSidecar(parsed) });
    } catch {
      // Ignore invalid sidecars during mixed drag-and-drop import.
    }
  }
  return loaded;
}

export function sidecarPathForOutput(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}${TASK_SIDECAR_SUFFIX}`);
}

export function isTaskSidecarPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(TASK_SIDECAR_SUFFIX);
}

export function matchingTaskSidecar(original: Original, sidecars: LoadedTaskSidecar[]): LoadedTaskSidecar | null {
  const fileName = path.basename(original.sourcePath).toLowerCase();
  return sidecars.find(({ sidecar }) =>
    sidecar.original.fileName.toLowerCase() === fileName
    && sidecar.original.size === original.size
    && sidecar.original.format.toLowerCase() === original.format.toLowerCase()
    && sidecar.original.width === original.width
    && sidecar.original.height === original.height
  ) ?? null;
}

function normalizeTaskSidecar(sidecar: TaskSidecar): TaskSidecar {
  const pipeline: Pipeline = {
    ops: sidecar.task.pipeline.ops.map((op, index) => validateOpInstance(op, getOpModule, `task.pipeline.ops[${index}]`)),
    output: validateOutputSettings(sidecar.task.pipeline.output, "task.pipeline.output")
  };
  return {
    version: 1,
    original: {
      fileName: String(sidecar.original.fileName),
      size: Number(sidecar.original.size),
      format: String(sidecar.original.format),
      width: Number(sidecar.original.width),
      height: Number(sidecar.original.height)
    },
    task: {
      generateDescription: typeof (sidecar.task as { generateDescription?: unknown }).generateDescription === "boolean"
        ? Boolean((sidecar.task as { generateDescription?: unknown }).generateDescription)
        : Boolean((sidecar.task as { analyzeContent?: unknown }).analyzeContent),
      generateSlug: typeof (sidecar.task as { generateSlug?: unknown }).generateSlug === "boolean"
        ? Boolean((sidecar.task as { generateSlug?: unknown }).generateSlug)
        : Boolean((sidecar.task as { analyzeContent?: unknown }).analyzeContent),
      customSlug: typeof sidecar.task.customSlug === "string" ? sidecar.task.customSlug : null,
      pipeline,
      vision: sidecar.task.vision ? structuredClone(sidecar.task.vision) : null
    }
  };
}
