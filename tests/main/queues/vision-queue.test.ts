import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Task } from "@shared/types/project";
import type { AppPaths } from "@main/paths";

const mocks = vi.hoisted(() => ({
  writeTaskSidecarFile: vi.fn<() => Promise<string>>()
}));

vi.mock("@main/task-sidecar", async (importOriginal) => {
  const original = await importOriginal<typeof import("@main/task-sidecar")>();
  return { ...original, writeTaskSidecarFile: mocks.writeTaskSidecarFile };
});

import { ProjectSession } from "@main/session";
import { VisionQueue, type VisionProvider } from "@main/queues/vision";

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-vision-"));
  mocks.writeTaskSidecarFile.mockReset();
  mocks.writeTaskSidecarFile.mockResolvedValue("/output/photo-fotoready.json");
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("VisionQueue result ownership", () => {
  it("keeps a slug the user typed while the run was in flight", async () => {
    const describe = deferred<string>();
    const { session, task } = await arrange({ describeImage: () => describe.promise, suggestSlugs: async () => ["ai-slug"] });

    const run = session.runVision(task.id, { mode: "description-and-slug" });
    await settleMicrotasks();
    await session.setCustomSlug(task.id, "my-own-slug");
    describe.resolve("A harbor at sunset");
    await run;

    expect(task.customSlug).toBe("my-own-slug");
    expect(task.output?.vision).toMatchObject({ description: "A harbor at sunset", slugCandidates: ["ai-slug"] });
  });

  it("replaces an untouched slug with the generated one", async () => {
    const { session, task } = await arrange({ describeImage: async () => "A harbor", suggestSlugs: async () => ["ai-slug"] });

    await session.runVision(task.id, { mode: "description-and-slug" });

    expect(task.customSlug).toBe("ai-slug");
  });

  it("discards a result whose output was replaced while the call ran", async () => {
    const describe = deferred<string>();
    const { session, task } = await arrange({ describeImage: () => describe.promise, suggestSlugs: async () => ["old-slug"] });

    const run = session.runVision(task.id, { mode: "description-and-slug" });
    await settleMicrotasks();
    // A re-save of the same task: a new output identity, possibly at the same path.
    task.output = { ...task.output!, stagedAt: "2026-09-02T00:00:00.000Z", outputHash: "new-hash", vision: null };
    describe.resolve("The old image");
    await run;

    expect(task.output.vision).toBeNull();
    expect(task.customSlug).toBeNull();
    expect(task.error).toBeNull();
    expect(mocks.writeTaskSidecarFile).not.toHaveBeenCalled();
  });

  it("stays running until the task's last run settles, and runs one call per task at a time", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const calls = [first, second];
    let active = 0;
    let maxActive = 0;
    const { session, task } = await arrange({
      describeImage: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          return await calls.shift()!.promise;
        } finally {
          active -= 1;
        }
      },
      suggestSlugs: async () => []
    });

    const runA = session.runVision(task.id, { mode: "description" });
    await settleMicrotasks();
    const runB = session.runVision(task.id, { mode: "description" });
    await settleMicrotasks();
    first.resolve("first");
    await runA;

    expect(task.visionRunning).toBe(true);
    await expect(session.deleteSavedOutput(task.id)).rejects.toThrow(/being analyzed/);

    await settleMicrotasks();
    second.resolve("second");
    await runB;

    expect(task.visionRunning).toBe(false);
    expect(task.visionRunMode).toBeNull();
    expect(task.output?.vision?.description).toBe("second");
    expect(maxActive).toBe(1);
  });
});

describe("VisionQueue retry after a failed step", () => {
  it("retries only the slug when the description was already committed", async () => {
    const describeImage = vi.fn(async () => "A committed description");
    const suggestSlugs = vi.fn<VisionProvider["suggestSlugs"]>()
      .mockRejectedValueOnce(new Error("slug call failed"))
      .mockResolvedValueOnce(["retried-slug"]);
    const { session, task } = await arrange({ describeImage, suggestSlugs });

    await session.runVision(task.id, { mode: "description-and-slug" });
    expect(task.error).toMatchObject({ stage: "vision", retryMode: "slug" });
    expect(task.output?.vision?.description).toBe("A committed description");

    await session.retryTask(task.id);

    expect(describeImage).toHaveBeenCalledTimes(1);
    expect(suggestSlugs).toHaveBeenCalledTimes(2);
    expect(task.error).toBeNull();
    expect(task.output?.vision).toMatchObject({ description: "A committed description", slugCandidates: ["retried-slug"] });
  });

  it("retries the whole request when the description step failed", async () => {
    const describeImage = vi.fn<VisionProvider["describeImage"]>()
      .mockRejectedValueOnce(new Error("describe failed"))
      .mockResolvedValueOnce("Second try");
    const { session, task } = await arrange({ describeImage, suggestSlugs: async () => ["slug"] });

    await session.runVision(task.id, { mode: "description-and-slug" });
    expect(task.error).toMatchObject({ stage: "vision", retryMode: "description-and-slug" });

    await session.retryTask(task.id);

    expect(describeImage).toHaveBeenCalledTimes(2);
    expect(task.output?.vision).toMatchObject({ description: "Second try", slugCandidates: ["slug"] });
  });
});

async function arrange(provider: VisionProvider): Promise<{ session: ProjectSession; task: Task }> {
  const settings = defaultGlobalSettings();
  const queue = new VisionQueue({ apiKeysPath: path.join(tempDir, "api-keys.json") } as AppPaths, settings, undefined, {
    createProvider: () => provider,
    prepareInput: async () => Buffer.from("image")
  });
  await queue.setGeminiApiKey("test-key");
  const session = new ProjectSession(settings, queue, null as never, null as never);
  const project = session.snapshot().project;
  const task = savedTask();
  project.originals.push(original());
  project.tasks.push(task);
  return { session, task };
}

async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function savedTask(): Task {
  return {
    id: "task-1",
    originalId: "original-1",
    generateDescription: true,
    generateSlug: true,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline: defaultPipeline(),
    status: "saved",
    output: {
      stagedPath: "/output/photo.jpg",
      stagedParamsPath: "/output/photo-fotoready.json",
      stagedAt: "2026-09-01T00:00:00.000Z",
      outputHash: "output-hash",
      vision: null,
      finalPath: null,
      finalParamsPath: null,
      renamedAt: null
    },
    error: null,
    everEdited: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

function original(): Original {
  return {
    id: "original-1",
    sourcePath: "/source/photo.jpg",
    sourceHash: "source-hash",
    size: 100,
    format: "jpeg",
    jpegQualityEstimate: null,
    metadataSummary: { editorial: {}, dates: {}, gps: {} },
    width: 100,
    height: 80,
    addedAt: "2026-09-01T00:00:00.000Z"
  };
}
