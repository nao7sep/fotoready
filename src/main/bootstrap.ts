import { BrowserWindow, app, ipcMain, powerMonitor } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAppPaths } from "./paths";
import { createLogger, installCrashHandlers, type AppLogger } from "./logger";
import { openRecordsStore, writeFallbackRecord } from "./records-store";
import { jsonSafe } from "./json-safe";
import { loadSettings, resolveWorkerPoolSize } from "./settings-io";
import { createStateCoordinator, loadState } from "./state-io";
import { registerIpcHandlers } from "./ipc-router";
import { setBackupLogger } from "./backup-store";
import { ProjectSession } from "./session";
import { VisionQueue } from "./queues/vision";
import { ProcessingQueue } from "./queues/processing-queue";
import { PipelineWorkerPool } from "./workers/pipeline-pool";
import { APP_NAME } from "@shared/constants";
import { nowIso } from "@shared/time";
import { notifyStartupFailure, requireCorruptSettingsNotice } from "./startup-dialog";
import { configureWindowActivity } from "./window-activity";
import {
  computeFirstRunWindowHeight,
  computeFirstRunWindowWidth,
  computeMinWindowHeight,
  computeMinWindowWidth
} from "@shared/layout/workspace-metrics";
import { configureWindowMinimum } from "./window-minimum";
import { createWindowWithUsablePersistedBounds } from "./window-state-recovery";
import { applyThemePreference, followOsThemeChanges, windowBackground } from "./theme";
import { applyLanguagePreference, detectComputerLanguage, mainTranslator, setLanguageFailureReporter } from "./i18n";
import { installApplicationMenu } from "./menu";
import { revealWindow } from "./reveal-window";
import { windowCloseQuits } from "./window-close";
import type { CloseRequest } from "@shared/types/ipc";
import { createRecordsReader } from "./records-reader";
import { closeRecordsWindow, notifyRecordsChanged, openRecordsWindow } from "./records-window";

