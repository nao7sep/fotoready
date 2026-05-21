import type { QueueSnapshot, RenamePreviewItem } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";

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

export function taskStateLabelForVisualState(state: TaskVisualState): string {
  switch (state) {
    case "not-saved":
      return "Not saved";
    case "saved":
      return "Saved";
    case "description-generated":
      return "Description generated";
    case "slug-generated":
      return "Slug generated";
    case "error":
      return "Needs attention";
  }
}

export function taskStateLabel(task: Task, queue: QueueSnapshot): string {
  if (queue.activeTaskId === task.id || task.status === "processing") return "Saving";
  if (task.status === "queued") return "Waiting to save";
  return taskStateLabelForVisualState(taskVisualState(task));
}

export function renameItemVisualState(task: Task | undefined, item: RenamePreviewItem): TaskVisualState {
  if (item.status === "blocked" && item.issue !== "Missing slug") return "error";
  if (item.status === "not-saved") return "not-saved";
  return taskVisualState(task);
}

export function renameItemStateLabel(state: TaskVisualState, item: RenamePreviewItem): string {
  if (state === "error") return item.issue ?? "Needs attention";
  if (item.status === "not-saved") return "Not saved";
  if (item.status === "unchanged") return "Renamed";
  if (item.status === "ready") return "Ready to rename";
  if (item.issue === "Missing slug") return missingSlugLabel(state);
  return taskStateLabelForVisualState(state);
}

export function missingSlugVisualState(task: Task | null | undefined): TaskVisualState {
  const state = taskVisualStateWithoutSlug(task);
  return state === "not-saved" ? "saved" : state;
}

export function missingSlugLabel(state: TaskVisualState): string {
  return state === "description-generated" ? "Description generated, missing slug" : "Saved, missing slug";
}
