import type { QueueSnapshot } from "@shared/types/ipc";
import type { Project } from "@shared/types/project";

export function emptyQueueSnapshot(): QueueSnapshot {
  return {
    done: 0,
    total: 0,
    processing: 0,
    errors: 0
  };
}

export function queueSnapshotFromProject(project: Project): QueueSnapshot {
  return {
    done: project.tasks.filter((task) => task.status === "done").length,
    total: project.tasks.length,
    processing: project.tasks.filter((task) => task.status === "processing").length,
    errors: project.tasks.filter((task) => task.status === "error").length
  };
}