// Pure so it can be unit-tested without constructing a real BrowserWindow. The opening size and
// minimum both come from the shared layout metrics — never hand-typed literals (see
// @shared/layout/workspace-metrics). The window background is the resolved theme's app background,
// so the first frame and any letterboxing match the UI instead of flashing the OS default; the
// theme itself is set separately because nativeTheme is a global side effect.
export function buildWindowOptions(
  preloadPath: string
): BrowserWindowConstructorOptions {
  return {
    name: "main",
    windowStatePersistence: {
      bounds: true,
      displayMode: process.platform === "win32",
    },
    title: APP_NAME,
    minWidth: computeMinWindowWidth(),
    minHeight: computeMinWindowHeight(),
    width: computeFirstRunWindowWidth(),
    height: computeFirstRunWindowHeight(),
    backgroundColor: windowBackground(),
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
// app is shutting down; the quit shutdown reads it. "unknown" means
// the app went down without passing through a recognized close path (e.g. an
// external signal) — distinct from a deliberate user quit.
export type ExitState = { reason: string };

// This launch: the records' session, and the name of the text file a failure before the records
// store opens falls back to.
const sessionStart = new Date();
let sessionLogger: AppLogger | null = null;

/**
 * Records a startup failure: through the logger once it exists, before then in a text file under
 * `logs/`, then on the console (logging-conventions, When logging itself fails). Never throws.
 */
export function recordStartupFailure(message: string, error: unknown): void {
  if (sessionLogger) {
    sessionLogger.error(message, { mod: "main.bootstrap", err: error });
    return;
  }
  const line = { time: nowIso(), level: "error", message, mod: "main.bootstrap", err: jsonSafe(error) };
  let logsDir: string;
  try {
    logsDir = getAppPaths().logsDir;
  } catch (pathError) {
    console.error("[records] the logs folder could not be resolved; writing to the console", pathError);
    console.error(JSON.stringify(line));
    return;
  }
  writeFallbackRecord(logsDir, sessionStart, line, "error");
}

export async function bootstrap(): Promise<void> {
  await app.whenReady();
  // Before anything is drawn, so even a startup failure speaks the computer's language.
  await detectComputerLanguage();

  const paths = getAppPaths();
  // Debug is developer-only: on for unpackaged dev builds or an explicit opt-in,
  // off (never written to disk) in packaged release builds.
  const debug = !app.isPackaged || process.env.FOTOREADY_DEBUG === "1";
  const records = openRecordsStore(paths.recordsPath, paths.logsDir, sessionStart);
  records.onStored(notifyRecordsChanged);
  const recordsReader = createRecordsReader(paths.recordsPath);
  const logger = createLogger(records, { debug });
  sessionLogger = logger;
  installCrashHandlers(logger);
  // Wire the session logger into the write-through data-backup store BEFORE any managed save, so the
  // store's one best-effort warn (a failed record, an unopenable store) reaches this launch's log instead
  // of the silent default. Recording itself is a side effect of each managed save (settings-io/state-io);
  // there is no startup backup pass to kick off (data-backup conventions: write-through, not a scan).
  setBackupLogger(logger);
  const { settings, quarantinedTo: settingsQuarantinedTo } = await loadSettings(paths.settingsPath, logger);
  // The saved theme reaches the title bar, the renderer's prefers-color-scheme, and any recovery
  // dialog before the first window exists, so launch never shows the OS appearance and then switches.
  applyThemePreference(settings.theme);
  followOsThemeChanges();
  // The saved language settles before anything is drawn: the menu bar, the recovery notice below,
  // and the renderer, which asks for it before showing any text.
  setLanguageFailureReporter((message, error) => logger.warn(message, { mod: "main.i18n", err: error }));
  await applyLanguagePreference(settings.language);
  installApplicationMenu(mainTranslator());
  const loadedState = await loadState(paths.statePath, logger);
  const uiState = loadedState.state;
  const stateCoordinator = createStateCoordinator(paths.statePath, loadedState);
  if (settingsQuarantinedTo) {
    await requireCorruptSettingsNotice(logger, settingsQuarantinedTo);
  }
  const visionQueue = new VisionQueue(paths, settings, logger, records);
  const workerPoolSize = resolveWorkerPoolSize(settings.workerPoolSize);
  const pipelineWorkerPool = new PipelineWorkerPool(workerPoolSize);
  const processingQueue = new ProcessingQueue(workerPoolSize, settings, pipelineWorkerPool, logger);
  const projectSession = new ProjectSession(settings, visionQueue, processingQueue, pipelineWorkerPool, paths.bundledStampsDir, logger);
  processingQueue.setUpdateListener(() => projectSession.emitSnapshot());
  processingQueue.setAfterTaskProcessed((taskId) => projectSession.afterTaskProcessed(taskId));

  registerIpcHandlers({
    paths,
    settings,
    uiState,
    stateCoordinator,
    projectSession,
    logger,
    version: __APP_VERSION__,
    records: {
      reader: recordsReader,
      session: records.session,
      openWindow: () => openRecordsWindow({ title: mainTranslator().t("records.title"), logger })
    }
  });

  logger.info("app started", {
    mod: "main.bootstrap",
    version: __APP_VERSION__,
    debug,
    dataDir: paths.dataDir,
    config: {
      defaultOutputFormat: settings.defaultOutputFormat,
      descriptionModel: settings["gemini.description"],
      slugModel: settings["gemini.slug"],
      workerPoolSize,
      visionConcurrency: settings.visionConcurrency,
      previewLongEdge: settings.previewLongEdge,
      lutFolder: settings.lutFolder,
      stampFolder: settings.stampFolder
    }
  });

  const exitState: ExitState = { reason: "unknown" };

  // One launch = one session. The work above is one-time process init; only the
  // window is (re)created below, so it must never be redone on re-activate.
  // Quitting cancels in-flight saves, which remove their unfinished files, and lands the last
  // state write, then closes the workers and the records reader, each stage for at most
  // SHUTDOWN_WAIT_MS.
  installQuitShutdown(async () => {
    logger.info("app stopping", { mod: "main", reason: exitState.reason });
    const finished = await settleWithin(Promise.all([projectSession.shutdown(), stateCoordinator.flush()]), SHUTDOWN_WAIT_MS);
    if (!finished) logger.warn("in-flight work did not stop in time; quitting anyway", { mod: "main", waitMs: SHUTDOWN_WAIT_MS });
    await settleWithin(Promise.all([pipelineWorkerPool.destroy(), recordsReader.close()]), SHUTDOWN_WAIT_MS);
  });

  // The main window, apart from the Records window beside it.
  let mainWindow: BrowserWindow | null = null;

  const createWindow = async (): Promise<void> => {
    const options = buildWindowOptions(path.join(__dirname, "../preload/index.mjs"));
    const win = createWindowWithUsablePersistedBounds("main", () => new BrowserWindow(options));
    mainWindow = win;
    // The Records window belongs to this window's workspace and closes with it, so the app's own
    // window-all-closed and re-activate paths see no window left behind.
    win.once("closed", () => {
      if (mainWindow === win) mainWindow = null;
      closeRecordsWindow();
    });
    configureWindowMinimum(win, () => ({ width: computeMinWindowWidth(), height: computeMinWindowHeight() }),
      (error) => logger.warn("window minimum could not be updated", { mod: "main.window", err: error }));
    configureWindowActivity(app, win);
    installCloseGuard(win, exitState, () => stateCoordinator.flush());

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

    try {
      const rendererUrl = process.env.ELECTRON_RENDERER_URL;
      if (rendererUrl) {
        await win.loadURL(rendererUrl);
      } else {
        await win.loadFile(path.join(__dirname, "../renderer/index.html"));
      }
    } catch (error) {
      logger.error("failed to load the renderer window", { mod: "main", err: error });
      // Keep the failed, never-shown owner alive until the terminal recovery
      // window settles. Destroying the last window here can start ordinary
      // window-all-closed shutdown before that recovery surface is created.
      throw error;
    }
  };

  await createWindow();

  const recreateWindow = (): void => {
    void createWindow().catch(async (error) => {
      logger.error("failed to recreate the renderer window", { mod: "main", err: error });
      try {
        await notifyStartupFailure();
      } catch (dialogError) {
        logger.error("could not show renderer recovery dialog", { mod: "main", err: dialogError });
      } finally {
        app.exit(1);
      }
    });
  };

  // macOS keeps the process running after the window closes; recreate only the
  // window when the user re-activates, never re-run the init above.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length !== 0) return;
    recreateWindow();
  });

  // A second launch exits at once (see index.ts); this instance answers by coming forward.
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
    else recreateWindow();
  });
}

