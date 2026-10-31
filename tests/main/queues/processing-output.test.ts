import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Project, Task } from "@shared/types/project";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { ProcessingQueue } from "@main/queues/processing-queue";
import { TASK_SIDECAR_SUFFIX } from "@shared/constants";
import { message } from "@shared/i18n/translate";
import { DatabaseSync } from "node:sqlite";
import { createLogger } from "@main/logger";
import { createRecordsStore } from "@main/records-store";
import { openRecordsDatabase } from "@main/records-tables";
import { readRecords } from "@main/records-queries";

const mocks = vi.hoisted(() => ({
  applyMetadataToOutput: vi.fn<(input: { outputPath: string }) => Promise<void>>()
}));

vi.mock("@adapters/exiftool", () => ({ applyMetadataToOutput: mocks.applyMetadataToOutput }));

import { applySaveUpdate, processTask, type SaveUpdate } from "@main/queues/processing";
import { APP_WRITER } from "@main/app-writer";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-processing-"));
  mocks.applyMetadataToOutput.mockReset();
  mocks.applyMetadataToOutput.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("processTask output publication", () => {
  it("retains a completed save's file identities in records after workspace removal and reopening the database", async () => {
    const { project, task } = arrange();
    const sourcePath = project.originals[0]!.sourcePath;
    const databasePath = path.join(dir, "records.sqlite3");
    const sessionStart = new Date("2026-10-23T01:00:00.000Z");
    const database = openRecordsDatabase(databasePath, APP_WRITER);
    const records = createRecordsStore({ writeRecord: (row) => database.insert(sessionStart.toISOString(), row) }, sessionStart);
    const logger = createLogger(records, { debug: false });
    let outputPath: string;
    try {
      await processTask(project, task.id, defaultGlobalSettings(), (update) => applySaveUpdate(task, update), writingPool(), logger);
      expect(task.status).toBe("saved");
      outputPath = task.output!.stagedPath;
      project.tasks.splice(0);
      project.originals.splice(0);
    } finally { database.close(); }

    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const page = readRecords(reopened, { op: "page", query: {
        session: sessionStart.toISOString(), kind: "log", level: "info", taskId: task.id, search: "task processing done", after: null
      } });
      expect(page.records).toHaveLength(1);
      const saved = page.records[0]!;
      const detail = readRecords(reopened, { op: "detail", kind: saved.kind, id: saved.id });
      expect(detail).toMatchObject({ kind: "log", taskId: task.id, message: "task processing done" });
      if (detail?.kind !== "log") throw new Error("Expected the persisted completed-save log");
      expect(JSON.parse(detail.fields)).toMatchObject({ sourcePath, outputPath });
      expect(await fs.readFile(outputPath!, "utf8")).toBe("rendered");
      expect(project.tasks).toEqual([]);
      expect(project.originals).toEqual([]);
    } finally { reopened.close(); }
  });

  it("publishes into the literal selected output folder, including trailing spaces", async () => {
    const { project, task } = arrange();
    project.outputDir = path.join(dir, " $UNSET_OUTPUT %literal% ");
    await processTask(project, task.id, defaultGlobalSettings(), (update) => applySaveUpdate(task, update), writingPool());
    expect(task.status).toBe("saved");
    expect(path.dirname(task.output!.stagedPath)).toBe(project.outputDir);
    expect(await fs.readFile(task.output!.stagedPath, "utf8")).toBe("rendered");
  });

  it("renders and tags the image under a temporary name, then gives it its final name", async () => {
    const { project, task } = arrange();
    const seenAtMetadata: string[][] = [];
    mocks.applyMetadataToOutput.mockImplementation(async (input) => {
      expect(path.extname(input.outputPath)).toBe(".tmp");
      seenAtMetadata.push(await fs.readdir(dir));
    });

    await processTask(project, task.id, defaultGlobalSettings(), (update) => applySaveUpdate(task, update), writingPool());

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

    await processTask(project, task.id, defaultGlobalSettings(), (update) => applySaveUpdate(task, update), writingPool(), undefined, controller.signal);

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

    await processTask(project, task.id, defaultGlobalSettings(), (update) => applySaveUpdate(task, update), pool, undefined, controller.signal);

    expect(task.status).toBe("error");
    expect(await fs.readdir(dir)).toEqual([]);
  });
});

describe("processTask out of memory", () => {
  it.each([
    ["the image library", () => new Error("vips_malloc: out of memory")],
    ["a worker that ran out of memory", () => Object.assign(new Error("Worker terminated due to reaching memory limit"), { code: "ERR_WORKER_OUT_OF_MEMORY" })]
  ])("stops the save, removes its partial file and says what to do when %s runs out", async (_where, failure) => {
    const { project, task } = arrange();
    const pool = {
      async process(input: { outputPath: string }) {
        await fs.writeFile(input.outputPath, "partial");
        throw failure();
      }
    } as unknown as PipelineWorkerPool;

    await processTask(project, task.id, defaultGlobalSettings(), (update) => applySaveUpdate(task, update), pool);

    expect(task.status).toBe("error");
    expect(task.error).toMatchObject({ message: message("processingError.memory"), retryable: true });
    expect(await fs.readdir(dir)).toEqual([]);
  });
});

