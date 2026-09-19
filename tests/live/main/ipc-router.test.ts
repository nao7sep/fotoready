// The save and vision paths end to end, driven through the real IPC handlers the
// renderer calls, with nothing substituted but Electron's window glue: the
// pipeline worker as the build ships it, the real ExifTool, and the real Gemini
// API. Run only by npm run test:full, through vitest.live.config.ts.
//
// Vitest runs the main process from src/, but the worker pool loads its worker
// from the built bundle beside it, so the lane builds the app into its cache
// first and points the pool there; that location is the only change. Each test
// starts the app on its own throwaway home and saves copies of corpus photos.

import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { build } from "electron-vite";
import { exiftool } from "exiftool-vendored";
import type Piscina from "piscina";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ProjectSessionSnapshot } from "@main/session";
import type { TaskSidecar } from "@shared/task-sidecar";
import type { OriginalImportResult } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CACHE = join(REPO, "node_modules", ".cache", "fotoready-live");
const BUILD = join(CACHE, "out");
const CORPUS = join(REPO, "..", "company", "assets", "test-fixtures");
const RICH_METADATA = "metadata/image/jpeg-metadata-rich.jpg";
const CAT_PHOTO = "photos/similarity/apartment-cat/reference.jpg";
const SAVE_TIMEOUT_MS = 2 * 60_000;
const VISION_TIMEOUT_MS = 5 * 60_000;

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>());
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, async (...args) => fn({}, ...args));
    },
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  app: { getVersion: () => "0.0.0-live", getPath: () => "/tmp", isPackaged: false },
  shell: {},
  dialog: {},
  nativeTheme: { on: () => {}, themeSource: "system", shouldUseDarkColors: false },
  screen: {},
}));

const pools = vi.hoisted(() => [] as Piscina[]);
vi.mock("piscina", async (importOriginal) => {
  const { default: RealPiscina } = await importOriginal<typeof import("piscina")>();
  const { join: joinPath } = await import("node:path");
  const { fileURLToPath: toPath } = await import("node:url");
  const worker = joinPath(
    toPath(new URL("../../../", import.meta.url)),
    "node_modules/.cache/fotoready-live/out/main/workers/pipeline-worker.js",
  );
  class BuiltWorkerPiscina extends RealPiscina {
    constructor(options: ConstructorParameters<typeof RealPiscina>[0]) {
      super({ ...options, filename: worker });
      pools.push(this);
    }
  }
  return { default: BuiltWorkerPiscina };
});

type App = Awaited<ReturnType<typeof startApp>>;

