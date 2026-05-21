import { BrowserWindow, app, ipcMain, powerMonitor } from "electron";
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
  installCloseGuard(win);

  win.once("ready-to-show", () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  logger.info({ mod: "main.bootstrap", dataDir: paths.dataDir }, "app started");

  app.once("will-quit", () => {
    void pipelineWorkerPool.destroy();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void bootstrap();
  });
}

function installCloseGuard(win: BrowserWindow): void {
  let closeAllowed = false;
  let closeRequestPending = false;
  let closeRequestMode: "window" | "quit" = "window";
  let systemShutdown = false;

  const markSystemShutdown = () => {
    systemShutdown = true;
    closeAllowed = true;
  };

  powerMonitor.once("shutdown", markSystemShutdown);
  win.once("query-session-end", markSystemShutdown);
  win.once("session-end", markSystemShutdown);

  function requestClose(mode: "window" | "quit"): void {
    if (win.webContents.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    if (closeRequestPending) return;
    closeRequestPending = true;
    closeRequestMode = mode;
    win.webContents.send("lifecycle.close-requested", { mode });
  }

  win.on("close", (event) => {
    if (closeAllowed || systemShutdown) return;
    event.preventDefault();
    requestClose("window");
  });

  const beforeQuitHandler = (event: Electron.Event) => {
    if (closeAllowed || systemShutdown) return;
    event.preventDefault();
    requestClose("quit");
  };
  app.on("before-quit", beforeQuitHandler);

  ipcMain.handle("lifecycle.approveClose", (event, allow: boolean) => {
    if (BrowserWindow.fromWebContents(event.sender) !== win) return;
    closeRequestPending = false;
    if (!allow) return;
    closeAllowed = true;
    if (closeRequestMode === "quit") {
      app.quit();
      return;
    }
    win.close();
  });

  win.once("closed", () => {
    app.off("before-quit", beforeQuitHandler);
    powerMonitor.off("shutdown", markSystemShutdown);
    win.off("query-session-end", markSystemShutdown);
    win.off("session-end", markSystemShutdown);
    ipcMain.removeHandler("lifecycle.approveClose");
  });
}
