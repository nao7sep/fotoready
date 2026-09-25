import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Project, Task } from "@shared/types/project";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { ProcessingQueue } from "@main/queues/processing-queue";

const mocks = vi.hoisted(() => ({
  applyMetadataToOutput: vi.fn<(input: { outputPath: string }) => Promise<void>>()
}));

vi.mock("@adapters/exiftool", () => ({ applyMetadataToOutput: mocks.applyMetadataToOutput }));

import { processTask } from "@main/queues/processing";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-processing-"));
  mocks.applyMetadataToOutput.mockReset();
  mocks.applyMetadataToOutput.mockResolvedValue(undefined);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("processTask output publication", () => {
  it("renders and tags the image under a temporary name, then gives it its final name", async () => {
    const { project, task } = arrange();
    const seenAtMetadata: string[][] = [];
    mocks.applyMetadataToOutput.mockImplementation(async (input) => {
      expect(path.extname(input.outputPath)).toBe(".tmp");
      seenAtMetadata.push(await fs.readdir(dir));
    });

    await processTask(project, task.id, defaultGlobalSettings(), undefined, writingPool());

    expect(task.status).toBe("saved");
    // While metadata was being written, nothing in the folder carried an image name.
    expect(seenAtMetadata[0].filter((name) => name.endsWith(".jpg"))).toEqual([]);
    const names = await fs.readdir(dir);
    expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(names).toContain(path.basename(task.output!.stagedPath));
    expect(await fs.readFile(task.output!.stagedPath, "utf8")).toBe("rendered");
  });

  it("leaves no image in the output folder when the save is aborted during metadata", async () => {
    const { project, task } = arrange();
    const controller = new AbortController();
    mocks.applyMetadataToOutput.mockImplementation(async () => {
      controller.abort();
    });

    await processTask(project, task.id, defaultGlobalSettings(), undefined, writingPool(), undefined, controller.signal);

    expect(task.status).toBe("error");
    expect(task.output).toBeNull();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("removes the partial file when the render itself is aborted", async () => {
    const { project, task } = arrange();
    const controller = new AbortController();
    const pool = {
      async process(input: { outputPath: string; signal?: AbortSignal }) {
        await fs.writeFile(input.outputPath, "trunc");
        controller.abort();
        input.signal?.throwIfAborted();
        throw new Error("unreachable");
      }
    } as unknown as PipelineWorkerPool;

    await processTask(project, task.id, defaultGlobalSettings(), undefined, pool, undefined, controller.signal);

    expect(task.status).toBe("error");
    expect(await fs.readdir(dir)).toEqual([]);
  });
});

describe("ProcessingQueue shutdown", () => {
  it("aborts the running save, skips waiting ones, and resolves after the running one settles", async () => {
    const started: string[] = [];
    let settled = false;
    const queue = new ProcessingQueue(1, defaultGlobalSettings(), {} as PipelineWorkerPool, undefined, null, async (_project, taskId, _settings, _onUpdate, _pool, _logger, signal) => {
      started.push(taskId);
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 5));
      settled = true;
    });
    const project = { tasks: [], originals: [], outputDir: null } as unknown as Project;

    void queue.enqueueTask(project, "A");
    void queue.enqueueTask(project, "B");
    await new Promise((resolve) => setTimeout(resolve, 0));

    await queue.shutdown();

    expect(settled).toBe(true);
    expect(started).toEqual(["A"]);
    await expect(queue.enqueueTask(project, "C")).rejects.toThrow(/closing/);
  });
});

function writingPool(): PipelineWorkerPool {
  return {
    async process(input: { outputPath: string }) {
      await fs.writeFile(input.outputPath, "rendered");
      return { kind: "process", outputPath: input.outputPath, outputHash: "hash", bytes: 8, appliedPipeline: defaultPipeline() };
    }
  } as unknown as PipelineWorkerPool;
}

function arrange(): { project: Project; task: Task } {
  const original: Original = {
    id: "original-1",
    sourcePath: path.join(dir, "..", "photo.jpg"),
    sourceHash: "source-hash",
    size: 100,
    format: "jpeg",
    jpegQualityEstimate: null,
    metadataSummary: { editorial: {}, dates: {}, gps: {} },
    width: 100,
    height: 80,
    addedAt: "2026-09-01T00:00:00.000Z"
  };
  const task: Task = {
    id: "task-1",
    originalId: original.id,
    generateDescription: false,
    generateSlug: false,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline: defaultPipeline(),
    status: "queued",
    output: null,
    error: null,
    everEdited: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
  return { project: { outputDir: dir, originals: [original], tasks: [task] }, task };
}
