import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { AppPaths } from "@main/paths";
import type { RouterContext } from "@main/ipc-router";
import type { Task } from "@shared/types/project";

// Deferred native boundaries prove lifetime accounting through the production stop function;
// they do not prove Electron/OS teardown behavior on stalled storage.
const boundary = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  listeners: new Map<string, (event: { preventDefault(): void }) => void>(),
  exits: 0,
  readImage: vi.fn<() => Promise<Buffer>>(),
}));
vi.mock("electron", () => ({
  app: {
    on: (name: string, listener: (event: { preventDefault(): void }) => void) => boundary.listeners.set(name, listener),
    quit: () => {
      for (const name of ["before-quit", "will-quit"]) {
        let prevented = false;
        boundary.listeners.get(name)?.({ preventDefault: () => { prevented = true; } });
        if (prevented) return;
      }
      boundary.exits += 1;
    },
    isPackaged: false,
  },
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => boundary.handlers.set(channel, async (...args) => handler({}, ...args)) },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  nativeTheme: { on() {}, themeSource: "system", shouldUseDarkColors: false },
  powerMonitor: {}, shell: {}, dialog: {}, screen: {},
}));
vi.mock("sharp", () => ({ default: () => ({
  rotate() { return this; }, metadata: async () => ({ width: 4, height: 3 }),
  resize() { return this; }, jpeg() { return this; }, toBuffer: () => boundary.readImage(),
}) }));
const { app } = await import("electron");
const { installQuitShutdown, stopAppWork } = await import("@main/bootstrap");
const { UserWorkWrites, saveUserWorkBeforeQuit } = await import("@main/quit-save");
const { registerIpcHandlers } = await import("@main/ipc-router");
const { VisionQueue } = await import("@main/queues/vision");
const { ProjectSession } = await import("@main/session");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GEMINI_API_KEY", "synthetic-test-key");
  boundary.handlers.clear(); boundary.listeners.clear(); boundary.exits = 0;
  boundary.readImage.mockReset().mockResolvedValue(Buffer.from("jpeg"));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

function owners(prepareInput: () => Promise<{ bytes: Buffer; width: number; height: number }> = async () => ({ bytes: Buffer.from("image"), width: 4, height: 3 })) {
  const settings = defaultGlobalSettings();
  const userWork = new UserWorkWrites();
  const queue = new VisionQueue({ apiKeysPath: "/unused/api-keys.json" } as AppPaths, settings, undefined, undefined, {
    createProvider: () => ({ describeImage: async () => "A photo", suggestSlugs: async () => ["photo"] }), prepareInput,
  });
  const session = new ProjectSession(settings, queue, { shutdown: async () => {} } as never, null as never, "/unused", undefined, userWork);
  const ipcWork = registerIpcHandlers({ settings, projectSession: session, logger, userWork } as unknown as RouterContext);
  const stop = () => stopAppWork({ logger, exitReason: "user-quit", statePath: "/unused/state.json",
    stateCoordinator: { flush: async () => {} }, projectSession: session,
    pipelineWorkerPool: { destroy: async () => {} }, recordsReader: { close: async () => {} },
    storeWriter: { close: async () => true }, userWork, ipcWork, sessionEnding: () => false,
  });
  return { userWork, queue, session, ipcWork, stop };
}
function quitWith(owner: ReturnType<typeof owners>, prepare = async () => true) {
  const forceExit = vi.fn();
  installQuitShutdown({ prepare, approved: owner.ipcWork.closeAdmission, stop: owner.stop,
    answerForSessionEnd() {}, sessionEnded() {},
  }, { forceExit });
  app.quit();
  return forceExit;
}

