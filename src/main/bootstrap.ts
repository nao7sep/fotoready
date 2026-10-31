import fs from "node:fs";
import { BrowserWindow, app, ipcMain, powerMonitor } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
import os from "node:os";
import path from "node:path";
import { getAppPaths } from "./paths";
import { createLogger, installCrashHandlers, type AppLogger } from "./logger";
import { createRecordsStore, fallbackFile, writeFallbackRecord } from "./records-store";
import { startStoreWriter } from "./store-writer";
import { jsonSafe } from "./json-safe";
import { effectiveSettings } from "./settings-io";
import { createStateCoordinator, loadState } from "./state-io";
import { registerIpcHandlers, type IpcWork } from "./ipc-router";
import { setBackupWriter } from "./backup-store";
import { ProjectSession } from "./session";
import { resolveStampDir } from "./stamp-catalog";
import { resolveLutDir } from "./lut-catalog";
import { VisionQueue } from "./queues/vision";
import { ProcessingQueue } from "./queues/processing-queue";
import { PipelineWorkerPool } from "./workers/pipeline-pool";
import { APP_NAME } from "@shared/constants";
import { nowIso } from "@shared/time";
import { readLaunchFiles } from "./launch-files";
import { showSideStoreOff } from "./startup-dialog";
import { configureWindowActivity } from "./window-activity";
import { configureRendererDiagnostics } from "./renderer-diagnostics";
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
import type { CloseRequest } from "@shared/types/ipc";
import { closeRecordsWindow, notifyRecordsChanged, openRecordsWindow } from "./records-window";
import { describeUnsaved, saveUserWorkBeforeQuit, type QuitChoice, type QuitDeadline, type UnsavedWrite, type UserWork } from "./quit-save";
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


// Shared across the app's lifetime. The quit records why the app is shutting
// down, and its stop reads it. "unknown" means the app went down
// without passing through a recognized quit path (e.g. an external signal) —
// distinct from a deliberate user quit.
export type ExitState = { reason: string };

// This launch: the records' session, and the name of the text file a failure before the records
// store opens falls back to.
const sessionStart = new Date();
let launchLogger: AppLogger | null = null;

/**
 * Records a startup failure: through the logger once it exists, before then in a text file under
 * `logs/`, then on the console (logging-conventions, When logging itself fails). Never throws.
 */
