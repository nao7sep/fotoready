import { app, BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import path from "node:path";
import {
  RECORDS_WINDOW_FIRST_RUN,
  RECORDS_WINDOW_MIN_HEIGHT,
  RECORDS_WINDOW_MIN_WIDTH
} from "@shared/layout/records-metrics";
import { RECORDS_CHANGED_CHANNEL } from "@shared/records";
import type { Logger } from "@shared/types/log";
import { revealWindow } from "./reveal-window";
import { windowBackground } from "./theme";
import { configureWindowActivity } from "./window-activity";
import { configureRendererDiagnostics } from "./renderer-diagnostics";
import { configureWindowMinimum } from "./window-minimum";
import { createWindowWithUsablePersistedBounds } from "./window-state-recovery";


// The Records window shows records.sqlite3. It is a durable secondary window with its own placement
// (window-conventions, Placement), and there is only ever one: opening it again brings it forward.
let recordsWindow: BrowserWindow | null = null;
// The window Records was last opened from, which gets focus back when Records closes
// (window-conventions, Background visibility and activation).
let recordsOpener: BrowserWindow | null = null;

export function buildRecordsWindowOptions(title: string, preloadPath: string): BrowserWindowConstructorOptions {
  return {
    name: "records",
    windowStatePersistence: {
      bounds: true,
      displayMode: process.platform === "win32"
    },
    title,
    width: RECORDS_WINDOW_FIRST_RUN.width,
    height: RECORDS_WINDOW_FIRST_RUN.height,
    minWidth: RECORDS_WINDOW_MIN_WIDTH,
    minHeight: RECORDS_WINDOW_MIN_HEIGHT,
    show: false,
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is the main window's ES module, which a sandboxed renderer cannot load.
      sandbox: false
    }
  };
}

/** Tells the Records window, when it is open, that a record was stored. Never throws. */
export function notifyRecordsChanged(): void {
  const win = recordsWindow;
  if (win === null || win.isDestroyed() || win.webContents.isDestroyed()) return;
  try {
    win.webContents.send(RECORDS_CHANGED_CHANNEL);
  } catch (error) {
    // Called from inside a log write, so it cannot log; the next record signals again.
    console.error("[records] the Records window could not be told about a new record", error);
  }
}

/** Closes the Records window with the main window, whose workspace it belongs to. */
export function closeRecordsWindow(): void {
  if (recordsWindow !== null && !recordsWindow.isDestroyed()) recordsWindow.close();
}

export async function openRecordsWindow({ title, logger }: { title: string; logger: Logger }): Promise<void> {
  const opener = BrowserWindow.getFocusedWindow();
  if (recordsWindow !== null && !recordsWindow.isDestroyed()) {
    if (opener !== recordsWindow) recordsOpener = opener ?? recordsOpener;
    revealWindow(recordsWindow);
    return;
  }
  recordsOpener = opener;

  const options = buildRecordsWindowOptions(title, path.join(import.meta.dirname, "../preload/index.mjs"));
  const win = createWindowWithUsablePersistedBounds("records", () => new BrowserWindow(options));
  recordsWindow = win;
  // Closing Records while it has focus hands focus back to the window it was opened from, rather
  // than to whichever window the OS ranks next.
  let focusedAtClose = false;
  win.on("close", () => { focusedAtClose = win.isFocused(); });
  win.once("closed", () => {
    if (recordsWindow !== win) return;
    recordsWindow = null;
    const back = recordsOpener;
    recordsOpener = null;
    if (focusedAtClose && back !== null && !back.isDestroyed()) back.focus();
  });
  configureWindowMinimum(win, () => ({ width: RECORDS_WINDOW_MIN_WIDTH, height: RECORDS_WINDOW_MIN_HEIGHT }),
    (error) => logger.warn("window minimum could not be updated", { mod: "main.window", window: "records", err: error }));
  configureWindowActivity(app, win);
  configureRendererDiagnostics(win, "records", logger);

  // The page never legitimately opens a window or navigates away; a same-URL reload is left alone so
  // a development reload still works.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.once("ready-to-show", () => {
    win.show();
  });

  try {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
      await win.loadURL(new URL("records.html", `${rendererUrl}/`).toString());
    } else {
      await win.loadFile(path.join(import.meta.dirname, "../renderer/records.html"));
    }
  } catch (error) {
    win.destroy();
    throw error;
  }
}
