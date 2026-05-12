import PQueue from "p-queue";
import type { GlobalSettings } from "@shared/types/settings";
import type { Project } from "@shared/types/project";
import type { QueueSnapshot } from "@shared/types/ipc";
import type { QualityQueue } from "./quality";
import { processTask } from "./processing";
import { queueSnapshotFromProject } from "./snapshot";

export class ProcessingQueue {
  #queue: PQueue;

  constructor(
    private readonly settings: GlobalSettings,
    private readonly qualityQueue: QualityQueue | null
  ) {
    this.#queue = new PQueue({ concurrency: Math.max(1, settings.workerPoolSize) });
  }

  async runTask(project: Project, taskId: string, projectPath: string | null): Promise<void> {
    await this.#queue.add(async () => {
      const sourceFacts = await this.sourceFactsForTask(project, taskId);
      await processTask(project, taskId, projectPath, this.settings, sourceFacts);
    });
  }

  async runPending(project: Project, projectPath: string | null): Promise<void> {
    const pendingTaskIds = project.tasks
      .filter((task) => task.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((task) => task.id);

    await Promise.all(pendingTaskIds.map((taskId) => this.runTask(project, taskId, projectPath)));
  }

  snapshot(project: Project): QueueSnapshot {
    const base = queueSnapshotFromProject(project);
    return {
      ...base,
      processing: this.#queue.pending + base.processing
    };
  }

  private async sourceFactsForTask(project: Project, taskId: string) {
    const task = project.tasks.find((item) => item.id === taskId);
    const original = task ? project.originals.find((item) => item.id === task.originalId) : null;
    return original ? await this.qualityQueue?.factsForOriginal(original) ?? null : null;
  }
}
