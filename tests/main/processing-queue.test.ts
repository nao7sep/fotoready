import { describe, expect, it } from "vitest";
import { ProcessingQueue, type TaskProcessor } from "@main/queues/processing-queue";
import type { Project } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";

// The queue only touches taskId for scheduling/cancellation; the processor is injected, so a bare
// project and settings are enough and no Sharp/worker/filesystem work runs.
const project = { tasks: [], originals: [], outputDir: null } as unknown as Project;
const settings = {} as GlobalSettings;
const workerPool = {} as PipelineWorkerPool;

/** Resolves once the task's save has started, at once when it already has. */
function startEvents() {
  const started: string[] = [];
  const waiters = new Map<string, () => void>();
  const events = new Map<string, Promise<void>>();
  const whenStarted = (taskId: string): Promise<void> => {
    if (!events.has(taskId)) events.set(taskId, new Promise((resolve) => waiters.set(taskId, resolve)));
    return events.get(taskId)!;
  };
  const start = (taskId: string): void => {
    started.push(taskId);
    void whenStarted(taskId);
    waiters.get(taskId)!();
  };
  return { started, whenStarted, start };
}

// A processor that records what started/completed and blocks each task until released, so a job can
// be held "running" while another sits pending behind the concurrency limit.
function controllableProcessor() {
  const { started, whenStarted, start } = startEvents();
  const processed: string[] = [];
  const gates = new Map<string, () => void>();
  const processor: TaskProcessor = async (_project, taskId) => {
    const gate = new Promise<void>((resolve) => gates.set(taskId, resolve));
    start(taskId);
    await gate;
    processed.push(taskId);
  };
  return { processor, started, processed, whenStarted, release: (id: string) => gates.get(id)?.() };
}

describe("ProcessingQueue cancellation", () => {
  it("runs a fresh save that arrives after the task's still-pending job was cancelled", async () => {
    const { processor, started, processed, whenStarted, release } = controllableProcessor();
    const queue = new ProcessingQueue(1, settings, workerPool, undefined, null, processor);

    const a = queue.enqueueTask(project, "A");
    const b = queue.enqueueTask(project, "B");
    await whenStarted("A");
    expect(started).toEqual(["A"]); // A is running; B waits behind concurrency 1

    expect(queue.cancelTask("B")).toBe(true);
    void queue.enqueueTask(project, "B"); // re-save must supersede the cancel, not be swallowed

    release("A");
    await a;
    await whenStarted("B");
    release("B");
    await b;

    expect(processed).toContain("B"); // the revived save actually ran (the bug stranded it as "queued")
  });

  it("skips a cancelled queued job when no fresh save supersedes it", async () => {
    const { processor, started, processed, whenStarted, release } = controllableProcessor();
    const queue = new ProcessingQueue(1, settings, workerPool, undefined, null, processor);

    const a = queue.enqueueTask(project, "A");
    const b = queue.enqueueTask(project, "B");
    await whenStarted("A");

    queue.cancelTask("B");
    release("A");
    await a;
    await b;

    expect(started).toEqual(["A"]);
    expect(processed).toEqual(["A"]); // B was cancelled and never ran
  });

  it("does not double-run a task enqueued twice while its job is still pending", async () => {
    const { processor, started, processed, whenStarted, release } = controllableProcessor();
    const queue = new ProcessingQueue(1, settings, workerPool, undefined, null, processor);

    const a = queue.enqueueTask(project, "A");
    const b = queue.enqueueTask(project, "B");
    void queue.enqueueTask(project, "B"); // duplicate while pending
    await whenStarted("A");

    release("A");
    await a;
    await whenStarted("B");
    release("B");
    await b;

    expect(started.filter((id) => id === "B")).toEqual(["B"]); // exactly one B job
    expect(processed.filter((id) => id === "B")).toEqual(["B"]);
  });

  it("reports a cancelled task by id from cancelTask and cancelAll", async () => {
    const { processor, whenStarted, release } = controllableProcessor();
    const queue = new ProcessingQueue(1, settings, workerPool, undefined, null, processor);

    const a = queue.enqueueTask(project, "A");
    void queue.enqueueTask(project, "B");
    void queue.enqueueTask(project, "C");
    await whenStarted("A");

    // A is active (not pending), B and C are pending.
    expect(queue.cancelTask("A")).toBe(false);
    expect(queue.cancelAll().sort()).toEqual(["B", "C"]);

    release("A");
    await a;
  });
});