describe("processTask status times", () => {
  it("changes the task's status, not its modified time, whether the save succeeds or fails", async () => {
    const saved = arrange();
    const before = saved.task.updatedAt;
    await processTask(saved.project, saved.task.id, defaultGlobalSettings(), (update) => applySaveUpdate(saved.task, update), writingPool());
    expect(saved.task.status).toBe("saved");
    expect(saved.task.updatedAt).toBe(before);

    const failed = arrange();
    mocks.applyMetadataToOutput.mockRejectedValueOnce(new Error("exiftool failed"));
    await processTask(failed.project, failed.task.id, defaultGlobalSettings(), (update) => applySaveUpdate(failed.task, update), writingPool());
    expect(failed.task.status).toBe("error");
    expect(failed.task.updatedAt).toBe(before);
  });
});

describe("ProcessingQueue shutdown", () => {
  it("aborts the running save, skips waiting ones, and resolves after the running one settles", async () => {
    const started: string[] = [];
    let settled = false;
    let announceStart!: () => void;
    const startedA = new Promise<void>((resolve) => { announceStart = resolve; });
    let announceAbort!: () => void;
    const abortedA = new Promise<void>((resolve) => { announceAbort = resolve; });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const queue = new ProcessingQueue(1, defaultGlobalSettings(), {} as PipelineWorkerPool, undefined, null, async (_project, taskId, _settings, _report, _pool, _logger, signal) => {
      started.push(taskId);
      const aborted = new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      announceStart();
      await aborted;
      announceAbort();
      // The render settles after its abort, as a worker can.
      await finished;
      settled = true;
    });
    const project = { tasks: [], originals: [], outputDir: null } as unknown as Project;

    void queue.enqueueTask(project, "A");
    void queue.enqueueTask(project, "B");
    await startedA;

    const shutdown = queue.shutdown();
    await abortedA;
    expect(settled).toBe(false);
    finish();
    await shutdown;

    expect(settled).toBe(true);
    expect(started).toEqual(["A"]);
  });
});

function writingPool(): PipelineWorkerPool {
  return {
    async process(input: { outputPath: string }) {
      await fs.writeFile(input.outputPath, "rendered");
      return { kind: "process", outputPath: input.outputPath, bytes: 8, appliedPipeline: defaultPipeline() };
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

describe("processTask after the save completes", () => {
  it("keeps the saved image and sidecar when announcing the save fails", async () => {
    const { project, task } = arrange();
    mocks.applyMetadataToOutput.mockImplementation(async () => undefined);
    const onUpdate = vi.fn(async (update: SaveUpdate) => {
      applySaveUpdate(task, update);
      if (task.status === "saved") throw new Error("window gone");
    });

    await expect(processTask(project, task.id, defaultGlobalSettings(), onUpdate, writingPool())).rejects.toThrow("window gone");

    expect(task.status).toBe("saved");
    await expect(fs.access(task.output!.stagedPath)).resolves.toBeUndefined();
    await expect(fs.access(task.output!.stagedParamsPath!)).resolves.toBeUndefined();
  });
});

describe("processTask sidecar failure", () => {
  it("leaves the task without an output when the sidecar cannot be written", async () => {
    const { project, task } = arrange();
    // A directory where the sidecar file belongs makes its write fail after the image landed.
    const pool = {
      async process(input: { outputPath: string }) {
        await fs.writeFile(input.outputPath, "rendered");
        return { kind: "process", outputPath: input.outputPath, bytes: 8, appliedPipeline: defaultPipeline() };
      }
    } as unknown as PipelineWorkerPool;
    mocks.applyMetadataToOutput.mockImplementation(async (input) => {
      // The image is staged under its final name's fixed temp name, `<final stem>-jpg.tmp`.
      const finalStem = path.parse(input.outputPath).name.slice(0, -"-jpg".length);
      await fs.mkdir(path.join(dir, `${finalStem}${TASK_SIDECAR_SUFFIX}`));
    });

    await processTask(project, task.id, defaultGlobalSettings(), (update) => applySaveUpdate(task, update), pool);

    expect(task.status).toBe("error");
    expect(task.output).toBeNull();
    expect((await fs.readdir(dir)).filter((name) => name.endsWith(".jpg") || name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("processTask with an output folder naming an unset variable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails the save with a reason naming the variable, and writes nothing", async () => {
    vi.stubEnv("FOTOREADY_OUTPUT_TEST_UNSET", undefined);
    const { project, task } = arrange();
    // An expression starts with the variable; an absolute folder is taken as picked.
    project.outputDir = "$FOTOREADY_OUTPUT_TEST_UNSET/out";

    await processTask(project, task.id, defaultGlobalSettings(), (update) => applySaveUpdate(task, update), writingPool());

    expect(task.status).toBe("error");
    expect(task.error?.message).toEqual(message("failure.withReason", {
      failure: message("processingError.io"),
      reason: message("failure.pathVariable", { variable: "FOTOREADY_OUTPUT_TEST_UNSET" })
    }));
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
