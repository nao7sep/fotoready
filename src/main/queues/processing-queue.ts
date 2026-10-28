import os from "node:os";
import type { GlobalSettings } from "@shared/types/settings";
import type { Project } from "@shared/types/project";
import type { QueueSnapshot } from "@shared/types/ipc";
import { processTask, type SaveUpdate } from "./processing";
import { queueSnapshotFromProject } from "./snapshot";
import { canStartSave, saveCost } from "./save-admission";
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
  report: (update: SaveUpdate) => void | Promise<void>,
  workerPool: PipelineWorkerPool,
  logger?: AppLogger,
  signal?: AbortSignal
) => Promise<void>;

/** The state of one scheduled-but-not-yet-started save. Its cancel flag is owned by exactly one job. */
type PendingJob = { cancelled: boolean };

type WaitingSave = { taskId: string; job: PendingJob; cost: number; run(): Promise<void>; settle: { resolve(): void; reject(error: unknown): void } };

/**
 * Runs task saves in image workers, one job per task at a time, as many at once as the machine holds
 * (save-admission.ts): one per core, within its memory at each photo's cost, first come first served.
 *
 * Cancellation is bound to the specific scheduled job (a flag on its {@link PendingJob} captured in
 * the job closure), never to a task-keyed set shared across jobs. That is what makes cancel-then-
 * resave correct: re-enqueuing a task whose job is still pending clears that job's cancel flag
 * (the fresh save supersedes the cancel) instead of being swallowed as a duplicate and then skipped
 * — the bug that previously stranded a task in a permanent "queued" state with no in-flight work.
 */
/**
 * What the queue tells the session: a save's report for its task, or, without one, that the queue's
 * own state changed.
 */
export type ProcessingListener = (save?: { taskId: string; update: SaveUpdate }) => void | Promise<void>;

export class ProcessingQueue {
  #onUpdate: ProcessingListener | null;
  #afterTaskProcessed: ((taskId: string) => void | Promise<void>) | null = null;
  #pending = new Map<string, PendingJob>();
  #waiting: WaitingSave[] = [];
  // Each running save's memory cost, for admission.
  #runningCosts = new Map<string, number>();
  // Each running save's abort handle, so shutting down can stop it mid-render.
  #active = new Map<string, AbortController>();
  #idleWaiters: Array<() => void> = [];

  constructor(
    private readonly cores: number,
    private readonly settings: GlobalSettings,
    private readonly workerPool: PipelineWorkerPool,
    private readonly logger?: AppLogger,
    onUpdate: ProcessingListener | null = null,
    private readonly processor: TaskProcessor = processTask,
    private readonly totalMemory: number = os.totalmem()
  ) {
    this.#onUpdate = onUpdate;
  }

  setUpdateListener(listener: ProcessingListener): void {
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
    const task = project.tasks.find((item) => item.id === taskId);
    const original = task ? project.originals.find((item) => item.id === task.originalId) : undefined;
    const cost = original && task ? saveCost(original.width, original.height, task.pipeline.ops) : 0;
    await new Promise<void>((resolve, reject) => {
      this.#waiting.push({ taskId, job, cost, run: () => this.#run(project, taskId, job), settle: { resolve, reject } });
      this.#pump();
    });
  }

  /** Starts waiting saves, in order, while the next one fits beside those running. */
  #pump(): void {
    while (this.#waiting.length > 0) {
      const next = this.#waiting[0]!;
      if (!next.job.cancelled && !canStartSave([...this.#runningCosts.values()], next.cost, this.cores, this.totalMemory)) break;
      this.#waiting.shift();
      this.#runningCosts.set(next.taskId, next.cost);
      void next.run().then(next.settle.resolve, next.settle.reject).finally(() => {
        this.#runningCosts.delete(next.taskId);
        this.#pump();
        this.#notifyIdle();
      });
    }
  }

  async #run(project: Project, taskId: string, job: PendingJob): Promise<void> {
    this.#pending.delete(taskId);
    if (job.cancelled) {
      await this.#onUpdate?.();
      return;
    }
    const controller = new AbortController();
    this.#active.set(taskId, controller);
    await this.#onUpdate?.();
    try {
      await this.processor(project, taskId, this.settings, (update) => this.#onUpdate?.({ taskId, update }), this.workerPool, this.logger, controller.signal);
      if (!controller.signal.aborted) await this.#afterTaskProcessed?.(taskId);
    } catch (error) {
      this.logger?.error("queued task failed outside task processor", { mod: "processing.queue", taskId, err: error });
      throw error;
    } finally {
      this.#active.delete(taskId);
      await this.#onUpdate?.();
    }
  }

  #notifyIdle(): void {
    if (this.#waiting.length > 0 || this.#runningCosts.size > 0) return;
    for (const waiter of this.#idleWaiters.splice(0)) waiter();
  }

  #onIdle(): Promise<void> {
    if (this.#waiting.length === 0 && this.#runningCosts.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  cancelTask(taskId: string): boolean {
    const job = this.#pending.get(taskId);
    if (!job) return false;
    job.cancelled = true;
    // A cancelled save waiting at the head no longer holds back the ones behind it.
    this.#pump();
    return true;
  }

  cancelAll(): string[] {
    const cancelled = Array.from(this.#pending.keys());
    for (const job of this.#pending.values()) job.cancelled = true;
    this.#pump();
    return cancelled;
  }

  /**
   * Cancels every waiting save, aborts the running ones, and waits for their promises. Rejection can
   * precede physical worker termination and leave a temporary file. New saves are still taken.
   */
  async abortAll(): Promise<void> {
    this.cancelAll();
    for (const controller of this.#active.values()) controller.abort();
    await this.#onIdle();
  }

  /**
   * Stops for quit as {@link abortAll} does; IPC admission, already closed, keeps new saves from
   * arriving. The caller bounds its wait and tears down workers.
   */
  async shutdown(): Promise<void> {
    await this.abortAll();
  }

  snapshot(project: Project): QueueSnapshot {
    const active = Array.from(this.#active.keys());
    const base = queueSnapshotFromProject(project, active[0] ?? null);
    return {
      ...base,
      processing: Math.max(base.processing, active.length)
    };
  }
}
