import PQueue from "p-queue";
import type { GlobalSettings } from "@shared/types/settings";
import type { Project } from "@shared/types/project";
import type { QueueSnapshot } from "@shared/types/ipc";
import type { QualityQueue } from "./quality";
import { processTask } from "./processing";
import { queueSnapshotFromProject } from "./snapshot";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { resolveOriginalSourcePath } from "@main/project/source-resolver";

export class ProcessingQueue {
  #queue: PQueue;
  #onUpdate: (() => void | Promise<void>) | null;

  constructor(
    private readonly settings: GlobalSettings,
    private readonly qualityQueue: QualityQueue | null,
    private readonly workerPool: PipelineWorkerPool | null,
    onUpdate: (() => void | Promise<void>) | null = null
  ) {
    this.#onUpdate = onUpdate;
    this.#queue = new PQueue({ concurrency: Math.max(1, settings.workerPoolSize) });
  }

  setUpdateListener(listener: () => void | Promise<void>): void {
    this.#onUpdate = listener;
  }

  async runTask(project: Project, taskId: string, projectPath: string | null): Promise<void> {
    await this.#queue.add(async () => {
      const sourceFacts = await this.sourceFactsForTask(project, taskId, projectPath);
      await processTask(project, taskId, projectPath, this.settings, sourceFacts, this.#onUpdate ?? undefined, this.workerPool);
    });
  }

  async runPending(project: Project, projectPath: string | null): Promise<void> {
    const pendingTaskIds = project.tasks
      .filter((task) => task.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((task) => task.id);

    await Promise.all(pendingTaskIds.map((taskId) => this.runTask(project, taskId, projectPath)));
  }

  pause(): void {
    this.#queue.pause();
  }

  resume(): void {
    this.#queue.start();
  }

  snapshot(project: Project): QueueSnapshot {
    const base = queueSnapshotFromProject(project);
    return {
      ...base,
      processing: this.#queue.pending + base.processing,
      paused: this.#queue.isPaused
    };
  }

  private async sourceFactsForTask(project: Project, taskId: string, projectPath: string | null) {
    const task = project.tasks.find((item) => item.id === taskId);
    const original = task ? project.originals.find((item) => item.id === task.originalId) : null;
    if (original) await resolveOriginalSourcePath(original, { projectPath, outputDir: project.outputDir });
    return original ? await this.qualityQueue?.factsForOriginal(original) ?? null : null;
  }
}
