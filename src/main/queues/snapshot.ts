import type { QueueSnapshot } from "@shared/types/ipc";
import type { Project } from "@shared/types/project";

export function queueSnapshotFromProject(project: Project, activeTaskId: string | null = firstProcessingTaskId(project)): QueueSnapshot {
  return {
    saved: project.tasks.filter((task) => task.status === "saved").length,
    total: project.tasks.length,
    notSaved: project.tasks.filter((task) => task.status === "not-saved").length,
    queued: project.tasks.filter((task) => task.status === "queued").length,
    processing: project.tasks.filter((task) => task.status === "processing").length,
    errors: project.tasks.filter((task) => task.status === "error").length,
    activeTaskId,
    activeTaskLabel: activeTaskId ? taskLabel(project, activeTaskId) : null
  };
}

function firstProcessingTaskId(project: Project): string | null {
  return project.tasks.find((task) => task.status === "processing")?.id ?? null;
}

function taskLabel(project: Project, taskId: string): string | null {
  const task = project.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return null;
  const original = project.originals.find((candidate) => candidate.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}
