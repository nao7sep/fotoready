import type { Task } from "@shared/types/project";

/** A task whose asynchronous work can still mutate files or task state must remain owned. */
export function isTaskBusyForRemoval(task: Task): boolean {
  return task.status === "queued" || task.status === "processing" || task.visionRunning;
}
