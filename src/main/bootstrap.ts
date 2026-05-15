import { BrowserWindow, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAppPaths } from "./paths";
import { createLogger } from "./logger";
import { loadSettings, resolveWorkerPoolSize } from "./settings-io";
import { loadState } from "./state-io";
import { registerIpcHandlers } from "./ipc-router";
import { ProjectSession } from "./session";
import { VisionQueue } from "./queues/vision";
import { ProcessingQueue } from "./queues/processing-queue";
import { PipelineWorkerPool } from "./workers/pipeline-pool";
import { APP_NAME } from "@shared/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function bootstrap(): Promise<void> {
  await app.whenReady();

  const paths = getAppPaths();
  const logger = await createLogger(paths.logsDir);
  const settings = await loadSettings(paths.settingsPath);
  const uiState = await loadState(paths.statePath);
  const visionQueue = new VisionQueue(paths, settings);
  const workerPoolSize = resolveWorkerPoolSize(settings.workerPoolSize);
  const pipelineWorkerPool = new PipelineWorkerPool(workerPoolSize);
  const processingQueue = new ProcessingQueue(workerPoolSize, settings, pipelineWorkerPool);
  const projectSession = new ProjectSession(settings, visionQueue, processingQueue, pipelineWorkerPool);
  processingQueue.setUpdateListener(() => projectSession.emitSnapshot());
  processingQueue.setAfterTaskProcessed((taskId) => projectSession.afterTaskProcessed(taskId));

  registerIpcHandlers({
    paths,
    settings,
    uiState,
    projectSession,
    logger,
    version: app.getVersion()
  });

  const win = new BrowserWindow({
    title: APP_NAME,
    minWidth: 1024,
    minHeight: 640,
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once("ready-to-show", () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  logger.info({ mod: "main.bootstrap", dataDir: paths.dataDir }, "app started");

  app.once("before-quit", () => {
    void pipelineWorkerPool.destroy();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void bootstrap();
  });
}
