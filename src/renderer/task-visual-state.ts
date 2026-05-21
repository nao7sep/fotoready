import type { RenamePreviewItem } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";

export type TaskVisualState = "before-save" | "generating" | "generated" | "error";

export function taskVisualState(task: Task | null | undefined): TaskVisualState {
  if (task?.error) return "error";
  if (task?.visionRunning) return "generating";
  if (!task?.output) return "before-save";
  if (task.output.vision) return "generated";
  return "before-save";
}

export function renameItemVisualState(task: Task | undefined, item: RenamePreviewItem): TaskVisualState {
  if (item.status === "blocked" || task?.error) return "error";
  if (item.status === "not-saved") return "before-save";
  if (task?.visionRunning) return "generating";
  return "generated";
}
