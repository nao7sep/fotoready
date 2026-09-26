import type { MessageKey } from "@shared/i18n/catalogues";
import type { QueueSnapshot, RenameIssue, RenamePreviewItem } from "@shared/types/ipc";
import type { Task, VisionRunMode } from "@shared/types/project";

export type TaskVisualState = "not-saved" | "saved" | "description-generated" | "slug-generated" | "error";

export function taskVisualState(task: Task | null | undefined): TaskVisualState {
  if (task?.error) return "error";
  if (!task?.output) return "not-saved";
  if (task.customSlug?.trim()) return "slug-generated";
  if (task.output.vision?.description.trim()) return "description-generated";
  return "saved";
}

export function taskVisualStateWithoutSlug(task: Task | null | undefined): TaskVisualState {
  if (task?.error) return "error";
  if (!task?.output) return "not-saved";
  if (task.output.vision?.description.trim()) return "description-generated";
  return "saved";
}

// Labels are catalogue keys; the component renders them in the current language.
export function taskStateLabelForVisualState(state: TaskVisualState): MessageKey {
  switch (state) {
    case "not-saved":
      return "taskState.notSaved";
    case "saved":
      return "taskState.saved";
    case "description-generated":
      return "taskState.descriptionGenerated";
    case "slug-generated":
      return "taskState.slugGenerated";
    case "error":
      return "taskState.needsAttention";
  }
}

export function taskStateLabel(task: Task, queue: QueueSnapshot): MessageKey {
  if (task.visionRunning) return visionGeneratingLabel(task.visionRunMode);
  if (queue.activeTaskId === task.id || task.status === "processing") return "taskState.saving";
  if (task.status === "queued") return "taskState.waitingToSave";
  return taskStateLabelForVisualState(taskVisualState(task));
}

function visionGeneratingLabel(mode: VisionRunMode | null): MessageKey {
  if (mode === "slug") return "taskState.generatingSlug";
  if (mode === "description-and-slug") return "taskState.generatingDescriptionAndSlug";
  return "taskState.generatingDescription";
}

const RENAME_ISSUE_LABELS: Record<RenameIssue, MessageKey> = {
  "not-saved": "renameIssue.notSaved",
  "missing-slug": "renameIssue.missingSlug",
  "inspect-failed": "renameIssue.inspectFailed",
  "overlaps-original-and-slug": "renameIssue.overlapsOriginalAndSlug",
  "overlaps-original": "renameIssue.overlapsOriginal",
  "overlaps-slug": "renameIssue.overlapsSlug",
  "overlaps-renamed": "renameIssue.overlapsRenamed",
  "name-exists": "renameIssue.nameExists",
  "sidecar-exists": "renameIssue.sidecarExists"
};

export function renameIssueLabel(issue: RenameIssue): MessageKey {
  return RENAME_ISSUE_LABELS[issue];
}

export function renameItemVisualState(task: Task | undefined, item: RenamePreviewItem): TaskVisualState {
  if (item.status === "blocked" && item.issue !== "missing-slug") return "error";
  if (item.status === "not-saved") return "not-saved";
  return taskVisualState(task);
}

export function renameItemStateLabel(state: TaskVisualState, item: RenamePreviewItem): MessageKey {
  if (state === "error") return item.issue ? renameIssueLabel(item.issue) : "taskState.needsAttention";
  if (item.status === "not-saved") return "taskState.notSaved";
  if (item.status === "unchanged") return "taskState.alreadyNamed";
  if (item.status === "ready") return "taskState.readyToRename";
  if (item.issue === "missing-slug") return missingSlugLabel(state);
  return taskStateLabelForVisualState(state);
}

export function missingSlugVisualState(task: Task | null | undefined): TaskVisualState {
  const state = taskVisualStateWithoutSlug(task);
  return state === "not-saved" ? "saved" : state;
}

export function missingSlugLabel(state: TaskVisualState): MessageKey {
  return state === "description-generated" ? "taskState.descriptionMissingSlug" : "taskState.savedMissingSlug";
}
