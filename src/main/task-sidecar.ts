import fs from "node:fs/promises";
import path from "node:path";
import { TASK_SIDECAR_SUFFIX } from "@shared/constants";
import { createTaskSidecar, isTaskSidecar, type TaskSidecar } from "@shared/task-sidecar";
import { FORMAT_VERSIONS, parseVersionedJson, versionedJson } from "@shared/format-versions";
import type { Original, Task } from "@shared/types/project";
import type { Pipeline } from "@shared/types/pipeline";
import { validateOpInstance } from "@shared/validation/ops";
import { validateOutputSettings } from "@shared/validation/pipeline";
import { assertBoolean, assertNonEmptyString, assertString } from "@shared/validation/common";
import { getOpModule } from "@core/ops/catalog";
import { atomicWriteFile } from "@adapters/atomic-file";
import type { OriginalImportIssue } from "@shared/types/ipc";
import type { Logger } from "@shared/types/log";
import { message } from "@shared/i18n/translate";
import { relinkMissingBuiltinStamps } from "./builtin-stamp-catalog";

export type LoadedTaskSidecar = {
  path: string;
  sidecar: TaskSidecar;
};

export type TaskSidecarLoadResult = {
  loaded: LoadedTaskSidecar[];
  rejected: OriginalImportIssue[];
};

export async function writeTaskSidecarFile(outputPath: string, original: Original, task: Task, pipeline: Pipeline): Promise<string> {
  const sidecarPath = sidecarPathForOutput(outputPath);
  const payload = createTaskSidecar({
    original: {
      fileName: path.basename(original.sourcePath),
      sourceHash: original.sourceHash,
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
  // not recorded: this JSON sidecar is written next to a saved OUTPUT image, in the user-chosen output
  // directory — a binary-bearing directory, and output the app writes for the user then forgets (it keeps
  // a path to reopen the task, but the output file itself is not managed internal state). It rides into
  // exclusion with the images it describes (data-backup conventions: "Anything colocated in a
  // binary-bearing directory"), so no `afterWrite` hook is supplied.
  await atomicWriteFile(sidecarPath, versionedJson(FORMAT_VERSIONS.taskSidecar, payload));
  return sidecarPath;
}

export async function loadTaskSidecars(
  filePaths: string[],
  bundledStampsDir: string,
  logger?: Logger
): Promise<TaskSidecarLoadResult> {
  const loaded: LoadedTaskSidecar[] = [];
  const rejected: TaskSidecarLoadResult["rejected"] = [];
  for (const filePath of filePaths) {
    if (!isTaskSidecarPath(filePath)) continue;
    let source: string;
    try {
      source = await fs.readFile(filePath, "utf8");
    } catch (error) {
      logger?.error("task sidecar read failed", { mod: "main.task-sidecar", filePath, err: error });
      rejected.push({
        filePath,
        kind: "failed",
        severity: "error",
        reason: message("importReason.sidecarUnreadable")
      });
      continue;
    }

    const read = parseVersionedJson(source, FORMAT_VERSIONS.taskSidecar);
    if (read.kind === "newer") {
      // Left exactly as it is, so the newer FotoReady that wrote it can still read it.
      logger?.warn("task sidecar was written by a newer FotoReady", { mod: "main.task-sidecar", filePath, formatVersion: read.found });
      rejected.push({
        filePath,
        kind: "unsupported",
        severity: "warning",
        reason: message("importReason.sidecarNewer")
      });
      continue;
    }
    if (read.kind === "invalid" || !isTaskSidecar(read.body)) {
      logger?.warn("task sidecar was not valid JSON of a sidecar's shape", {
        mod: "main.task-sidecar",
        filePath,
        ...(read.kind === "invalid" ? { err: read.error } : {})
      });
      rejected.push({
        filePath,
        kind: "invalid",
        severity: "warning",
        reason: message("importReason.sidecarInvalid")
      });
      continue;
    }
    let sidecar: TaskSidecar;
    try {
      sidecar = normalizeTaskSidecar(read.body);
    } catch (error) {
      logger?.warn("task sidecar values were invalid", { mod: "main.task-sidecar", filePath, err: error });
      rejected.push({
        filePath,
        kind: "invalid",
        severity: "warning",
        reason: message("importReason.sidecarInvalid")
      });
      continue;
    }
    try {
      sidecar.task.pipeline = await relinkMissingBuiltinStamps(sidecar.task.pipeline, bundledStampsDir);
    } catch (error) {
      // The task still opens; a stamp whose file is gone then fails where it is drawn, as any missing asset does.
      logger?.error("built-in stamps could not be read to relink a saved task", { mod: "main.task-sidecar", filePath, err: error });
    }
    loaded.push({ path: filePath, sidecar });
  }
  return { loaded, rejected };
}

export function sidecarPathForOutput(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}${TASK_SIDECAR_SUFFIX}`);
}

export function isTaskSidecarPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(TASK_SIDECAR_SUFFIX);
}

export function matchingTaskSidecar(original: Original, sidecars: LoadedTaskSidecar[]): LoadedTaskSidecar | null {
  return sidecars.find(({ sidecar }) => sidecar.original.sourceHash === original.sourceHash) ?? null;
}

function normalizeTaskSidecar(sidecar: TaskSidecar): TaskSidecar {
  const pipeline: Pipeline = {
    ops: sidecar.task.pipeline.ops.map((op, index) => validateOpInstance(op, getOpModule, `task.pipeline.ops[${index}]`)),
    output: validateOutputSettings(sidecar.task.pipeline.output, "task.pipeline.output")
  };
  return {
    original: {
      fileName: String(sidecar.original.fileName),
      sourceHash: assertNonEmptyString(sidecar.original.sourceHash, "original.sourceHash"),
      size: Number(sidecar.original.size),
      format: String(sidecar.original.format),
      width: Number(sidecar.original.width),
      height: Number(sidecar.original.height)
    },
    task: {
      generateDescription: assertBoolean(sidecar.task.generateDescription, "task.generateDescription"),
      generateSlug: assertBoolean(sidecar.task.generateSlug, "task.generateSlug"),
      customSlug: sidecar.task.customSlug === null ? null : assertString(sidecar.task.customSlug, "task.customSlug"),
      pipeline,
      vision: sidecar.task.vision ? structuredClone(sidecar.task.vision) : null
    }
  };
}
