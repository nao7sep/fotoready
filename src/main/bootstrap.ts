import { BrowserWindow, app, ipcMain, powerMonitor } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAppPaths } from "./paths";
import { createLogger, installCrashHandlers, type AppLogger } from "./logger";
import { loadSettings, resolveWorkerPoolSize } from "./settings-io";
import { loadState } from "./state-io";
import { registerIpcHandlers } from "./ipc-router";
import { ProjectSession } from "./session";
import { VisionQueue } from "./queues/vision";
import { ProcessingQueue } from "./queues/processing-queue";
import { PipelineWorkerPool } from "./workers/pipeline-pool";
import { APP_NAME } from "@shared/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared across the app's lifetime (and across windows, since macOS keeps the
// process alive after the last window closes). The close guard records why the
// app is shutting down; the single will-quit handler reads it. "unknown" means
// the app went down without passing through a recognized close path (e.g. an
// external signal) — distinct from a deliberate user quit.
type ExitState = { reason: string };

export async function bootstrap(): Promise<void> {
  await app.whenReady();

  const paths = getAppPaths();
  // Debug is developer-only: on for unpackaged dev builds or an explicit opt-in,
  // off (never written to disk) in packaged release builds.
  const debug = !app.isPackaged || process.env.FOTOREADY_DEBUG === "1";
  const logger = createLogger(paths.logsDir, { debug });
  installCrashHandlers(logger);
  const settings = await loadSettings(paths.settingsPath, logger);
  const uiState = await loadState(paths.statePath, logger);
  const visionQueue = new VisionQueue(paths, settings, logger);
  const workerPoolSize = resolveWorkerPoolSize(settings.workerPoolSize);
  const pipelineWorkerPool = new PipelineWorkerPool(workerPoolSize);
  const processingQueue = new ProcessingQueue(workerPoolSize, settings, pipelineWorkerPool, logger);
  const projectSession = new ProjectSession(settings, visionQueue, processingQueue, pipelineWorkerPool, logger);
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

  logger.info("app started", {
    mod: "main.bootstrap",
    version: app.getVersion(),
    debug,
    dataDir: paths.dataDir,
    config: {
      defaultOutputFormat: settings.defaultOutputFormat,
      model: settings.model,
      workerPoolSize,
      visionConcurrency: settings.visionConcurrency,
      previewLongEdge: settings.previewLongEdge,
      lutFolder: settings.lutFolder,
      stampFolder: settings.stampFolder,
      maximizeOnStartup: settings.maximizeOnStartup
    }
  });

  const exitState: ExitState = { reason: "unknown" };

  // One launch = one log file. The work above is one-time process init; only the
  // window is (re)created below, so it must never be redone on re-activate.
  app.once("will-quit", () => {
    logger.info("app stopping", { mod: "main", reason: exitState.reason });
    void pipelineWorkerPool.destroy();
  });

  const createWindow = (): void => {
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
    installCloseGuard(win, exitState);

    // Defense in depth: the renderer only loads local content and routes every external link through
    // system.openExternal, so it never legitimately opens a window or navigates to another origin.
    // Deny renderer-initiated window creation, and block navigation away from the current origin, so
    // a stray target="_blank" or an injected navigation can't pull a remote page into the app.
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      const current = win.webContents.getURL();
      if (current && !sameOrigin(url, current)) event.preventDefault();
    });

    win.once("ready-to-show", () => {
      if (settings.maximizeOnStartup) win.maximize();
      win.show();
    });

    const loaded = process.env.ELECTRON_RENDERER_URL
      ? win.loadURL(process.env.ELECTRON_RENDERER_URL)
      : win.loadFile(path.join(__dirname, "../renderer/index.html"));
    loaded.catch((error) => logger.error("failed to load the renderer window", { mod: "main", err: error }));
  };

  createWindow();

  // macOS keeps the process running after the window closes; recreate only the
  // window when the user re-activates, never re-run the init above.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// Two URLs share an origin (file: URLs both report origin "null", so same-origin local navigation
// and dev-server HMR reloads are allowed; a cross-origin navigation is not). Malformed input is
// treated as a different origin and therefore blocked.
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function installCloseGuard(win: BrowserWindow, exitState: ExitState): void {
  let closeAllowed = false;
  let closeRequestPending = false;
  let closeRequestMode: "window" | "quit" = "window";
  let systemShutdown = false;

  const markSystemShutdown = () => {
    systemShutdown = true;
    closeAllowed = true;
    exitState.reason = "system-shutdown";
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
    exitState.reason = closeRequestMode === "quit" ? "user-quit" : "window-close";
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
