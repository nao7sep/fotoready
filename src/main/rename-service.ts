import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_FILENAME_TEMPLATE_ID } from "@shared/constants";
import { builtinFilenameTemplates } from "@shared/defaults";
import { nowIso } from "@shared/time";
import type { Project, Task } from "@shared/types/project";
import type { FilenameTemplate, GlobalSettings } from "@shared/types/settings";
import type { RenamePreview } from "@shared/types/ipc";
import { renderFilenameTemplate } from "@core/template-render";
import { resolveSlugCollisions } from "@core/slug/collision-resolve";
import { normalizeSlugCandidate } from "@core/slug/rules";
import { sidecarPathForOutput } from "@main/task-sidecar";
import { assertSafeRenderedFilename, validateFilenameTemplatePattern } from "@shared/validation/filename-template";

type RenamePlanItem = RenamePreview["items"][number];

export async function previewRename(project: Project, settings: GlobalSettings, templateId?: string, taskIds?: string[]): Promise<RenamePreview> {
  const template = findTemplate(project, settings, templateId);
  assertTemplateUsable(template);
  const scopedTaskIds = taskIds?.length ? new Set(taskIds) : null;
  const tasks = project.tasks
    .filter((task) => !scopedTaskIds || scopedTaskIds.has(task.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const savedTasks = tasks.filter((task): task is Task & { output: NonNullable<Task["output"]> } => task.output !== null);

  const needsSlug = template.pattern.includes("{slug}");
  const slugMap = resolveSlugCollisions(savedTasks.map((task) => ({
    taskId: task.id,
    candidates: slugCandidates(task),
    outputHash: task.output.outputHash
  })));

  const items: RenamePlanItem[] = [];
  for (const [index, task] of tasks.entries()) {
    const original = project.originals.find((candidate) => candidate.id === task.originalId);
    const label = original ? path.basename(original.sourcePath) : task.id;
    if (!task.output) {
      items.push({
        taskId: task.id,
        label,
        status: "not-saved",
        currentPath: null,
        proposedPath: null,
        currentName: null,
        proposedName: null,
        missingSlug: false,
        issue: "Not saved"
      });
      continue;
    }

    const currentPath = task.output.finalPath ?? task.output.stagedPath;
    const missingSlug = needsSlug && !task.customSlug && !task.output.vision;
    let proposedPath: string | null = null;
    let proposedName: string | null = null;
    let issue: string | null = missingSlug ? "Missing slug" : null;

    if (!issue) {
      try {
        const metadata = await sharp(currentPath).metadata();
        const ext = outputExtension(currentPath);
        const slug = slugMap.get(task.id) ?? "untitled-output";
        proposedName = renderFilenameTemplate(template.pattern, {
          slug,
          original: original ? path.parse(original.sourcePath).name : `original-${index + 1}`,
          w: metadata.width ?? 0,
          h: metadata.height ?? 0,
          ext
        });
        assertSafeRenderedFilename(proposedName);
        proposedPath = path.join(path.dirname(currentPath), proposedName);
      } catch (error) {
        issue = error instanceof Error ? error.message : String(error);
      }
    }

    items.push({
      taskId: task.id,
      label,
      status: issue ? "blocked" : proposedPath === currentPath ? "unchanged" : "ready",
      currentPath,
      proposedPath,
      currentName: path.basename(currentPath),
      proposedName,
      missingSlug,
      issue
    });
  }

  const proposedPathCounts = new Map<string, number>();
  for (const item of items) {
    if (!item.proposedPath || item.status === "blocked") continue;
    const key = normalizePathKey(item.proposedPath);
    proposedPathCounts.set(key, (proposedPathCounts.get(key) ?? 0) + 1);
  }

  for (const item of items) {
    if (!item.currentPath || !item.proposedPath || item.status === "blocked") continue;
    if ((proposedPathCounts.get(normalizePathKey(item.proposedPath)) ?? 0) > 1) {
      item.status = "blocked";
      item.issue = "Name conflict";
      continue;
    }
    if (item.currentPath !== item.proposedPath && await pathExists(item.proposedPath)) {
      item.status = "blocked";
      item.issue = "File exists";
      continue;
    }
    const currentParamsPath = sidecarPathForOutput(item.currentPath);
    const proposedParamsPath = sidecarPathForOutput(item.proposedPath);
    if (currentParamsPath !== proposedParamsPath && await pathExists(proposedParamsPath)) {
      item.status = "blocked";
      item.issue = "Sidecar exists";
    }
  }

  return {
    templateId: template.id,
    items,
    renameableCount: items.filter((item) => item.status === "ready").length,
    blockedCount: items.filter((item) => item.status === "blocked").length,
    missingSlugCount: items.filter((item) => item.missingSlug).length
  };
}

export async function runRename(project: Project, settings: GlobalSettings, templateId?: string, taskIds?: string[]): Promise<void> {
  const preview = await previewRename(project, settings, templateId, taskIds);
  if (preview.blockedCount > 0) {
    throw new Error(`${preview.blockedCount} task(s) cannot be renamed yet.`);
  }

  for (const item of preview.items) {
    if (item.status !== "ready" && item.status !== "unchanged") continue;
    const task = project.tasks.find((candidate) => candidate.id === item.taskId);
    if (!task?.output || !item.currentPath || !item.proposedPath) {
      continue;
    }
    if (item.currentPath === item.proposedPath) {
      continue;
    }

    await ensureNoCollision(item.proposedPath);
    const tempPath = `${item.proposedPath}.tmp-${process.pid}`;
    try {
      await fs.copyFile(item.currentPath, tempPath, fs.constants.COPYFILE_EXCL);
      await fs.rename(tempPath, item.proposedPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
    await fs.rm(item.currentPath, { force: true });
    const stagedParamsPath = task.output.finalParamsPath ?? task.output.stagedParamsPath;
    const proposedParamsPath = sidecarPathForOutput(item.proposedPath);
    task.output.stagedPath = item.proposedPath;
    task.output.finalPath = item.proposedPath;
    task.output.renamedAt = nowIso();
    task.updatedAt = nowIso();

    if (stagedParamsPath !== proposedParamsPath) {
      try {
        await ensureNoCollision(proposedParamsPath);
        await fs.rename(stagedParamsPath, proposedParamsPath);
        task.output.stagedParamsPath = proposedParamsPath;
        task.output.finalParamsPath = proposedParamsPath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          task.output.stagedParamsPath = proposedParamsPath;
          task.output.finalParamsPath = proposedParamsPath;
          continue;
        }
        task.output.stagedParamsPath = stagedParamsPath;
        task.output.finalParamsPath = stagedParamsPath;
        throw error;
      }
    }
    task.output.stagedParamsPath = proposedParamsPath;
    task.output.finalParamsPath = proposedParamsPath;
  }
}

function findTemplate(_project: Project, settings: GlobalSettings, templateId?: string): FilenameTemplate {
  const id = templateId ?? settings.defaultTemplateId ?? DEFAULT_FILENAME_TEMPLATE_ID;
  return settings.filenameTemplates.find((template) => template.id === id) ?? builtinFilenameTemplates[0];
}

function assertTemplateUsable(template: FilenameTemplate): void {
  const issues = validateFilenameTemplatePattern(template.pattern);
  if (issues.length > 0) {
    throw new Error(`Template "${template.name}" is invalid: ${issues[0]}`);
  }
}

function slugCandidates(task: Task & { output: NonNullable<Task["output"]> }): string[] {
  if (task.customSlug) return [normalizeSlugCandidate(task.customSlug)];
  if (task.output.vision?.slugCandidates.length) return task.output.vision.slugCandidates;
  return [];
}

function outputExtension(stagedPath: string): string {
  return path.extname(stagedPath).replace(/^\./, "") || "jpg";
}

function normalizePathKey(filePath: string): string {
  return path.resolve(filePath);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function ensureNoCollision(filePath: string): Promise<void> {
  try {
    await fs.lstat(filePath);
    throw new Error(`Output path already exists: ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}
