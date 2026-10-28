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
import { VisionQueue, type VisionProvider, type VisionQueueDeps } from "@main/queues/vision";
import { queueSnapshotFromProject } from "@main/queues/snapshot";
import { ApiKeyStore } from "@adapters/api-keys";
import { GeminiVisionProvider, type GeminiCall, type GeminiCallLifecycle } from "@adapters/gemini";
import { createLogger, type AppLogger } from "@main/logger";
import { defaultMediaResolutionFor, defaultThinkingFor } from "@shared/ai-models";
import type { GlobalSettings } from "@shared/types/settings";
import type { ProviderCallRecord } from "@main/records-store";
import { loadSettings, saveSettings } from "@main/settings-io";
import { DatabaseSync } from "node:sqlite";
import { startStoreWriter } from "@main/store-writer";
import { createRecordsStore, fallbackFile } from "@main/records-store";
import { openRecordsDatabase } from "@main/records-tables";

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
  vi.stubEnv("GEMINI_API_KEY", undefined);
  mocks.writeTaskSidecarFile.mockReset();
  mocks.writeTaskSidecarFile.mockResolvedValue("/output/photo-fotoready.json");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("session vision snapshot ownership", () => {
  it("publishes running and committed progress, returning final settlement only to its caller", async () => {
    const description = deferred<string>();
    const slugs = deferred<string[]>();
    const startedSlug = deferred<void>();
    const { session, task } = await arrange({
      describeImage: () => description.promise,
      suggestSlugs: () => { startedSlug.resolve(); return slugs.promise; }
    });
    const visible: Task[] = [];
    session.setSnapshotListener((snapshot) => { visible.push(structuredClone(snapshot.project.tasks[0]!)); });

    const run = session.runVision(task.id, { mode: "description-and-slug" });
    expect(visible).toHaveLength(1);
    expect(visible[0]!.visionRunning).toBe(true);
    expect(visible[0]!.output!.vision).toBeNull();
    description.resolve("A harbor");
    await startedSlug.promise;
    expect(visible).toHaveLength(2);
    expect(visible[1]!.output!.vision).toMatchObject({ description: "A harbor", slugCandidates: [] });
    expect(visible[1]!.visionRunning).toBe(true);

    slugs.resolve(["harbor"]);
    const reply = await run;

    expect(visible).toHaveLength(3);
    expect(visible[2]!.output!.vision!.slugCandidates).toEqual(["harbor"]);
    expect(visible[2]!.visionRunning).toBe(true);
    expect(reply.project.tasks[0]!.visionRunning).toBe(false);
    expect(reply.project.tasks[0]!.visionRunMode).toBeNull();
  });

  it("publishes final background completion through the post-save owner", async () => {
    const finished = deferred<void>();
    const { session, task } = await arrange({ describeImage: async () => "A harbor", suggestSlugs: async () => ["harbor"] });
    const visible: Task[] = [];
    session.setSnapshotListener((snapshot) => {
      const current = structuredClone(snapshot.project.tasks[0]!);
      visible.push(current);
      if (!current.visionRunning && current.output!.vision) finished.resolve();
    });

    await session.afterTaskProcessed(task.id);
    await finished.promise;

    expect(visible).toHaveLength(4);
    expect(visible.map((current) => current.visionRunning)).toEqual([true, true, true, false]);
    expect(visible.at(-1)!.output!.vision).toMatchObject({ description: "A harbor", slugCandidates: ["harbor"] });
  });

  it("keeps notification failures separate from a successful vision result", async () => {
    const { session, task } = await arrange({ describeImage: async () => "A harbor", suggestSlugs: async () => ["harbor"] });
    const listener = vi.fn(async () => { throw new Error("notification failed"); });
    session.setSnapshotListener(listener);

    const reply = await session.runVision(task.id, { mode: "description" });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(reply.project.tasks[0]!.output!.vision!.description).toBe("A harbor");
    expect(task.error).toBeNull();
    expect(task.visionRunning).toBe(false);
  });

  it("publishes settlement before rethrowing a rejected run", async () => {
    const { session } = await arrange({ describeImage: async () => "A harbor", suggestSlugs: async () => [] });
    const listener = vi.fn();
    session.setSnapshotListener(listener);

    await expect(session.runVision("missing-task", { mode: "description" })).rejects.toThrow("Task not found: missing-task");

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

it("keeps the provider result receipt time while its sidecar commit waits", async () => {
  const described = deferred<void>();
  const { session, task } = await arrange({
    describeImage: async () => {
      described.resolve();
      return "A harbor";
    },
    suggestSlugs: async () => ["slug"]
  });
  const blocked = deferred<string>();
  const editWriting = deferred<void>();
  mocks.writeTaskSidecarFile.mockImplementationOnce(() => { editWriting.resolve(); return blocked.promise; });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-07T01:00:00Z"));
    const edit = session.setCustomSlug(task.id, "user-slug");
    await editWriting.promise;
    // The vision result reaches the session's commit once the provider has returned and its receipt
    // time is stamped; the commit then waits behind the edit's write.
    const committing = deferred<void>();
    const commit = (session as unknown as { commitTaskMetadata: (...args: unknown[]) => Promise<boolean> }).commitTaskMetadata.bind(session);
    vi.spyOn(session as unknown as { commitTaskMetadata: typeof commit }, "commitTaskMetadata").mockImplementation((...args) => { committing.resolve(); return commit(...args); });
    vi.setSystemTime(new Date("2026-10-07T01:01:00Z"));
    const vision = session.runVision(task.id, { mode: "description" });
    await described.promise;
    await committing.promise;
    vi.setSystemTime(new Date("2026-10-07T01:02:00Z"));
    blocked.resolve("sidecar");
    await Promise.all([edit, vision]);
    expect(task.output?.vision?.ranAt).toBe("2026-10-07T01:01:00.000Z");
    expect(task.updatedAt).toBe(task.output?.vision?.ranAt);
  } finally { vi.useRealTimers(); }
});

describe("VisionQueue provider records", () => {
  it("logs one unknown start and correlates the completed provider record without a terminal log", async () => {
    const attempted = deferred<void>();
    const writeLog = vi.fn((record: { message: string; fields: Record<string, unknown> }) => { if (record.message === "vision provider attempt") attempted.resolve(); });
    const logger = createLogger({ writeLog }, { debug: false });
    const writeProviderCall = vi.fn<(record: ProviderCallRecord) => void>();
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(() => response.promise));
    let provider!: GeminiVisionProvider;
    const { session, task } = await arrange({ describeImage: (request, options) => provider.describeImage(request, options), suggestSlugs: vi.fn() },
      { writeProviderCall }, (recordCall, lifecycle) => { provider = new GeminiVisionProvider("test-key", "https://models.example", recordCall, lifecycle); }, undefined, undefined, logger);
    const run = session.runVision(task.id, { mode: "description" });
    const attempts = () => writeLog.mock.calls.map(([record]) => record).filter((record) => record.message === "vision provider attempt");
    await attempted.promise;
    expect(attempts()).toHaveLength(1);
    const start = attempts()[0].fields;
    expect(start).toMatchObject({ taskId: task.id, phase: "start", outcome: "unknown", attemptId: expect.any(String), callTime: expect.any(String) });
    expect(writeProviderCall).not.toHaveBeenCalled();
    response.resolve(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A harbor" }] } }] })));
    await run;
    expect(attempts()).toHaveLength(1);
    expect(writeProviderCall).toHaveBeenCalledOnce();
    expect(writeProviderCall.mock.calls[0]![0]).toMatchObject({ taskId: task.id, time: start.callTime, role: start.role, attempt: start.attempt, request: { _diagnostics: { attemptId: start.attemptId } }, error: null });
  });
  it("records each provider call with the task it ran for", async () => {
    const writeProviderCall = vi.fn<(record: ProviderCallRecord) => void>();
    let recordCall: ((call: GeminiCall) => void) | undefined;
    const call = { time: "2026-10-02T03:16:00.000Z", endpoint: "https://models.example", role: "description", model: "gemini-3.8-flash", attempt: 1, durationMs: 5, request: { model: "gemini-3.8-flash", contents: [] }, response: null, error: null } satisfies GeminiCall;
    const describeImage = vi.fn(async () => {
      recordCall!(call);
      return "A harbor";
    });
    const { session, task } = await arrange({ describeImage, suggestSlugs: vi.fn(async () => ["a-harbor"]) }, { writeProviderCall }, (fn) => { recordCall = fn; });
    await session.runVision(task.id, { mode: "description" });
    expect(writeProviderCall).toHaveBeenCalledWith({ ...call, taskId: task.id, provider: "gemini" });
  });
});

describe("VisionQueue with a locked records store", () => {
  it("finishes a description while the store is held and stays successful, the call recorded once the writer can", async () => {
    const recordsPath = path.join(tempDir, "records.sqlite3");
    const sessionStart = new Date("2026-10-09T05:00:00.000Z");
    openRecordsDatabase(recordsPath).close();
    const held = new DatabaseSync(recordsPath);
    held.exec("BEGIN EXCLUSIVE");
    const writer = startStoreWriter({
      recordsPath, backupsPath: path.join(tempDir, "backups.sqlite3"), fallbackPath: fallbackFile(path.join(tempDir, "logs"), sessionStart),
      session: sessionStart.toISOString(), onWarning: () => {}
    });
    try {
      let recordCall: ((call: GeminiCall) => void) | undefined;
      const call = { time: "2026-10-09T05:00:01.000Z", endpoint: "https://models.example", role: "description", model: "gemini-3.8-flash", attempt: 1, durationMs: 5, request: { model: "gemini-3.8-flash", contents: [] }, response: null, error: null } satisfies GeminiCall;
      const { session, task } = await arrange(
        { describeImage: async () => { recordCall!(call); return "A harbor"; }, suggestSlugs: vi.fn(async () => ["a-harbor"]) },
        createRecordsStore(writer, sessionStart),
        (fn) => { recordCall = fn; }
      );

      // The store is still held when the description finishes.
      await session.runVision(task.id, { mode: "description" });
      expect(task.error).toBeNull();
      expect(task.output?.vision?.description).toBe("A harbor");
    } finally {
      held.exec("ROLLBACK");
      held.close();
      await writer.close({ drain: true });
    }
    const check = new DatabaseSync(recordsPath);
    const fallback = await fs.readFile(fallbackFile(path.join(tempDir, "logs"), sessionStart), "utf8").catch(() => "");
    const stored = check.prepare("SELECT count(*) AS n FROM provider_calls").get() as { n: number };
    check.close();
    expect(stored.n + (fallback.includes('"message":"provider call"') ? 1 : 0)).toBe(1);
  });
});

describe("VisionQueue description request", () => {
  it("sends the description role's chosen Thinking and image resolution to Gemini", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A harbor." }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const settings = defaultGlobalSettings();
    settings["gemini.description"] = "gemini-3.8-flash";
    settings["gemini.thinking.description"] = "high";
    settings["gemini.mediaResolution.description"] = "low";
    expect(defaultThinkingFor("gemini", "gemini-3.8-flash")).not.toBe("high");
    expect(defaultMediaResolutionFor("gemini", "gemini-3.8-flash")).not.toBe("low");
    const provider = new GeminiVisionProvider("test-key", "https://models.example", () => {});
    const { session, task } = await arrange({ describeImage: (request, opts) => provider.describeImage(request, opts), suggestSlugs: vi.fn() }, undefined, undefined, settings);

    await session.runVision(task.id, { mode: "description" });

    expect(task.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
    expect(body.contents[0].parts[0].mediaResolution).toEqual({ level: "MEDIA_RESOLUTION_LOW" });
  });
});

describe("VisionQueue requests after a relaunch", () => {
  it("sends each role's selected model's own default Thinking and image resolution when the file holds none", async () => {
    vi.stubEnv("FOTOREADY_DATA_DIR", tempDir);
    const settingsPath = path.join(tempDir, "config.json");
    // Each role selects the other tier, so the selected model's default differs from the role's built-in.
    const chosen = {
      "gemini.description": "gemini-3.5-flash-lite",
      "gemini.thinking.description": defaultThinkingFor("gemini", "gemini-3.5-flash-lite"),
      "gemini.mediaResolution.description": defaultMediaResolutionFor("gemini", "gemini-3.5-flash-lite"),
      "gemini.slug": "gemini-3.8-flash",
      "gemini.thinking.slug": defaultThinkingFor("gemini", "gemini-3.8-flash")
    };
    expect(chosen["gemini.thinking.description"]).not.toBe(defaultGlobalSettings()["gemini.thinking.description"]);
    expect(chosen["gemini.thinking.slug"]).not.toBe(defaultGlobalSettings()["gemini.thinking.slug"]);
    try {
      const { settings: previous, file } = await loadSettings(settingsPath);
      await saveSettings(file, { ...previous, ...chosen }, previous);
      expect(JSON.parse(await fs.readFile(settingsPath, "utf8"))).toEqual({ formatVersion: 1, "gemini.description": "gemini-3.5-flash-lite", "gemini.slug": "gemini-3.8-flash" });

      const settings = (await loadSettings(settingsPath)).settings;
      expect(settings).toMatchObject(chosen);

      const replies = [{ text: "A harbor." }, { text: JSON.stringify({ slugs: ["a-harbor"] }) }];
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [replies.shift()!] } }] })));
      vi.stubGlobal("fetch", fetchMock);
      const provider = new GeminiVisionProvider("test-key", "https://models.example", () => {});
      const { session, task } = await arrange({
        describeImage: (request, opts) => provider.describeImage(request, opts),
        suggestSlugs: (description, opts) => provider.suggestSlugs(description, opts)
      }, undefined, undefined, settings);

      await session.runVision(task.id, { mode: "description-and-slug" });

      expect(task.error).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [description, slug] = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]!.body)));
      expect(description.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
      expect(description.contents[0].parts[0].mediaResolution).toEqual({ level: "MEDIA_RESOLUTION_HIGH" });
      expect(slug.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM" });
    } finally {
    }
  });
});