describe("ProcessingQueue abort", () => {
  // A processor that runs until its save is aborted, as a real render stops on its signal.
  function abortableProcessor() {
    const { started, whenStarted, start } = startEvents();
    const aborted: string[] = [];
    const processor: TaskProcessor = async (_project, taskId, _settings, _report, _pool, _logger, signal) => {
      const abortedNow = new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
      start(taskId);
      await abortedNow;
      aborted.push(taskId);
    };
    return { processor, started, aborted, whenStarted };
  }

  it("aborts the running save, skips the waiting ones, and still takes new saves when the workspace is discarded", async () => {
    const { processor, started, aborted, whenStarted } = abortableProcessor();
    const queue = new ProcessingQueue(1, settings, workerPool, undefined, null, processor);
    void queue.enqueueTask(project, "A");
    void queue.enqueueTask(project, "B");
    await whenStarted("A");

    await queue.abortAll();
    expect(aborted).toEqual(["A"]);
    expect(started).toEqual(["A"]);

    void queue.enqueueTask(project, "C");
    await whenStarted("C");
    expect(started).toEqual(["A", "C"]);
    await queue.shutdown();
  });
});

describe("ProcessingQueue admission", () => {
  it("holds a large save until memory allows, and starts it when the one before finishes", async () => {
    const { processor, started, whenStarted, release } = controllableProcessor();
    const big = { width: 9504, height: 6336 };
    const photos = {
      tasks: ["A", "B"].map((id) => ({ id, originalId: id, pipeline: { ops: [] } })),
      originals: ["A", "B"].map((id) => ({ id, ...big })),
      outputDir: null
    } as unknown as Project;
    // Two 60 MP saves need about 1.6 GB, more than half of a 2 GB machine.
    const queue = new ProcessingQueue(8, settings, workerPool, undefined, null, processor, 2 * 2 ** 30);
    const a = queue.enqueueTask(photos, "A");
    const b = queue.enqueueTask(photos, "B");
    await whenStarted("A");
    expect(started).toEqual(["A"]);
    release("A");
    await a;
    await whenStarted("B");
    expect(started).toEqual(["A", "B"]);
    release("B");
    await b;
  });

  it("reserves the largest captured recipe frame and still starts an oversized first job", async () => {
    const { processor, started, whenStarted, release } = controllableProcessor();
    const ops = [
      { id: "large", type: "resize", enabled: true, params: { mode: "exact", width: 4000, height: 3000 } },
      { id: "small", type: "resize", enabled: true, params: { mode: "exact", width: 400, height: 300 } }
    ];
    const photos = {
      tasks: ["A", "B"].map((id) => ({ id, originalId: id, pipeline: { ops } })),
      originals: ["A", "B"].map((id) => ({ id, width: 1000, height: 1000 })),
      outputDir: null
    } as unknown as Project;
    // The source frames would both fit; the enlarged intermediate exceeds the whole share.
    const queue = new ProcessingQueue(8, settings, workerPool, undefined, null, processor, 200_000_000);
    const first = queue.enqueueTask(photos, "A");
    const second = queue.enqueueTask(photos, "B");
    await whenStarted("A");
    expect(started).toEqual(["A"]);
    release("A");
    await first;
    await whenStarted("B");
    expect(started).toEqual(["A", "B"]);
    release("B");
    await second;
  });

  it("lets a cancelled save waiting at the front stop holding back the ones behind it", async () => {
    const { processor, started, whenStarted, release } = controllableProcessor();
    const photos = {
      tasks: ["A", "B", "C"].map((id) => ({ id, originalId: id, pipeline: { ops: [] } })),
      originals: ["A", "B", "C"].map((id) => ({ id, width: 9504, height: 6336 })),
      outputDir: null
    } as unknown as Project;
    const queue = new ProcessingQueue(8, settings, workerPool, undefined, null, processor, 2 * 2 ** 30);
    void queue.enqueueTask(photos, "A");
    void queue.enqueueTask(photos, "B");
    const c = queue.enqueueTask(photos, "C");
    await whenStarted("A");
    queue.cancelTask("B");
    release("A");
    await whenStarted("C");
    expect(started).toEqual(["A", "C"]);
    release("C");
    await c;
  });
});
