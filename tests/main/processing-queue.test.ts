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

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await tick();
}

// A processor that records what started/completed and blocks each task until released, so a job can
// be held "running" while another sits pending behind the concurrency limit.
function controllableProcessor() {
  const started: string[] = [];
  const processed: string[] = [];
  const gates = new Map<string, () => void>();
  const processor: TaskProcessor = async (_project, taskId) => {
    started.push(taskId);
    await new Promise<void>((resolve) => gates.set(taskId, resolve));
    processed.push(taskId);
  };
  return { processor, started, processed, release: (id: string) => gates.get(id)?.() };
}

describe("ProcessingQueue cancellation", () => {
  it("runs a fresh save that arrives after the task's still-pending job was cancelled", async () => {
    const { processor, started, processed, release } = controllableProcessor();
    const queue = new ProcessingQueue(1, settings, workerPool, undefined, null, processor);

    void queue.enqueueTask(project, "A");
    void queue.enqueueTask(project, "B");
    await settle();
    expect(started).toEqual(["A"]); // A is running; B waits behind concurrency 1

    expect(queue.cancelTask("B")).toBe(true);
    void queue.enqueueTask(project, "B"); // re-save must supersede the cancel, not be swallowed

    release("A");
    await settle();
    release("B");
    await settle();

    expect(processed).toContain("B"); // the revived save actually ran (the bug stranded it as "queued")
  });

  it("skips a cancelled queued job when no fresh save supersedes it", async () => {
    const { processor, started, processed, release } = controllableProcessor();
    const queue = new ProcessingQueue(1, settings, workerPool, undefined, null, processor);

    void queue.enqueueTask(project, "A");
    void queue.enqueueTask(project, "B");
    await settle();

    queue.cancelTask("B");
    release("A");
    await settle();

    expect(started).toEqual(["A"]);
    expect(processed).toEqual(["A"]); // B was cancelled and never ran
  });

  it("does not double-run a task enqueued twice while its job is still pending", async () => {
    const { processor, started, processed, release } = controllableProcessor();
    const queue = new ProcessingQueue(1, settings, workerPool, undefined, null, processor);

    void queue.enqueueTask(project, "A");
    void queue.enqueueTask(project, "B");
    void queue.enqueueTask(project, "B"); // duplicate while pending
    await settle();

    release("A");
    await settle();
    release("B");
    await settle();

    expect(started.filter((id) => id === "B")).toEqual(["B"]); // exactly one B job
    expect(processed.filter((id) => id === "B")).toEqual(["B"]);
  });

  it("reports a cancelled task by id from cancelTask and cancelAll", async () => {
    const { processor, release } = controllableProcessor();
    const queue = new ProcessingQueue(1, settings, workerPool, undefined, null, processor);

    void queue.enqueueTask(project, "A");
    void queue.enqueueTask(project, "B");
    void queue.enqueueTask(project, "C");
    await settle();

    // A is active (not pending), B and C are pending.
    expect(queue.cancelTask("A")).toBe(false);
    expect(queue.cancelAll().sort()).toEqual(["B", "C"]);

    release("A");
    await settle();
  });
});
