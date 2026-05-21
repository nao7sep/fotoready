import type { QueueSnapshot, RenamePreviewItem } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";

export type TaskVisualState = "not-saved" | "saving" | "generating" | "ready" | "error";

export function taskVisualState(task: Task | null | undefined): TaskVisualState {
  if (task?.error) return "error";
  if (task?.visionRunning) return "generating";
  if (task?.status === "queued" || task?.status === "processing") return "saving";
  if (task?.output) return "ready";
  return "not-saved";
}

export function renameItemVisualState(task: Task | undefined, item: RenamePreviewItem): TaskVisualState {
  if (item.status === "blocked" || task?.error) return "error";
  if (item.status === "not-saved") return "not-saved";
  if (task?.visionRunning) return "generating";
  return "ready";
}

export function taskStateLabel(task: Task, queue: QueueSnapshot): string {
  if (task.error) return "Needs attention";
  if (task.visionRunning) return "Generating";
  if (queue.activeTaskId === task.id || task.status === "processing") return "Saving";
  if (task.status === "queued") return "Waiting to save";
  if (task.output) return "Ready";
  return "Not saved";
}
