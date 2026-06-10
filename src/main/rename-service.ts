import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { nowIso } from "@shared/time";
import type { Project, Task } from "@shared/types/project";
import { assertSafeRenderedFilename } from "@shared/validation/filename-template";
import type { RenamePreview } from "@shared/types/ipc";
import { normalizeSlugCandidate } from "@core/slug/rules";
import { sidecarPathForOutput } from "@main/task-sidecar";
import { findRenameTemplate, renderRenameTemplate, renameTemplateUsesOriginal, renameTemplateUsesSlug, type RenameTemplateId } from "@shared/rename-template";
import { resolveProjectOutputDir } from "@main/output-paths";
import type { AppLogger } from "@main/logger";

type RenamePlanItem = RenamePreview["items"][number];

export async function previewRename(project: Project, templateId?: RenameTemplateId, taskIds?: string[]): Promise<RenamePreview> {
  const template = findRenameTemplate(templateId);
  const scopedTaskIds = taskIds?.length ? new Set(taskIds) : null;
  const tasks = project.tasks
    .filter((task) => !scopedTaskIds || scopedTaskIds.has(task.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const usesSlug = renameTemplateUsesSlug(template);
  const usesOriginal = renameTemplateUsesOriginal(template);
  const needsSlug = usesSlug;
  const originalConflictKeys = new Map<string, string | null>();
  const slugConflictKeys = new Map<string, string | null>();

  const items: RenamePlanItem[] = [];
  for (const [index, task] of tasks.entries()) {
    const original = project.originals.find((candidate) => candidate.id === task.originalId);
    const originalName = original ? path.basename(original.sourcePath) : task.id;
    const originalConflictKey = normalizeOriginalConflictKey(original?.sourcePath ?? originalName);
    if (!task.output) {
      originalConflictKeys.set(task.id, null);
      slugConflictKeys.set(task.id, null);
      items.push({
        taskId: task.id,
        originalName,
        status: "not-saved",
        currentPath: null,
        proposedPath: null,
        currentName: null,
        proposedName: null,
        missingSlug: false,
        customSlug: task.customSlug,
        generatedSlug: null,
        effectiveSlug: null,
        issue: "Not saved"
      });
      continue;
    }

    const savedTask = task as Task & { output: NonNullable<Task["output"]> };
    const currentPath = savedTask.output.finalPath ?? savedTask.output.stagedPath;
    const destinationDir = original ? resolveProjectOutputDir(project.outputDir, original.sourcePath) : path.dirname(currentPath);
    const generatedSlug = savedTask.output.vision?.slugCandidates[0] ?? null;
    const effectiveSlug = resolvedRenameSlug(savedTask);
    const missingSlug = needsSlug && !effectiveSlug;
    let proposedPath: string | null = null;
    let proposedName: string | null = null;
    let issue: string | null = missingSlug ? "Missing slug" : null;

    if (!issue) {
      try {
        if (!(await pathExists(currentPath))) {
          throw new Error("Saved output file is missing");
        }
        const metadata = await sharp(currentPath).metadata();
        const ext = outputExtension(currentPath);
        proposedName = renderRenameTemplate(template, {
          slug: effectiveSlug ?? "untitled-output",
          original: original ? path.parse(original.sourcePath).name : `original-${index + 1}`,
          w: metadata.width ?? 0,
          h: metadata.height ?? 0,
          ext
        });
        assertSafeRenderedFilename(proposedName);
        proposedPath = path.join(destinationDir, proposedName);
      } catch (error) {
        issue = error instanceof Error ? error.message : String(error);
      }
    }

    originalConflictKeys.set(task.id, buildSemanticConflictKey(destinationDir, originalConflictKey));
    slugConflictKeys.set(task.id, buildSemanticConflictKey(destinationDir, effectiveSlug));
    items.push({
      taskId: task.id,
      originalName,
      status: issue ? "blocked" : proposedPath === currentPath ? "unchanged" : "ready",
      currentPath,
      proposedPath,
      currentName: path.basename(currentPath),
      proposedName,
      missingSlug,
      customSlug: task.customSlug,
      generatedSlug,
      effectiveSlug,
      issue
    });
  }

  const originalConflictCounts = countSemanticConflicts(items, originalConflictKeys, usesOriginal);
  const slugConflictCounts = countSemanticConflicts(items, slugConflictKeys, usesSlug);
  const proposedPathCounts = new Map<string, number>();
  for (const item of items) {
    if (!item.proposedPath || item.status === "blocked") continue;
    const key = normalizePathKey(item.proposedPath);
    proposedPathCounts.set(key, (proposedPathCounts.get(key) ?? 0) + 1);
  }

  for (const item of items) {
    if (!item.currentPath || !item.proposedPath || item.status === "blocked") continue;
    const hasOriginalConflict = usesOriginal && (originalConflictCounts.get(item.taskId) ?? 0) > 1;
    const hasSlugConflict = usesSlug && (slugConflictCounts.get(item.taskId) ?? 0) > 1;
    if (hasOriginalConflict || hasSlugConflict) {
      item.status = "blocked";
      item.issue = hasOriginalConflict && hasSlugConflict
        ? "Overlaps another original- and slug-based name"
        : hasOriginalConflict
          ? "Overlaps another original-based name"
          : "Overlaps another slug-based name";
      continue;
    }
    if ((proposedPathCounts.get(normalizePathKey(item.proposedPath)) ?? 0) > 1) {
      item.status = "blocked";
      item.issue = "Overlaps another renamed file";
      continue;
    }
    if (item.currentPath !== item.proposedPath && await pathExists(item.proposedPath)) {
      item.status = "blocked";
      item.issue = "A file with this name already exists";
      continue;
    }
    const currentParamsPath = sidecarPathForOutput(item.currentPath);
    const proposedParamsPath = sidecarPathForOutput(item.proposedPath);
    if (currentParamsPath !== proposedParamsPath && await pathExists(proposedParamsPath)) {
      item.status = "blocked";
      item.issue = "A JSON sidecar with this name already exists";
    }
  }

  return {
    templateId: template.id,
    usesOriginal,
    usesSlug,
    items,
    renameableCount: items.filter((item) => item.status === "ready").length,
    blockedCount: items.filter((item) => item.status === "blocked").length,
    missingSlugCount: items.filter((item) => item.missingSlug).length
  };
}

export async function runRename(project: Project, templateId?: RenameTemplateId, taskIds?: string[], logger?: AppLogger): Promise<void> {
  const preview = await previewRename(project, templateId, taskIds);
  if (preview.blockedCount > 0) {
    throw new Error(blockedRenameMessage(preview));
  }

  for (const item of preview.items) {
    if (item.status !== "ready" && item.status !== "unchanged") continue;
    const task = project.tasks.find((candidate) => candidate.id === item.taskId);
    if (!task?.output || !item.currentPath || !item.proposedPath) continue;
    if (item.currentPath === item.proposedPath) continue;

    await fs.mkdir(path.dirname(item.proposedPath), { recursive: true });
    await ensureNoCollision(item.proposedPath);

    const stagedParamsPath = task.output.finalParamsPath ?? task.output.stagedParamsPath;
    const proposedParamsPath = sidecarPathForOutput(item.proposedPath);
    const sidecarMoveNeeded = Boolean(stagedParamsPath) && stagedParamsPath !== proposedParamsPath;
    if (sidecarMoveNeeded) {
      await ensureNoCollision(proposedParamsPath);
    }

    await moveFile(item.currentPath, item.proposedPath);

    if (sidecarMoveNeeded) {
      try {
        await moveFile(stagedParamsPath, proposedParamsPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          try {
            await moveFile(item.proposedPath, item.currentPath);
          } catch (rollbackError) {
            // Image is already at proposedPath; rolling it back failed too. The
            // original error is thrown below, but the rollback failure is its own
            // incident worth recording — the file is left under the proposed name.
            logger?.warn("rename rollback failed; output left at the proposed path", {
              mod: "rename",
              from: item.proposedPath,
              to: item.currentPath,
              err: rollbackError
            });
          }
          throw error;
        }
      }
    }

    task.output.stagedPath = item.proposedPath;
    task.output.finalPath = item.proposedPath;
    task.output.stagedParamsPath = proposedParamsPath;
    task.output.finalParamsPath = proposedParamsPath;
    task.output.renamedAt = nowIso();
    task.updatedAt = nowIso();
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
  }
  const tempPath = `${to}.tmp.${process.pid}.${nanoid(8)}`;
  try {
    await fs.copyFile(from, tempPath, fs.constants.COPYFILE_EXCL);
    await fs.rename(tempPath, to);
  } catch (innerError) {
    await fs.rm(tempPath, { force: true });
    throw innerError;
  }
  await fs.rm(from, { force: true });
}

function blockedRenameMessage(preview: RenamePreview): string {
  const blocked = preview.items.filter((item) => item.status === "blocked");
  const details = blocked.map((item) => {
    const label = item.currentName ?? item.originalName;
    return `- ${label}: ${item.issue ?? "Needs attention"}`;
  });
  return [
    `${blocked.length} task${blocked.length === 1 ? "" : "s"} cannot be renamed yet.`,
    ...details
  ].join("\n");
}

function resolvedRenameSlug(task: Task & { output: NonNullable<Task["output"]> }): string | null {
  if (!task.customSlug) return null;
  const normalized = normalizeSlugCandidate(task.customSlug);
  return normalized || null;
}

function outputExtension(stagedPath: string): string {
  return path.extname(stagedPath).replace(/^\./, "") || "jpg";
}

function normalizePathKey(filePath: string): string {
  return path.resolve(filePath);
}

function normalizeOriginalConflictKey(sourcePath: string): string {
  return path.parse(sourcePath).name.trim().toLocaleLowerCase();
}

function buildSemanticConflictKey(destinationDir: string, key: string | null): string | null {
  if (!key) return null;
  return `${normalizePathKey(destinationDir)}::${key}`;
}

function countSemanticConflicts(
  items: RenamePlanItem[],
  keysByTaskId: Map<string, string | null>,
  enabled: boolean
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!enabled) return counts;
  for (const item of items) {
    if (!item.currentPath) continue;
    const key = keysByTaskId.get(item.taskId);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const countsByTaskId = new Map<string, number>();
  for (const item of items) {
    const key = keysByTaskId.get(item.taskId);
    countsByTaskId.set(item.taskId, key ? (counts.get(key) ?? 0) : 0);
  }
  return countsByTaskId;
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