/** Starts the main process on `home` the way src/main/bootstrap.ts does, minus the window. */
async function startApp(home: string) {
  process.env.FOTOREADY_HOME = home;
  handlers.clear();
  const { getAppPaths } = await import("@main/paths");
  const { createLogger } = await import("@main/logger");
  const { loadSettings, resolveWorkerPoolSize } = await import("@main/settings-io");
  const { createStateCoordinator, loadState } = await import("@main/state-io");
  const { registerIpcHandlers } = await import("@main/ipc-router");
  const { closeBackupStore, setBackupLogger } = await import("@main/backup-store");
  const { ProjectSession } = await import("@main/session");
  const { VisionQueue } = await import("@main/queues/vision");
  const { ProcessingQueue } = await import("@main/queues/processing-queue");
  const { PipelineWorkerPool } = await import("@main/workers/pipeline-pool");

  const paths = getAppPaths();
  const logger = createLogger(paths.logsDir, { debug: false });
  setBackupLogger(logger);
  const { settings } = await loadSettings(paths.settingsPath, logger);
  const uiState = await loadState(paths.statePath, logger);
  const stateCoordinator = createStateCoordinator(paths.statePath, uiState);
  const visionQueue = new VisionQueue(paths, settings, logger);
  const workerPoolSize = resolveWorkerPoolSize(settings.workerPoolSize);
  const pipelineWorkerPool = new PipelineWorkerPool(workerPoolSize);
  const processingQueue = new ProcessingQueue(workerPoolSize, settings, pipelineWorkerPool, logger);
  const projectSession = new ProjectSession(settings, visionQueue, processingQueue, pipelineWorkerPool, logger);
  processingQueue.setUpdateListener(() => projectSession.emitSnapshot());
  processingQueue.setAfterTaskProcessed((taskId) => projectSession.afterTaskProcessed(taskId));
  registerIpcHandlers({ paths, settings, uiState, stateCoordinator, projectSession, logger, version: "0.0.0-live" });

  const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No IPC handler for ${channel}`);
    return handler(...args) as Promise<T>;
  };
  return {
    invoke,
    task: async (taskId: string): Promise<Task> => {
      const snapshot = await invoke<ProjectSessionSnapshot>("project.current");
      return snapshot.project.tasks.find((task) => task.id === taskId)!;
    },
    /** The close guard's flush and the will-quit handler, then what process exit would close. */
    shutdown: async () => {
      await stateCoordinator.flush();
      await pipelineWorkerPool.destroy();
      closeBackupStore();
      logger.close();
    },
  };
}

/** Runs `body` against the app on `home`, then shuts it down and proves its worker threads are gone. */
async function withApp<T>(home: string, body: (app: App) => Promise<T>): Promise<T> {
  const app = await startApp(home);
  let result: T;
  try {
    result = await body(app);
  } finally {
    await app.shutdown();
  }
  for (const pool of pools) expect(pool.threads, "no pipeline worker outlives the app").toHaveLength(0);
  return result;
}

async function freshHome(label: string): Promise<string> {
  return mkdtemp(join(CACHE, `${label}-`));
}

/** Copies a corpus photo into the home and adds it through the IPC path a drop takes. */
async function addCorpusPhoto(app: App, home: string, relative: string): Promise<Task> {
  const sources = join(home, "sources");
  await mkdir(sources, { recursive: true });
  const copy = join(sources, basename(relative));
  await copyFile(join(CORPUS, relative), copy).catch(() => {
    throw new Error(
      `The live lane reads the shared test-fixture corpus at ${CORPUS}; check out the company repository beside this one.`,
    );
  });
  const result = await app.invoke<OriginalImportResult>("project.addOriginals", [copy]);
  expect(result.issues).toEqual([]);
  expect(result.addedOriginals).toBe(1);
  const snapshot = result.snapshot;
  return snapshot.project.tasks.find((task) => task.id === snapshot.activeTaskId)!;
}

async function lastOpId(app: App, taskId: string): Promise<string> {
  return (await app.task(taskId)).pipeline.ops.at(-1)!.id;
}

async function addOp(app: App, taskId: string, type: string, params: Record<string, unknown>): Promise<void> {
  await app.invoke("task.addOp", taskId, type);
  await app.invoke("task.updateOpParams", taskId, await lastOpId(app, taskId), params);
}

/** Polls the task until `done` holds, failing on an error or the deadline. */
async function waitForTask(app: App, taskId: string, timeoutMs: number, done: (task: Task) => boolean): Promise<Task> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = await app.task(taskId);
    if (task.error) throw new Error(`The task failed at ${task.error.stage}: ${task.error.message}`);
    if (done(task)) return task;
    if (Date.now() > deadline) {
      await app.invoke("task.cancel", taskId);
      throw new Error(`The task was still ${task.status} after ${timeoutMs} ms.`);
    }
    await delay(100);
  }
}

const exiftoolPids = new Set<number>();

beforeAll(async () => {
  await mkdir(CACHE, { recursive: true });
  await build({ root: REPO, build: { outDir: BUILD }, logLevel: "error" });
});

afterAll(async () => {
  // The app leaves ExifTool running until its process exits; this test's process
  // outlives each app, so it ends ExifTool here and proves every child it ran died.
  for (const pid of exiftool.pids) exiftoolPids.add(pid);
  await exiftool.end();
  const deadline = Date.now() + 2_000;
  let alive = [...exiftoolPids].filter(isRunning);
  while (alive.length > 0 && Date.now() < deadline) {
    await delay(20);
    alive = alive.filter(isRunning);
  }
  expect(alive, "no ExifTool process outlives the lane").toEqual([]);
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("the live save and vision paths", () => {
  it("saves a corpus photo through the built worker and writes its metadata policy with ExifTool", async () => {
    const home = await freshHome("save");
    try {
      await withApp(home, async (app) => {
        const task = await addCorpusPhoto(app, home, RICH_METADATA);
        const snapshot = await app.invoke<ProjectSessionSnapshot>("project.current");
        const original = snapshot.project.originals.find((item) => item.id === task.originalId)!;
        expect(original.metadataSummary.editorial.author).toBe("Synthetic Fixture Generator");
        // ExifTool joins the fixture's OffsetTimeOriginal to its DateTimeOriginal.
        expect(original.metadataSummary.dates.Captured).toBe("2024:02:29 23:59:58+09:00");
        expect(Object.keys(original.metadataSummary.gps)).toContain("Latitude");

        await app.invoke("task.setGenerateSlug", task.id, false);
        await app.invoke("task.setGenerateDescription", task.id, false);
        await addOp(app, task.id, "resize", { mode: "fit", width: 320, height: 320 });
        await addOp(app, task.id, "lut", { cubePath: join(REPO, "resources", "luts", "aged-sepia.cube"), strength: 0.5 });
        await addOp(app, task.id, "strip-metadata", { keep: ["editorial", "dates"] });
        await addOp(app, task.id, "inject-metadata", { fields: { credit: "FotoReady live lane" } });
        await app.invoke("task.updateOutput", task.id, "format", "webp");
        for (const pid of exiftool.pids) exiftoolPids.add(pid);

        await app.invoke("task.save", task.id);
        const saved = await waitForTask(app, task.id, SAVE_TIMEOUT_MS, (current) => current.status === "saved");
        for (const pid of exiftool.pids) exiftoolPids.add(pid);
        const output = saved.output!;
        expect(output.stagedPath.endsWith(".webp")).toBe(true);

        const image = await sharp(output.stagedPath).metadata();
        expect(image).toMatchObject({ format: "webp", width: 320, height: 240 });

        const tags = (await exiftool.read(output.stagedPath)) as Record<string, unknown>;
        expect(tags.Artist).toBe("Synthetic Fixture Generator");
        expect(tags.Copyright).toBe("Fictional test data only");
        // The capture date and its offset both survive.
        expect(String((tags.DateTimeOriginal as { rawValue?: string } | undefined)?.rawValue)).toBe("2024:02:29 23:59:58+09:00");
        expect(tags.Credit).toBe("FotoReady live lane");
        expect(tags.Software).toBe("FotoReady");
        expect(tags.GPSLatitude, "GPS is stripped").toBeUndefined();
        expect(tags.GPSLongitude, "GPS is stripped").toBeUndefined();

        const sidecar = JSON.parse(await readFile(output.stagedParamsPath!, "utf8")) as TaskSidecar;
        expect(sidecar.task.pipeline.ops.map((op) => op.type)).toEqual(["resize", "lut", "strip-metadata", "inject-metadata"]);
        expect((await stat(output.stagedPath)).size).toBeGreaterThan(0);
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("describes and names a saved photo through the real Gemini API", async () => {
    if (!process.env.GEMINI_API_KEY?.trim()) {
      throw new Error("GEMINI_API_KEY is not set. The full run calls the real Gemini API; export GEMINI_API_KEY and run it again.");
    }
    const { normalizeSlugCandidate } = await import("@core/slug/rules");
    const home = await freshHome("vision");
    try {
      await withApp(home, async (app) => {
        const task = await addCorpusPhoto(app, home, CAT_PHOTO);
        expect(task.generateDescription && task.generateSlug, "new tasks generate both by default").toBe(true);

        await app.invoke("task.save", task.id);
        await waitForTask(app, task.id, SAVE_TIMEOUT_MS, (current) => current.status === "saved");
        for (const pid of exiftool.pids) exiftoolPids.add(pid);
        const described = await waitForTask(
          app,
          task.id,
          VISION_TIMEOUT_MS,
          (current) => !current.visionRunning && (current.output?.vision?.slugCandidates.length ?? 0) > 0,
        );

        const vision = described.output!.vision!;
        expect(vision.description, "the photo's subject is a cat").toMatch(/\bcats?\b/i);
        for (const slug of vision.slugCandidates) {
          expect(slug.length).toBeGreaterThan(0);
          expect(slug).toBe(normalizeSlugCandidate(slug));
        }

        const sidecar = JSON.parse(await readFile(described.output!.stagedParamsPath!, "utf8")) as TaskSidecar;
        expect(sidecar.task.vision?.description).toBe(vision.description);
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
