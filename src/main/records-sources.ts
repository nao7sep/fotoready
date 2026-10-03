import type { RecordSources, RecordsReadResults } from "@shared/records";
import type { Project } from "@shared/types/project";

/**
 * The Records window's filter values: the launches and tasks the database holds, with this launch
 * marked and each task still in the workspace named by its original's file name. Tasks of earlier
 * launches keep only their id, since nothing names them any more.
 */
export function recordSources(
  stored: RecordsReadResults["sources"],
  currentSession: string,
  project: Pick<Project, "tasks" | "originals">
): RecordSources {
  const names = new Map<string, string>();
  for (const task of project.tasks) {
    const original = project.originals.find((item) => item.id === task.originalId);
    if (original) names.set(task.id, original.sourcePath.split(/[\\/]/).at(-1) ?? original.sourcePath);
  }
  return {
    currentSession,
    sessions: stored.sessions,
    tasks: stored.taskIds.map((taskId) => ({ taskId, name: names.get(taskId) ?? null }))
  };
}