it("uses force exit when Quit anyway leaves a primary settings write running through the real stop", async () => {
  const owner = owners();
  const write = deferred<void>();
  const running = owner.userWork.run({ kind: "settings" }, () => write.promise);
  const ask = vi.fn(async () => "quit" as const);
  const force = quitWith(owner, async () => {
    owner.userWork.beginQuit();
    return saveUserWorkBeforeQuit(owner.userWork, ask, () => false, logger);
  });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(ask).toHaveBeenCalledOnce();
  expect(force).toHaveBeenCalledOnce();
  expect(boundary.exits).toBe(0);
  write.resolve(); await running;
});

it("keeps an admitted API-key save owned after Quit anyway", async () => {
  const owner = owners();
  const write = deferred<void>();
  vi.spyOn(owner.session, "setGeminiApiKey").mockReturnValue(write.promise);
  const save = boundary.handlers.get("settings.setGeminiApiKey")!("synthetic-key");
  const force = quitWith(owner, () => saveUserWorkBeforeQuit(owner.userWork, async () => "quit", () => false, logger));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(force).toHaveBeenCalledOnce();
  expect(owner.userWork.unsaved().running).toHaveLength(1);
  write.resolve(); await save;
  expect(owner.ipcWork.isIdle()).toBe(true);
});

it("includes a description held at its image-read boundary in session shutdown", async () => {
  const read = deferred<{ bytes: Buffer; width: number; height: number }>();
  const prepare = vi.fn(() => read.promise);
  const owner = owners(prepare);
  const task = { id: "task", originalId: "original", status: "saved", customSlug: null, pipeline: defaultPipeline(),
    output: { stagedPath: "/photo.jpg", stagedParamsPath: "/photo.json", outputHash: "hash", stagedAt: "2026-10-11T00:00:00Z", finalPath: null, finalParamsPath: null, renamedAt: null, vision: null },
  } as Task;
  const project = owner.session.snapshot().project;
  project.tasks.push(task);
  const run = owner.queue.runForTask(project, task.id, { mode: "description" }, async () => false);
  await vi.advanceTimersByTimeAsync(0);
  expect(prepare).toHaveBeenCalledOnce();
  const force = quitWith(owner);
  await vi.advanceTimersByTimeAsync(1_500);
  expect(force).toHaveBeenCalledOnce();
  expect(boundary.exits).toBe(0);
  await owner.queue.runForTask(project, task.id, { mode: "description" }, async () => false);
  expect(prepare).toHaveBeenCalledOnce();
  read.resolve({ bytes: Buffer.from("image"), width: 4, height: 3 }); await run;
});

it("counts a real thumbnail handler until its Sharp read settles and rejects new work only after approval", async () => {
  const owner = owners();
  owner.session.snapshot().project.originals.push({ id: "original", sourcePath: "/photo.jpg", width: 4, height: 3 } as never);
  const read = deferred<Buffer>(); boundary.readImage.mockReturnValue(read.promise);
  const thumbnail = boundary.handlers.get("preview.originalThumbnail")!("original");
  await vi.advanceTimersByTimeAsync(0);
  expect(boundary.readImage).toHaveBeenCalledOnce();
  const force = quitWith(owner);
  await vi.advanceTimersByTimeAsync(0);
  expect(force).toHaveBeenCalledOnce();
  expect(boundary.exits).toBe(0);
  await expect(boundary.handlers.get("preview.originalThumbnail")!("original")).rejects.toThrow("quitting");
  expect(boundary.readImage).toHaveBeenCalledOnce();
  read.resolve(Buffer.from("jpeg")); await thumbnail;
  expect(owner.ipcWork.isIdle()).toBe(true);
});

it("keeps IPC available when preparation is canceled, and permits normal exit after work has settled", async () => {
  const owner = owners();
  const force = quitWith(owner, vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true));
  await vi.advanceTimersByTimeAsync(0);
  await expect(boundary.handlers.get("settings.get")!()).resolves.toBeDefined();
  app.quit(); await vi.advanceTimersByTimeAsync(0);
  expect(boundary.exits).toBe(1);
  expect(force).not.toHaveBeenCalled();
});