describe("VisionQueue result ownership", () => {
  it("cancels retry backoff during shutdown without a task error", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: { message: "Try later" } }), { status: 503, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const recorded = deferred<void>();
    let provider!: GeminiVisionProvider;
    const { session, task, queue } = await arrange({ describeImage: (request, options) => provider.describeImage(request, options), suggestSlugs: vi.fn() }, undefined,
      (recordCall, lifecycle) => { provider = new GeminiVisionProvider("test-key", "https://models.example", (call) => { recordCall(call); recorded.resolve(); }, lifecycle); });
    const run = session.runVision(task.id, { mode: "description" });
    await recorded.promise;
    // Close through the queue's real controller once the failed attempt is recorded.
    await queue.shutdown();
    await run;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(task.error).toBeNull();
    expect(task.visionRunning).toBe(false);
  });
  it("stops after a deferred API key lookup when shutdown starts", async () => {
    const key = deferred<string>();
    const entered = deferred<void>();
    const lookup = vi.spyOn(ApiKeyStore.prototype, "resolve").mockImplementation(async () => { entered.resolve(); return key.promise; });
    try {
      const describeImage = vi.fn(async () => "A harbor");
      const prepare = vi.fn(async () => ({ bytes: Buffer.from("image"), width: 4, height: 3 }));
      const { session, task, queue } = await arrange({ describeImage, suggestSlugs: vi.fn() }, undefined, undefined, undefined, prepare);
      const run = session.runVision(task.id, { mode: "description" });
      await entered.promise;
      const shutdown = queue.shutdown();
      key.resolve("test-key");
      await Promise.all([run, shutdown]);
      expect(prepare).not.toHaveBeenCalled();
      expect(describeImage).not.toHaveBeenCalled();
      expect(task.error).toBeNull();
      expect(task.visionRunning).toBe(false);
    } finally { lookup.mockRestore(); }
  });

  it("owns deferred image preparation until settlement and skips its provider call on shutdown", async () => {
    const preparation = deferred<{ bytes: Buffer; width: number; height: number }>();
    const entered = deferred<void>();
    const describeImage = vi.fn(async () => "A harbor");
    const { session, task, queue } = await arrange({ describeImage, suggestSlugs: vi.fn() }, undefined, undefined, undefined, () => { entered.resolve(); return preparation.promise; });
    const run = session.runVision(task.id, { mode: "description" });
    await entered.promise;
    let closed = false;
    const shutdown = queue.shutdown().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(task.visionRunning).toBe(true);
    preparation.resolve({ bytes: Buffer.from("image"), width: 4, height: 3 });
    await Promise.all([run, shutdown]);
    expect(describeImage).not.toHaveBeenCalled();
    expect(task.error).toBeNull();
    expect(task.visionRunning).toBe(false);
  });

  it("commits an issued description after shutdown while skipping the unsent slug", async () => {
    const description = deferred<string>();
    const entered = deferred<void>();
    const suggestSlugs = vi.fn(async () => ["a-harbor"]);
    const { session, task, queue } = await arrange({ describeImage: () => { entered.resolve(); return description.promise; }, suggestSlugs });
    const run = session.runVision(task.id, { mode: "description-and-slug" });
    await entered.promise;
    let closed = false;
    const shutdown = queue.shutdown().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(task.visionRunning).toBe(true);
    description.resolve("A harbor");
    await Promise.all([run, shutdown]);
    expect(suggestSlugs).not.toHaveBeenCalled();
    expect(task.output?.vision).toMatchObject({ description: "A harbor", slugCandidates: [] });
    expect(mocks.writeTaskSidecarFile).toHaveBeenCalledOnce();
    expect(task.error).toBeNull();
    expect(task.visionRunning).toBe(false);
  });

  it("keeps a committed description when shutdown begins during its commit", async () => {
    const commitWait = deferred<string>();
    const committing = deferred<void>();
    mocks.writeTaskSidecarFile.mockImplementationOnce(() => { committing.resolve(); return commitWait.promise; });
    const suggestSlugs = vi.fn(async () => ["a-harbor"]);
    const { session, task, queue } = await arrange({ describeImage: async () => "A harbor", suggestSlugs });
    const run = session.runVision(task.id, { mode: "description-and-slug" });
    await committing.promise;
    const shutdown = queue.shutdown();
    commitWait.resolve("sidecar");
    await Promise.all([run, shutdown]);
    expect(suggestSlugs).not.toHaveBeenCalled();
    expect(task.output?.vision?.description).toBe("A harbor");
    expect(task.error).toBeNull();
  });
  it("uses one model per role and records the actual model that produced each result", async () => {
    const describeImage = vi.fn(async () => "A harbor");
    const suggestSlugs = vi.fn(async () => ["a-harbor"]);
    const { session, task } = await arrange({ describeImage, suggestSlugs });
    await session.runVision(task.id, { mode: "description-and-slug" });
    expect(describeImage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ model: "gemini-3.8-flash" }));
    expect(suggestSlugs).toHaveBeenCalledWith("A harbor", expect.objectContaining({ model: "gemini-3.5-flash-lite" }));
    expect(task.output?.vision).toMatchObject({ model: "gemini-3.8-flash", slugModel: "gemini-3.5-flash-lite" });
    await session.runVision(task.id, { mode: "slug" });
    expect(task.output?.vision?.model).toBe("gemini-3.8-flash");
  });

  it("keeps a slug the user typed while the run was in flight", async () => {
    const describe = deferred<string>();
    const describing = deferred<void>();
    const { session, task } = await arrange({ describeImage: () => { describing.resolve(); return describe.promise; }, suggestSlugs: async () => ["ai-slug"] });

    const run = session.runVision(task.id, { mode: "description-and-slug" });
    await describing.promise;
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
    const describing = deferred<void>();
    const { session, task } = await arrange({ describeImage: () => { describing.resolve(); return describe.promise; }, suggestSlugs: async () => ["old-slug"] });

    const run = session.runVision(task.id, { mode: "description-and-slug" });
    await describing.promise;
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
    const entered = [deferred<void>(), deferred<void>()];
    let active = 0;
    let maxActive = 0;
    const { session, task } = await arrange({
      describeImage: async () => {
        entered[2 - calls.length]!.resolve();
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
    await entered[0]!.promise;
    const runB = session.runVision(task.id, { mode: "description" });
    first.resolve("first");
    await runA;

    expect(task.visionRunning).toBe(true);
    await expect(session.deleteSavedOutput(task.id)).rejects.toThrow(/being analyzed/);

    await entered[1]!.promise;
    second.resolve("second");
    await runB;

    expect(task.visionRunning).toBe(false);
    expect(task.visionRunMode).toBeNull();
    expect(task.output?.vision?.description).toBe("second");
    expect(maxActive).toBe(1);
  });
});

describe("VisionQueue run times", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records when each step finished, and a step a run skips keeps its own time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    let describedAt = "2026-10-05T01:00:00.000Z";
    let sluggedAt = "2026-10-05T01:00:05.000Z";
    const { session, task } = await arrange({
      describeImage: async () => {
        at(describedAt);
        return "A harbor";
      },
      suggestSlugs: async () => {
        at(sluggedAt);
        return ["a-harbor"];
      }
    });

    await session.runVision(task.id, { mode: "description-and-slug" });
    expect(task.output?.vision).toMatchObject({ ranAt: "2026-10-05T01:00:00.000Z", slugRanAt: "2026-10-05T01:00:05.000Z" });

    sluggedAt = "2026-10-05T02:00:00.000Z";
    await session.runVision(task.id, { mode: "slug" });
    expect(task.output?.vision).toMatchObject({
      description: "A harbor",
      model: "gemini-3.8-flash",
      ranAt: "2026-10-05T01:00:00.000Z",
      slugModel: "gemini-3.5-flash-lite",
      slugRanAt: "2026-10-05T02:00:00.000Z"
    });

    describedAt = "2026-10-05T03:00:00.000Z";
    await session.runVision(task.id, { mode: "description" });
    expect(task.output?.vision).toMatchObject({
      ranAt: "2026-10-05T03:00:00.000Z",
      slugCandidates: ["a-harbor"],
      slugModel: "gemini-3.5-flash-lite",
      slugRanAt: "2026-10-05T02:00:00.000Z"
    });
  });

  it("records no slug time for a description-only run", async () => {
    const { session, task } = await arrange({ describeImage: async () => "A harbor", suggestSlugs: async () => ["unused"] });

    await session.runVision(task.id, { mode: "description" });

    expect(task.output?.vision?.slugCandidates).toEqual([]);
    expect(task.output?.vision).not.toHaveProperty("slugModel");
    expect(task.output?.vision).not.toHaveProperty("slugRanAt");
  });
});

