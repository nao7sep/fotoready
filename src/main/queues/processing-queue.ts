import PQueue from "p-queue";
import type { GlobalSettings } from "@shared/types/settings";
import type { Project } from "@shared/types/project";
import type { QueueSnapshot } from "@shared/types/ipc";
import { processTask } from "./processing";
import { queueSnapshotFromProject } from "./snapshot";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import type { AppLogger } from "@main/logger";

/**
 * The unit of work a queued save runs. Injectable so the queue's scheduling and cancellation can be
 * exercised without Sharp, the worker pool, or filesystem IO.
 */
export type TaskProcessor = (
  project: Project,
  taskId: string,
  settings: GlobalSettings,
  onUpdate: (() => void | Promise<void>) | undefined,
  workerPool: PipelineWorkerPool,
  logger?: AppLogger
) => Promise<void>;

/** The state of one scheduled-but-not-yet-started save. Its cancel flag is owned by exactly one job. */
type PendingJob = { cancelled: boolean };

/**
 * Runs task saves through a bounded worker pool, one job per task at a time.
 *
 * Cancellation is bound to the specific scheduled job (a flag on its {@link PendingJob} captured in
 * the job closure), never to a task-keyed set shared across jobs. That is what makes cancel-then-
 * resave correct: re-enqueuing a task whose job is still pending clears that job's cancel flag
 * (the fresh save supersedes the cancel) instead of being swallowed as a duplicate and then skipped
 * — the bug that previously stranded a task in a permanent "queued" state with no in-flight work.
 */
export class ProcessingQueue {
  #queue: PQueue;
  #onUpdate: (() => void | Promise<void>) | null;
  #afterTaskProcessed: ((taskId: string) => void | Promise<void>) | null = null;
  #pending = new Map<string, PendingJob>();
  #active = new Set<string>();

  constructor(
    workerPoolSize: number,
    private readonly settings: GlobalSettings,
    private readonly workerPool: PipelineWorkerPool,
    private readonly logger?: AppLogger,
    onUpdate: (() => void | Promise<void>) | null = null,
    private readonly processor: TaskProcessor = processTask
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
    if (this.#active.has(taskId)) return;

    const existing = this.#pending.get(taskId);
    if (existing) {
      // A job is already scheduled for this task; this fresh save supersedes any prior cancel of it.
      existing.cancelled = false;
      return;
    }

    const job: PendingJob = { cancelled: false };
    this.#pending.set(taskId, job);
    await this.#queue.add(async () => {
      this.#pending.delete(taskId);
      if (job.cancelled) {
        await this.#onUpdate?.();
        return;
      }
      this.#active.add(taskId);
      await this.#onUpdate?.();
      try {
        await this.processor(project, taskId, this.settings, this.#onUpdate ?? undefined, this.workerPool, this.logger);
        await this.#afterTaskProcessed?.(taskId);
      } catch (error) {
        this.logger?.error("queued task failed outside task processor", { mod: "processing.queue", taskId, err: error });
        throw error;
      } finally {
        this.#active.delete(taskId);
        await this.#onUpdate?.();
      }
    });
  }

  cancelTask(taskId: string): boolean {
    const job = this.#pending.get(taskId);
    if (!job) return false;
    job.cancelled = true;
    return true;
  }

  cancelAll(): string[] {
    const cancelled = Array.from(this.#pending.keys());
    for (const job of this.#pending.values()) job.cancelled = true;
    return cancelled;
  }

  snapshot(project: Project): QueueSnapshot {
    const active = Array.from(this.#active);
    const base = queueSnapshotFromProject(project, active[0] ?? null);
    return {
      ...base,
      processing: Math.max(base.processing, active.length)
    };
  }
}