export function recordStartupFailure(message: string, error: unknown): void {
  if (launchLogger) {
    launchLogger.error(message, { mod: "main.bootstrap", err: error });
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
  // Electron may create its profile during readiness; isolate it before that boundary.
  const paths = getAppPaths();
  fs.mkdirSync(path.join(paths.dataDir, "electron", "session"), { recursive: true });
  app.setPath("userData", path.join(paths.dataDir, "electron"));
  app.setPath("sessionData", path.join(paths.dataDir, "electron", "session"));
  // The lock follows userData, so independent storage roots can run independently. A second
  // launch of the same root hands over to its running instance instead of sharing mutable stores.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  // Before anything is drawn, so even a startup failure speaks the computer's language.
  await detectComputerLanguage();
  // Before anything is written: a refused file stops startup and is left exactly as it is.
  const settingsFile = await readLaunchFiles(paths);

  // Debug is developer-only: on for unpackaged dev builds or an explicit opt-in,
  // off (never written to disk) in packaged release builds.
  const debug = !app.isPackaged || process.env.FOTOREADY_DEBUG === "1";
  const storeWriter = startStoreWriter({
    recordsPath: paths.recordsPath,
    backupsPath: paths.backupsPath,
    fallbackPath: fallbackFile(paths.logsDir, sessionStart),
    session: sessionStart.toISOString(),
    onWarning: ({ message, fields }) => launchLogger?.warn(message, fields),
    // Off for the session and left as it is, said visibly once (store-recovery-conventions).
    onRefused: (store, reason) => void showSideStoreOff(logger, store, store === "records" ? paths.recordsPath : paths.backupsPath, reason)
  });
  storeWriter.onStored(notifyRecordsChanged);
  const records = createRecordsStore(storeWriter, sessionStart);
  const logger = createLogger(records, { debug });
  launchLogger = logger;
  installCrashHandlers(logger);
  // Before any protected save, so config.json saves and imported LUTs and stamps reach the history.
  setBackupWriter(storeWriter);
  const settings = effectiveSettings(settingsFile.stored, logger);
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
  const visionQueue = new VisionQueue(paths, settings, logger, records);
  // One image worker per core; how many saves run at once also follows each photo's size (save-admission.ts).
  const cores = Math.max(1, os.cpus().length);
  const pipelineWorkerPool = new PipelineWorkerPool(cores);
  const processingQueue = new ProcessingQueue(cores, settings, pipelineWorkerPool, logger);
  const projectSession = new ProjectSession(settings, visionQueue, processingQueue, pipelineWorkerPool, paths.bundledStampsDir, logger);
  // A folder setting naming an unset variable leaves that kind of asset unrelinked; its listing reports the problem.
  const folderOrNull = (resolve: () => string): string | null => { try { return resolve(); } catch { return null; } };
  projectSession.setAssetFolders(() => ({
    bundledStamps: paths.bundledStampsDir,
    importedStamps: folderOrNull(() => resolveStampDir(settings.stampFolder, paths.stampsDir)),
    bundledLuts: paths.bundledLutsDir,
    importedLuts: folderOrNull(() => resolveLutDir(settings.lutFolder, paths.lutsDir))
  }));
  processingQueue.setUpdateListener((save) => projectSession.onProcessingUpdate(save));
  processingQueue.setAfterTaskProcessed((taskId) => projectSession.afterTaskProcessed(taskId));

  const ipcWork = registerIpcHandlers({
    paths,
    settings,
    settingsFile,
    uiState,
    stateCoordinator,
    projectSession,
    logger,
    version: __APP_VERSION__,
    records: {
      reader: storeWriter,
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
      cores,
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

  const unsavedWork = (): UnsavedWrite[] => unsavedUserWork(ipcWork, visionQueue, projectSession);

  // One launch = one session. The work above is one-time process init; only the
  // window is (re)created below, so it must never be redone on re-activate.
  // Every quit path (unsaved-edits-conventions, Quitting) first asks the window's pre-quit
  // confirmations and waits for the user's own work, then cancels in-flight saves (unfinished
  // temporary files may remain), lands the last UI state write, closes the workers and drains the
  // store writer, all within the one exit deadline.
  const quit = installQuitShutdown({
    prepare: (deadline) => prepareQuit({
      unsavedWork,
      deadline,
      exitState,
      sessionEnding: () => quit.sessionEnding(),
      confirmWorkspace: () => confirmWorkspaceQuit(mainGuard, projectSession, askDiscardWorkspace),
      askNotSaved,
      logger
    }),
    answerForSessionEnd: () => {
      cancelOpenMessageDialogs();
      mainGuard?.answerForSessionEnd();
    },
    approved: () => ipcWork.closeAdmission(),
    stop: () => stopAppWork({ logger, exitReason: exitState.reason, statePath: paths.statePath,
      stateCoordinator, projectSession, pipelineWorkerPool, storeWriter,
      unsavedWork, ipcWork, sessionEnding: quit.sessionEnding }),
    sessionEnded: () => {
      logger.warn("the session ended before quitting finished", { mod: "main.quit", ...describeUnsaved(unsavedWork()) });
    }
  });

  // macOS and Linux announce the end of the session here; Windows only through the main window's
  // session events (installCloseGuard). The OS is never asked to wait: saves at logout are
  // best-effort within the exit deadline, since a held-up restart costs more than an unfinished save.
  followOsShutdown(quit);

  const createWindow = async (): Promise<void> => {
    const options = buildWindowOptions(path.join(import.meta.dirname, "../preload/index.mjs"));
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
    configureRendererDiagnostics(win, "main", logger);
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
        await win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
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

  // A second launch exits at once (see index.ts); this instance answers by coming forward. Closing
  // the main window quits on every platform, so there is no windowless app to reopen.
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
  });
}

/**
 * Exported for tests. The user's own work its owners have not saved: the settings chain, the key
 * store (whose key is saved from Settings) and the output-files lane each report their latest
 * unsaved write.
 */
export function unsavedUserWork(ipcWork: Pick<IpcWork, "unsavedSettings">, visionQueue: Pick<VisionQueue, "unsavedKeyWrite">,
  projectSession: Pick<ProjectSession, "unsavedSidecars">): UnsavedWrite[] {
  const settingsWrite = ipcWork.unsavedSettings();
  const keyWrite = visionQueue.unsavedKeyWrite();
  return [
    ...(settingsWrite ? [settingsWrite] : []),
    ...(keyWrite ? [{ work: { kind: "settings" } as const, ...keyWrite }] : []),
    ...projectSession.unsavedSidecars()
  ];
}

/**
 * Exported for tests. The checks every quit passes before any window closes: the workspace discard
 * question, then the save of the user's own work. An ending session asks nothing, and a question
 * already open when the session starts ending lets the quit go on whatever its answer. Resolves
 * false when the user keeps FotoReady open. Never rejects.
 */
export async function prepareQuit({ unsavedWork, deadline, exitState, sessionEnding, confirmWorkspace, askNotSaved, logger }: {
  unsavedWork(): UnsavedWrite[];
  deadline: QuitDeadline;
  exitState: ExitState;
  sessionEnding(): boolean;
  confirmWorkspace(): Promise<boolean>;
  askNotSaved(unsaved: UserWork[]): Promise<QuitChoice>;
  logger: Pick<AppLogger, "info" | "error">;
}): Promise<boolean> {
  let go = false;
  try {
    if (exitState.reason !== "window-close") exitState.reason = "user-quit";
    if (!sessionEnding() && !(await deadline.ask(confirmWorkspace)) && !sessionEnding()) return false;
    go = await saveUserWorkBeforeQuit(unsavedWork, deadline, askNotSaved, sessionEnding, logger);
    return go;
  } catch (error) {
    logger.error("quitting could not check the user's work", { mod: "main.quit", err: error });
    go = sessionEnding();
    return go;
  } finally {
    if (!go) {
      exitState.reason = "unknown";
    } else if (sessionEnding()) {
      // Also when the session began ending while an ordinary quit was asking: macOS can send its
      // quit before its power-off notice.
      exitState.reason = "system-shutdown";
    }
  }
}

/**
 * Bootstrap's actual stop wiring: in-flight saves stop and the last UI state write lands, then the
 * workers close, then the store writer writes its pending records and backups. Each step draws on what remains of the exit deadline, which ends FotoReady if one stalls.
 * Normal teardown is allowed only after owned work settles.
 */
export async function stopAppWork({ logger, exitReason, statePath, stateCoordinator, projectSession,
  pipelineWorkerPool, storeWriter, unsavedWork, ipcWork, sessionEnding }: {
  logger: Pick<AppLogger, "info" | "warn">;
  exitReason: string;
  statePath: string;
  stateCoordinator: Pick<ReturnType<typeof createStateCoordinator>, "flush">;
  projectSession: Pick<ProjectSession, "shutdown">;
  pipelineWorkerPool: Pick<PipelineWorkerPool, "destroy">;
  storeWriter: Pick<ReturnType<typeof startStoreWriter>, "close">;
  unsavedWork(): UnsavedWrite[];
  ipcWork: IpcWork;
  sessionEnding(): boolean;
}): Promise<boolean> {
  logger.info("app stopping", { mod: "main", reason: exitReason });
  // UI state is optional; its failure is logged without a quit question.
  const stateSaved = stateCoordinator.flush().catch((error: unknown) => {
    logger.warn("the UI state was not saved before quit", { mod: "main.quit", statePath, err: error });
  });
  await Promise.allSettled([projectSession.shutdown(), stateSaved]);
  await pipelineWorkerPool.destroy().catch(() => undefined);
  // An ending session skips the drain; the batch already sent may still be writing.
  const drained = await storeWriter.close({ drain: !sessionEnding() });
  // Quit anyway does not cancel primary writes, and IPC may still own native image/file reads.
  // Their actual settlement decides whether teardown is safe.
  const writesSettled = !unsavedWork().some((write) => write.running);
  return drained && writesSettled && ipcWork.isIdle();
}

/**
 * One exit deadline, so quitting always ends within a known time: it starts when the quit begins or
 * the OS session end begins, a quit question pauses it and it starts again when the answer arrives,
 * and every step — the wait for the user's own work, stopping, closing the workers and draining the
 * store writer — draws on what remains. A later quit request never extends it.
 */
export const QUIT_DEADLINE_MS = 5_000;

/**
 * Ends the process at once. On macOS with Electron 44.2.0, one file read blocked on a stalled volume,
 * synchronous or asynchronous, on a worker thread or on the main process's I/O pool, kept the process
 * alive after `app.exit(0)` and `process.reallyExit(0)` until the read was released, while SIGKILL
 * ended it immediately. Node maps it to TerminateProcess on Windows; native Windows qualification remains pending.
 */
function killProcess(): void {
  console.error("[main.quit] quitting did not finish in time; ending FotoReady");
  process.kill(process.pid, "SIGKILL");
}

export type QuitSteps = {
  /**
   * Runs before any window closes: the pre-quit confirmations and the save of the user's own work,
   * asking its questions through `deadline`. Resolves false when the user keeps FotoReady open.
   * Never rejects.
   */
  prepare(deadline: QuitDeadline): Promise<boolean>;
  /** Closes new work admission only after the cancelable checks have approved quitting. */
  approved?(): void;
  /** Answers every question still open, as an ending session must not wait on one. */
  answerForSessionEnd(): void;
  /**
   * Runs once the windows have closed, within what remains of the exit deadline. Resolves true when
   * every tracked operation settled (primary writes, IPC, processing, vision, the store writer),
   * so the ordinary exit cannot hang on one of them. Never rejects.
   */
  stop(): Promise<boolean>;
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
 * Exported for tests. macOS and Linux announce the end of the session through powerMonitor; the quit
 * starts without asking the OS to wait.
 */
export function followOsShutdown(quit: Pick<QuitControl, "endSession">): void {
  powerMonitor.on("shutdown", () => quit.endSession());
}

/**
 * Exported for tests. Every quit arrives at before-quit — Quit from the menu, the keyboard or the
 * Dock, the main window's close off macOS, and an ending session — and is held there while
 * `prepare` runs, and at will-quit, once the windows have closed, while `stop` runs. A quit arriving
 * meanwhile is held too, so only the quit after `stop` ends the process.
 */
export function installQuitShutdown(
  steps: QuitSteps,
  { deadlineMs = QUIT_DEADLINE_MS, forceExit = killProcess }: { deadlineMs?: number; forceExit?: () => void } = {}
): QuitControl {
  let phase: "running" | "preparing" | "approved" | "stopping" | "done" = "running";
  let sessionEnding = false;
  // The exit deadline's timer; null while no quit runs or a question pauses it.
  let timer: NodeJS.Timeout | null = null;
  // Whether it ran out during an ordinary quit's checks, and the signal that it did.
  let ranOut = false;
  let runOut = (): void => {};
  let runningOut = new Promise<void>((resolve) => { runOut = resolve; });
  const startDeadline = (): void => {
    if (timer !== null) clearTimeout(timer);
    ranOut = false;
    runningOut = new Promise<void>((resolve) => { runOut = resolve; });
    timer = setTimeout(expire, deadlineMs);
  };
  const stopDeadline = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  // Before an ordinary quit is approved, running out ends the wait for the user's own work, so its
  // question is asked instead of the work being lost; after approval, or in an ending session, it
  // ends FotoReady.
  function expire(): void {
    timer = null;
    if (phase === "preparing" && !sessionEnding) {
      ranOut = true;
      runOut();
    } else forceExit();
  }
  const deadline: QuitDeadline = {
    async ask(question) {
      if (!sessionEnding) stopDeadline();
      try {
        return await question();
      } finally {
        // An ending session's deadline already runs from when the session began ending.
        if (!sessionEnding) startDeadline();
      }
    },
    within: (work) => Promise.race([work.then(() => true, () => true), runningOut.then(() => false)])
  };
  app.on("before-quit", (event) => {
    if (phase === "approved" || phase === "done") return;
    event.preventDefault();
    if (phase !== "running") return;
    phase = "preparing";
    if (!sessionEnding) startDeadline();
    void steps.prepare(deadline).then((go) => {
      if (!go) {
        phase = "running";
        stopDeadline();
        return;
      }
      phase = "approved";
      steps.approved?.();
      if (ranOut) {
        forceExit();
        return;
      }
      app.quit();
    });
  });
  app.on("will-quit", (event) => {
    if (phase === "done") return;
    event.preventDefault();
    if (phase === "stopping") return;
    phase = "stopping";
    void steps.stop().then((settled) => {
      phase = "done";
      // Work still unsettled could keep the process alive through teardown, past the deadline.
      if (settled) app.quit();
      else forceExit();
    });
  });
  const endSession = (): void => {
    if (sessionEnding) return;
    sessionEnding = true;
    if (timer === null) startDeadline();
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
 * Exported for tests. Holds the main window's close for the renderer's confirmations. Closing the
 * main window quits on every platform (window-conventions), so the close becomes the quit, and a
 * cancelled quit keeps the window open.
 */
export function installCloseGuard(win: BrowserWindow, exitState: ExitState, quit: QuitControl, logger?: Pick<AppLogger, "warn">): CloseGuard {
  const presentationFailed = (error: unknown): void => {
    if (logger) logger.warn("the close question could not be presented", { mod: "main.quit", err: error });
    else console.warn("[close] could not present the close question", error);
  };
  // The question the renderer is answering; a quit arriving meanwhile joins it.
  let requestId = 0;
  let pending: { requestId: number; answer: Promise<boolean>; resolve(allow: boolean): void } | null = null;

  function ask(): Promise<boolean> {
    if (pending) return pending.answer;
    if (win.webContents.isDestroyed()) return Promise.resolve(false);
    try { revealWindow(win); } catch (error) {
      presentationFailed(error);
      return Promise.resolve(false);
    }
    let resolve!: (allow: boolean) => void;
    const answerPromise = new Promise<boolean>((settle) => { resolve = settle; });
    pending = { requestId: ++requestId, answer: answerPromise, resolve };
    const request: CloseRequest = { requestId };
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
  }

  win.on("close", (event) => {
    if (quit.approved() || quit.sessionEnding()) return;
    event.preventDefault();
    exitState.reason = "window-close";
    app.quit();
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
    confirmQuit: () => ask(),
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
  return ask(queue.queued + queue.processing > 0 || project.tasks.some((task) => task.visionRunning));
}