describe("VisionQueue status times", () => {
  it("leaves the task's modified time while a run starts, settles or fails", async () => {
    const { session, task } = await arrange({
      describeImage: async () => {
        throw new Error("describe failed");
      },
      suggestSlugs: async () => []
    });
    const before = task.updatedAt;

    await session.runVision(task.id, { mode: "description" });

    expect(task.error).toMatchObject({ stage: "vision" });
    expect(task.visionRunning).toBe(false);
    expect(task.updatedAt).toBe(before);
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

async function arrange(
  provider: VisionProvider,
  records?: { writeProviderCall(record: ProviderCallRecord): void },
  onProvider?: (recordCall: (call: GeminiCall) => void, recordLifecycle: (event: GeminiCallLifecycle) => void) => void,
  settings: GlobalSettings = defaultGlobalSettings(),
  prepareInput: VisionQueueDeps["prepareInput"] = async () => ({ bytes: Buffer.from("image"), width: 4, height: 3 }),
  logger?: AppLogger
): Promise<{ session: ProjectSession; task: Task; queue: VisionQueue }> {
  const queue = new VisionQueue({ apiKeysPath: path.join(tempDir, "api-keys.json") } as AppPaths, settings, logger, records, {
    createProvider: (_apiKey, _endpoint, recordCall, recordLifecycle) => {
      onProvider?.(recordCall, recordLifecycle);
      return provider;
    },
    prepareInput
  });
  await queue.setGeminiApiKey("test-key");
  const session = new ProjectSession(settings, queue, { snapshot: queueSnapshotFromProject } as never, null as never, "resources/stamps");
  const project = session.snapshot().project;
  const task = savedTask();
  project.originals.push(original());
  project.tasks.push(task);
  return { session, task, queue };
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