/** How long quitting waits for in-flight saves to stop and clean up before exiting anyway. */
const SHUTDOWN_WAIT_MS = 10_000;

/**
 * Exported for tests. Holds the exit once the windows have closed until `stop` settles, then quits
 * for real. A quit arriving while `stop` runs, such as a second Quit or window-all-closed, is held
 * at before-quit, so only the quit after `stop` ends the process.
 */
export function installQuitShutdown(stop: () => Promise<void>): void {
  let shutdown: "running" | "stopping" | "done" = "running";
  app.on("before-quit", (event) => {
    if (shutdown === "stopping") event.preventDefault();
  });
  app.on("will-quit", (event) => {
    if (shutdown === "done") return;
    event.preventDefault();
    if (shutdown === "stopping") return;
    shutdown = "stopping";
    void stop().finally(() => {
      shutdown = "done";
      app.quit();
    });
  });
}

/** Resolves true when `work` settles within `ms`, false when the wait runs out first. Never rejects. */
async function settleWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([work.then(() => true, () => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
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

/** Exported for tests: the system-shutdown hold is the part worth checking without a real window. */
export function installCloseGuard(win: BrowserWindow, exitState: ExitState, prepareClose: () => Promise<void>): void {
  let closeAllowed = false;
  let closeRequestPending = false;
  let closeRequestMode: "window" | "quit" = "window";
  // Set when the user approves a close, and never cleared: the close is then only landing the last
  // state write, so a further close or quit waits for it instead of asking again.
  let closeApproved = false;
  let systemShutdown = false;

  // Holds the shutdown, where the event allows it, until the last state write has landed, for at
  // most SHUTDOWN_WAIT_MS as quitting does, then quits. Electron passes powerMonitor's shutdown
  // an event its typings omit.
  const markSystemShutdown = (event?: { preventDefault(): void }) => {
    if (systemShutdown) return;
    systemShutdown = true;
    closeAllowed = true;
    exitState.reason = "system-shutdown";
    event?.preventDefault();
    void settleWithin(prepareClose(), SHUTDOWN_WAIT_MS).then(() => app.quit());
  };

  powerMonitor.once("shutdown", markSystemShutdown);
  win.once("query-session-end", markSystemShutdown);
  win.once("session-end", markSystemShutdown);

  function requestClose(mode: "window" | "quit"): void {
    if (win.webContents.isDestroyed()) return;
    revealWindow(win);
    if (closeRequestPending) return;
    closeRequestPending = true;
    closeRequestMode = mode;
    const request: CloseRequest = { endsApp: mode === "quit" || windowCloseQuits(process.platform) };
    win.webContents.send("lifecycle.close-requested", request);
  }

  win.on("close", (event) => {
    if (closeAllowed || systemShutdown) return;
    event.preventDefault();
    if (!closeApproved) requestClose("window");
  });

  // A quit during an approved window close turns that close into the quit, so it still ends the app
  // once the write lands.
  const beforeQuitHandler = (event: Electron.Event) => {
    if (closeAllowed || systemShutdown) return;
    event.preventDefault();
    if (closeApproved) closeRequestMode = "quit";
    else requestClose("quit");
  };
  app.on("before-quit", beforeQuitHandler);

  ipcMain.handle("lifecycle.approveClose", async (event, allow: boolean) => {
    if (BrowserWindow.fromWebContents(event.sender) !== win) return;
    closeRequestPending = false;
    if (!allow || closeApproved) return;
    closeApproved = true;
    await settleWithin(prepareClose(), SHUTDOWN_WAIT_MS);
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
