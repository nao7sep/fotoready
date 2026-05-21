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
  const doneTasks = project.tasks
    .filter((task): task is Task & { output: NonNullable<Task["output"]> } => task.status === "done" && task.output !== null)
    .filter((task) => !scopedTaskIds || scopedTaskIds.has(task.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const needsSlug = template.pattern.includes("{slug}");
  const slugMap = resolveSlugCollisions(doneTasks.map((task) => ({
    taskId: task.id,
    candidates: slugCandidates(task),
    outputHash: task.output.outputHash
  })));

  const items: RenamePlanItem[] = [];
  for (const [index, task] of doneTasks.entries()) {
    const stagedPath = task.output.finalPath ?? task.output.stagedPath;
    const metadata = await sharp(stagedPath).metadata();
    const ext = outputExtension(stagedPath);
    const slug = slugMap.get(task.id) ?? "untitled-output";
    const original = project.originals.find((candidate) => candidate.id === task.originalId);
    const proposedName = renderFilenameTemplate(template.pattern, {
      slug,
      original: original ? path.parse(original.sourcePath).name : `original-${index + 1}`,
      w: metadata.width ?? 0,
      h: metadata.height ?? 0,
      ext
    });
    assertSafeRenderedFilename(proposedName);
    const proposedPath = path.join(path.dirname(stagedPath), proposedName);
    const missingSlug = needsSlug && !task.customSlug && !task.output.vision;

    items.push({
      taskId: task.id,
      stagedPath,
      proposedPath,
      stagedName: path.basename(stagedPath),
      proposedName,
      missingSlug
    });
  }

  return {
    templateId: template.id,
    items,
    missingSlugCount: items.filter((item) => item.missingSlug).length
  };
}

export async function runRename(project: Project, settings: GlobalSettings, templateId?: string, taskIds?: string[]): Promise<void> {
  const preview = await previewRename(project, settings, templateId, taskIds);
  if (preview.missingSlugCount > 0) {
    throw new Error(`${preview.missingSlugCount} task(s) need a rename slug or vision result before rename.`);
  }

  for (const item of preview.items) {
    const task = project.tasks.find((candidate) => candidate.id === item.taskId);
    if (!task?.output) {
      continue;
    }
    if (item.stagedPath === item.proposedPath) {
      task.output.stagedPath = item.proposedPath;
      task.output.finalPath = item.proposedPath;
      task.output.stagedParamsPath = task.output.finalParamsPath ?? task.output.stagedParamsPath;
      task.output.finalParamsPath = task.output.stagedParamsPath;
      task.output.renamedAt = nowIso();
      task.updatedAt = nowIso();
      continue;
    }

    await ensureNoCollision(item.proposedPath);
    const tempPath = `${item.proposedPath}.tmp-${process.pid}`;
    try {
      await fs.copyFile(item.stagedPath, tempPath, fs.constants.COPYFILE_EXCL);
      await fs.rename(tempPath, item.proposedPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
    await fs.rm(item.stagedPath, { force: true });
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
