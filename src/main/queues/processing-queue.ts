import PQueue from "p-queue";
import type { GlobalSettings } from "@shared/types/settings";
import type { Project } from "@shared/types/project";
import type { QueueSnapshot } from "@shared/types/ipc";
import type { QualityQueue } from "./quality";
import { processTask } from "./processing";
import { queueSnapshotFromProject } from "./snapshot";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";

export class ProcessingQueue {
  #queue: PQueue;
  #onUpdate: (() => void | Promise<void>) | null;
  #activeTaskIds: Set<string> = new Set();
  #queuedTaskIds: Set<string> = new Set();
  #cancelledTaskIds: Set<string> = new Set();

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

  async enqueueTask(project: Project, taskId: string): Promise<void> {
    if (this.#queuedTaskIds.has(taskId) || this.#activeTaskIds.has(taskId)) {
      return;
    }
    this.#queuedTaskIds.add(taskId);

    await this.#queue.add(async () => {
      this.#queuedTaskIds.delete(taskId);
      if (this.#cancelledTaskIds.delete(taskId)) {
        await this.#onUpdate?.();
        return;
      }
      this.#activeTaskIds.add(taskId);
      await this.#onUpdate?.();
      try {
        const sourceFacts = await this.sourceFactsForTask(project, taskId);
        await processTask(project, taskId, this.settings, sourceFacts, this.#onUpdate ?? undefined, this.workerPool);
      } finally {
        this.#activeTaskIds.delete(taskId);
        await this.#onUpdate?.();
      }
    });
  }

  cancelTask(taskId: string): boolean {
    if (this.#queuedTaskIds.has(taskId)) {
      this.#cancelledTaskIds.add(taskId);
      return true;
    }
    return false;
  }

  cancelAll(): string[] {
    const cancelled = Array.from(this.#queuedTaskIds);
    for (const taskId of cancelled) {
      this.#cancelledTaskIds.add(taskId);
    }
    return cancelled;
  }

  snapshot(project: Project): QueueSnapshot {
    const active = Array.from(this.#activeTaskIds);
    const base = queueSnapshotFromProject(project, active[0] ?? null);
    return {
      ...base,
      processing: Math.max(base.processing, active.length)
    };
  }

  private async sourceFactsForTask(project: Project, taskId: string) {
    const task = project.tasks.find((item) => item.id === taskId);
    const original = task ? project.originals.find((item) => item.id === task.originalId) : null;
    return original ? await this.qualityQueue?.factsForOriginal(original) ?? null : null;
  }
}
