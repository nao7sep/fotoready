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
import { notifyStartupFailure, showSettingsNotice } from "./startup-dialog";
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
import { UserWorkWrites, saveUserWorkBeforeQuit, settleWithin, type QuitChoice, type UserWork } from "./quit-save";
import { askDiscardWorkspace, askWorkNotSaved } from "./quit-dialog";
import { cancelOpenMessageDialogs } from "./plain-message-dialog";

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
// process alive after the last window closes). The quit records why the app is
// shutting down, and its stop reads it. "unknown" means the app went down
// without passing through a recognized quit path (e.g. an external signal) —
// distinct from a deliberate user quit.
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
  const { settings, file: settingsFile, notice: settingsNotice } = await loadSettings(paths.settingsPath, logger);
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
  const userWork = new UserWorkWrites();
  if (settingsNotice) await showSettingsNotice(logger, settingsNotice);
  const visionQueue = new VisionQueue(paths, settings, logger, records);
  const workerPoolSize = resolveWorkerPoolSize(settings.workerPoolSize);
  const pipelineWorkerPool = new PipelineWorkerPool(workerPoolSize);
  const processingQueue = new ProcessingQueue(workerPoolSize, settings, pipelineWorkerPool, logger);
  const projectSession = new ProjectSession(settings, visionQueue, processingQueue, pipelineWorkerPool, paths.bundledStampsDir, logger, userWork);
  processingQueue.setUpdateListener(() => projectSession.emitSnapshot());
  processingQueue.setAfterTaskProcessed((taskId) => projectSession.afterTaskProcessed(taskId));

  registerIpcHandlers({
    paths,
    settings,
    settingsFile,
    uiState,
    stateCoordinator,
    userWork,
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

  // The main window, apart from the Records window beside it, and the guard that asks its
  // renderer before a quit.
  let mainWindow: BrowserWindow | null = null;
  let mainGuard: CloseGuard | null = null;

  const askNotSaved = (unsaved: UserWork[]): Promise<QuitChoice> =>
    askWorkNotSaved(unsaved).catch((error: unknown) => {
      logger.error("the quit question could not be shown; FotoReady stays open", { mod: "main.quit", err: error });
      return "cancel" as const;
    });

  // One launch = one session. The work above is one-time process init; only the
  // window is (re)created below, so it must never be redone on re-activate.
  // Every quit path (unsaved-edits-conventions, Quitting) first asks the window's pre-quit
  // confirmations and waits for the user's own work, then cancels in-flight saves, which remove
  // their unfinished files, lands the last UI state write, and closes the workers and the records
  // reader, each stage within its bound.
  const quit = installQuitShutdown({
    prepare: async () => {
      userWork.beginQuit();
      let go = false;
      try {
        if (quit.sessionEnding()) exitState.reason = "system-shutdown";
        else if (exitState.reason !== "window-close") exitState.reason = "user-quit";
        if (!quit.sessionEnding() && !(await confirmWorkspaceQuit(mainGuard, projectSession, askDiscardWorkspace)) && !quit.sessionEnding()) return false;
        go = await saveUserWorkBeforeQuit(userWork, askNotSaved, quit.sessionEnding, logger);
        return go;
      } catch (error) {
        logger.error("quitting could not check the user's work", { mod: "main.quit", err: error });
        go = quit.sessionEnding();
        return go;
      } finally {
        if (!go) {
          userWork.endQuit();
          exitState.reason = "unknown";
        }
      }
    },
    answerForSessionEnd: () => {
      cancelOpenMessageDialogs();
      mainGuard?.answerForSessionEnd();
    },
    stop: async () => {
      logger.info("app stopping", { mod: "main", reason: exitState.reason });
      // UI state is not the user's own work: a write that failed is logged and never holds the quit.
      const stateSaved = stateCoordinator.flush().catch((error: unknown) => {
        logger.warn("the UI state was not saved before quit", { mod: "main.quit", statePath: paths.statePath, err: error });
      });
      const finished = await settleWithin(Promise.all([projectSession.shutdown(), stateSaved]), QUIT_STOP_MS);
      if (!finished) logger.warn("in-flight work did not stop in time; quitting anyway", { mod: "main.quit", waitMs: QUIT_STOP_MS });
      const closed = await settleWithin(Promise.all([pipelineWorkerPool.destroy(), recordsReader.close()]), QUIT_CLOSE_MS);
      if (!closed) logger.warn("the workers did not close in time; quitting anyway", { mod: "main.quit", waitMs: QUIT_CLOSE_MS });
    },
    sessionEnded: () => {
      logger.warn("the session ended before quitting finished", { mod: "main.quit", ...userWork.unsaved() });
    }
  });

  // macOS and Linux announce the end of the session here; Windows only through the main window's
  // session events (installCloseGuard). Electron passes this event a preventDefault its typings
  // omit, which asks the OS to wait while FotoReady quits.
  powerMonitor.on("shutdown", (event?: { preventDefault(): void }) => {
    event?.preventDefault();
    quit.endSession();
  });

  const createWindow = async (): Promise<void> => {
    const options = buildWindowOptions(path.join(__dirname, "../preload/index.mjs"));
    const win = createWindowWithUsablePersistedBounds("main", () => new BrowserWindow(options));
    mainWindow = win;
    // The Records window belongs to this window's workspace and closes with it, so the app's own
    // window-all-closed and re-activate paths see no window left behind.
    win.once("closed", () => {
      if (mainWindow === win) {
        mainWindow = null;
        mainGuard = null;
      }
      closeRecordsWindow();
    });
    configureWindowMinimum(win, () => ({ width: computeMinWindowWidth(), height: computeMinWindowHeight() }),
      (error) => logger.warn("window minimum could not be updated", { mod: "main.window", err: error }));
    configureWindowActivity(app, win);
    mainGuard = installCloseGuard(win, exitState, quit, logger);

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

// How long quitting waits, after the user's own work (QUIT_SAVE_MS), for in-flight saves to stop
// and the last UI state write to land, then for the workers and the records reader to close. With
// the save, the whole quit stays under the OS's kill delay (unsaved-edits-conventions, Quitting).
const QUIT_STOP_MS = 1_500;
const QUIT_CLOSE_MS = 1_000;

export type QuitSteps = {
  /**
   * Runs before any window closes: the pre-quit confirmations and the save of the user's own work.
   * Resolves false when the user keeps FotoReady open. Never rejects.
   */
  prepare(): Promise<boolean>;
  /** Answers every question still open, as an ending session must not wait on one. */
  answerForSessionEnd(): void;
  /** Runs once the windows have closed; bounds each of its own waits. */
  stop(): Promise<void>;
  /** Records what a Windows session end cut short; the process exits right after. */
  sessionEnded(): void;
};

export type QuitControl = {
  /** Whether the quit has passed its checks, so the windows may close. */
  approved(): boolean;
  sessionEnding(): boolean;
  /** The OS is ending the session: quit without asking, answering any open question. */
  endSession(): void;
  /**
   * Windows is ending the session now. It may end the process as soon as the event returns, so
   * whatever the quit has not finished is recorded and FotoReady exits before returning.
   */
  sessionEnded(): void;
};

/**
 * Exported for tests. Every quit arrives at before-quit — Quit from the menu, the keyboard or the
 * Dock, the main window's close off macOS, and an ending session — and is held there while
 * `prepare` runs, and at will-quit, once the windows have closed, while `stop` runs. A quit arriving
 * meanwhile is held too, so only the quit after `stop` ends the process.
 */
export function installQuitShutdown(steps: QuitSteps): QuitControl {
  let phase: "running" | "preparing" | "approved" | "stopping" | "done" = "running";
  let sessionEnding = false;
  app.on("before-quit", (event) => {
    if (phase === "approved" || phase === "done") return;
    event.preventDefault();
    if (phase !== "running") return;
    phase = "preparing";
    void steps.prepare().then((go) => {
      if (!go) {
        phase = "running";
        return;
      }
      phase = "approved";
      app.quit();
    });
  });
  app.on("will-quit", (event) => {
    if (phase === "done") return;
    event.preventDefault();
    if (phase === "stopping") return;
    phase = "stopping";
    void steps.stop().finally(() => {
      phase = "done";
      app.quit();
    });
  });
  const endSession = (): void => {
    if (sessionEnding) return;
    sessionEnding = true;
    steps.answerForSessionEnd();
    if (phase === "running") app.quit();
  };
  return {
    approved: () => phase === "approved" || phase === "stopping" || phase === "done",
    sessionEnding: () => sessionEnding,
    endSession,
    sessionEnded: () => {
      endSession();
      if (phase === "done") return;
      steps.sessionEnded();
      app.exit(0);
    }
  };
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

export type CloseGuard = {
  /** Asks the renderer's pre-quit confirmations; resolves true when the user goes on with the quit. */
  confirmQuit(): Promise<boolean>;
  /** Answers an open confirmation for an ending session. */
  answerForSessionEnd(): void;
};

/**
 * Exported for tests. Holds the main window's close for the renderer's confirmations. Off macOS
 * closing the window quits, so the close becomes the quit, and a cancelled quit keeps the window
 * open; on macOS the window closes alone and the app goes on.
 */
export function installCloseGuard(win: BrowserWindow, exitState: ExitState, quit: QuitControl, logger?: Pick<AppLogger, "warn">): CloseGuard {
  // An approved macOS window close, which the guard then lets through.
  let closeAllowed = false;
  const presentationFailed = (error: unknown): void => {
    if (logger) logger.warn("the close question could not be presented", { mod: "main.quit", err: error });
    else console.warn("[close] could not present the close question", error);
  };
  // The question the renderer is answering. A quit arriving while it asks about a window close
  // joins it, and the answer then goes on with the quit instead of closing the window alone.
  let requestId = 0;
  let pending: { mode: "window" | "quit"; requestId: number; answer: Promise<boolean>; resolve(allow: boolean): void } | null = null;

  function ask(mode: "window" | "quit"): Promise<boolean> {
    if (pending) {
      const pendingAnswer = pending.answer;
      if (mode === "quit" && pending.mode !== "quit") {
        pending.mode = "quit";
        pending.requestId = ++requestId;
        try { win.webContents.send("lifecycle.close-requested", { endsApp: true, requestId }); } catch (error) {
          presentationFailed(error);
          answer(false);
        }
      }
      return pendingAnswer;
    }
    if (win.webContents.isDestroyed()) return Promise.resolve(false);
    try { revealWindow(win); } catch (error) {
      presentationFailed(error);
      return Promise.resolve(false);
    }
    let resolve!: (allow: boolean) => void;
    const answerPromise = new Promise<boolean>((settle) => { resolve = settle; });
    pending = { mode, requestId: ++requestId, answer: answerPromise, resolve };
    const request: CloseRequest = { endsApp: mode === "quit" || windowCloseQuits(process.platform), requestId };
    try { win.webContents.send("lifecycle.close-requested", request); } catch (error) {
      presentationFailed(error);
      resolve(false);
      pending = null;
    }
    return answerPromise;
  }

  function answer(allow: boolean): void {
    const answered = pending;
    pending = null;
    if (!answered) return;
    answered.resolve(allow);
    if (allow && answered.mode === "window" && !quit.sessionEnding()) {
      closeAllowed = true;
      win.close();
    }
  }

  win.on("close", (event) => {
    if (closeAllowed || quit.approved() || quit.sessionEnding()) return;
    event.preventDefault();
    if (windowCloseQuits(process.platform)) {
      exitState.reason = "window-close";
      app.quit();
      return;
    }
    void ask("window");
  });

  // Windows ends a session through the main window only, and never with a quit event. The query
  // is never refused; it starts the quit without asking, and the end itself exits.
  const endSession = (): void => quit.endSession();
  const sessionEnded = (): void => quit.sessionEnded();
  win.on("query-session-end", endSession);
  win.on("session-end", sessionEnded);

  ipcMain.handle("lifecycle.approveClose", async (event, allow: boolean, answeredRequestId: number) => {
    if (BrowserWindow.fromWebContents(event.sender) !== win || answeredRequestId !== pending?.requestId) return;
    answer(allow);
  });

  win.once("closed", () => {
    win.off("query-session-end", endSession);
    win.off("session-end", sessionEnded);
    ipcMain.removeHandler("lifecycle.approveClose");
    // Losing the required renderer answer cancels user quit; OS takeover proceeds.
    const unanswered = pending;
    pending = null;
    unanswered?.resolve(quit.sessionEnding());
  });

  return {
    confirmQuit: () => ask("quit"),
    answerForSessionEnd: () => answer(true)
  };
}

/** Confirm process-owned work using a usable renderer or the existing small dialog. */
export async function confirmWorkspaceQuit(
  guard: CloseGuard | null,
  session: Pick<ProjectSession, "snapshot" | "queueSnapshot">,
  ask: (savesInFlight: boolean) => Promise<boolean>,
): Promise<boolean> {
  if (guard) return guard.confirmQuit();
  const project = session.snapshot().project;
  const queue = session.queueSnapshot();
  if (project.originals.length === 0 && project.tasks.length === 0 && queue.total === 0) return true;
  return ask(queue.queued + queue.processing > 0);
}
