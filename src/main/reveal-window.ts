import type { BrowserWindow } from "electron";

/** Brings a window to the front from wherever it is: minimized, hidden, or behind other apps. */
export function revealWindow(win: Pick<BrowserWindow, "isMinimized" | "restore" | "isVisible" | "show" | "focus">): void {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}
