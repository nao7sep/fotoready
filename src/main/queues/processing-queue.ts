import PQueue from "p-queue";
import type { GlobalSettings } from "@shared/types/settings";
import type { Project } from "@shared/types/project";
import type { QueueSnapshot } from "@shared/types/ipc";
import { processTask } from "./processing";
import { queueSnapshotFromProject } from "./snapshot";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import type { AppLogger } from "@main/logger";

export class ProcessingQueue {
  #queue: PQueue;
  #onUpdate: (() => void | Promise<void>) | null;
  #afterTaskProcessed: ((taskId: string) => void | Promise<void>) | null = null;
  #activeTaskIds: Set<string> = new Set();
  #queuedTaskIds: Set<string> = new Set();
  #cancelledTaskIds: Set<string> = new Set();

  constructor(
    workerPoolSize: number,
    private readonly settings: GlobalSettings,
    private readonly workerPool: PipelineWorkerPool,
    private readonly logger?: AppLogger,
    onUpdate: (() => void | Promise<void>) | null = null
  ) {
    this.#onUpdate = onUpdate;
    this.#queue = new PQueue({ concurrency: Math.max(1, workerPoolSize) });
  }

  setUpdateListener(listener: () => void | Promise<void>): void {
    this.#onUpdate = listener;
  }

  setAfterTaskProcessed(listener: (taskId: string) => void | Promise<void>): void {
    this.#afterTaskProcessed = listener;
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
        await processTask(project, taskId, this.settings, this.#onUpdate ?? undefined, this.workerPool, this.logger);
        await this.#afterTaskProcessed?.(taskId);
      } catch (error) {
        this.logger?.error({ mod: "processing.queue", taskId, err: error }, "queued task failed outside task processor");
        throw error;
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
}
