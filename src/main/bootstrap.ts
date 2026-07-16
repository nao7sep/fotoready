import { BrowserWindow, app, ipcMain, nativeTheme, powerMonitor, screen } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAppPaths } from "./paths";
import { createLogger, installCrashHandlers, type AppLogger } from "./logger";
import { loadSettings, resolveWorkerPoolSize } from "./settings-io";
import { loadState, saveState } from "./state-io";
import { registerIpcHandlers } from "./ipc-router";
import { setBackupLogger } from "./backup-store";
import { ProjectSession } from "./session";
import { VisionQueue } from "./queues/vision";
import { ProcessingQueue } from "./queues/processing-queue";
import { PipelineWorkerPool } from "./workers/pipeline-pool";
import { APP_NAME } from "@shared/constants";
import {
  clampWindowSizeToWorkArea,
  computeFirstRunWindowHeight,
  computeFirstRunWindowWidth,
  computeMinWindowHeight,
  computeMinWindowWidth
} from "@shared/layout/workspace-metrics";

// FotoReady is a light app. Two settings keep the native window chrome from fighting the UI on a
// dark-mode host (per window-chrome-conventions): force the title bar to the light theme, and paint
// the window background the app background so the first frame and any letterboxing match the UI
// instead of flashing the OS default. The minimum size is derived from the pane minimums plus the
// fixed chrome — never a hand-typed literal (see @shared/layout/workspace-metrics).
const APP_BACKGROUND_COLOR = "#f5f5f4";

// Pure so it can be unit-tested without constructing a real BrowserWindow: given the preload path,
// the display's work-area size, and the remembered window size (null on first run), it returns the
// exact constructor options. The opening size is the remembered size clamped to the current screen,
// or — first run — the derived first-run size; either way clamped so the window always fits. The theme
// is set separately (nativeTheme is a global side effect), asserted in the same test.
export function buildWindowOptions(
  preloadPath: string,
  workArea: { width: number; height: number },
  savedSize: { width: number; height: number } | null
): BrowserWindowConstructorOptions {
  const requested = savedSize ?? { width: computeFirstRunWindowWidth(), height: computeFirstRunWindowHeight() };
  const size = clampWindowSizeToWorkArea(requested, workArea);
  return {
    title: APP_NAME,
    minWidth: computeMinWindowWidth(),
    minHeight: computeMinWindowHeight(),
    width: size.width,
    height: size.height,
    backgroundColor: APP_BACKGROUND_COLOR,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };
}

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
  // Wire the session logger into the write-through data-backup store BEFORE any managed save, so the
  // store's one best-effort warn (a failed record, an unopenable store) reaches this launch's log instead
  // of the silent default. Recording itself is a side effect of each managed save (settings-io/state-io);
  // there is no startup backup pass to kick off (data-backup conventions: write-through, not a scan).
  setBackupLogger(logger);
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
      stampFolder: settings.stampFolder
    }
  });

  const exitState: ExitState = { reason: "unknown" };

  // One launch = one log file. The work above is one-time process init; only the
  // window is (re)created below, so it must never be redone on re-activate.
  app.once("will-quit", () => {
    logger.info("app stopping", { mod: "main", reason: exitState.reason });
    void pipelineWorkerPool.destroy();
  });

  // A light app must not inherit a dark native title bar on a dark-mode host. Force the light theme
  // once at startup so the bar matches the app on every platform.
  nativeTheme.themeSource = "light";

  const createWindow = (): void => {
    // Open at the remembered size (clamped to this display), or the first-run size. Reading the size
    // here in main — not in the renderer — is why the pane widths and window size live in state.json.
    const { workAreaSize } = screen.getPrimaryDisplay();
    const win = new BrowserWindow(
      buildWindowOptions(path.join(__dirname, "../preload/index.mjs"), workAreaSize, uiState.windowSize)
    );
    installCloseGuard(win, exitState);

    // Remember the window's size (only size, never position — a monitor change can't strand it
    // off-screen). Debounced on resize so a drag writes state.json once it settles; flushed on close so
    // a resize-then-quit is not lost. uiState is the same object the IPC router holds, so writing it
    // here keeps a single source. The saved size is re-clamped to the screen on the next launch.
    let sizeSaveTimer: ReturnType<typeof setTimeout> | null = null;
    const persistWindowSize = (): void => {
      const [width, height] = win.getSize();
      uiState.windowSize = { width, height };
      void saveState(paths.statePath, uiState);
    };
    win.on("resize", () => {
      if (sizeSaveTimer) clearTimeout(sizeSaveTimer);
      sizeSaveTimer = setTimeout(persistWindowSize, 400);
    });
    win.on("close", () => {
      if (sizeSaveTimer) {
        clearTimeout(sizeSaveTimer);
        sizeSaveTimer = null;
      }
      persistWindowSize();
    });

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
