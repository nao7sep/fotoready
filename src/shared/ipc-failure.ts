import type { Message } from "@shared/i18n/translate";

// A failure reason the main process authored for the user, per the error-handling
// conventions' structured failure at the IPC boundary. Electron keeps only an
// Error's message across ipcMain.handle and contextBridge, so the handler
// resolves with this plain object and the preload rethrows it as is, which
// contextBridge copies intact. The renderer shows the reason beneath the failed
// operation's own copy.
export type IpcFailure = { ipcFailure: Message };

export function ipcFailure(reason: Message): IpcFailure {
  return { ipcFailure: reason };
}

// Type-only import above: the preload loads this module and must not pull in the
// renderer's translation code.
export function isIpcFailure(value: unknown): value is IpcFailure {
  if (typeof value !== "object" || value === null) return false;
  const reason = (value as { ipcFailure?: unknown }).ipcFailure;
  return typeof reason === "object" && reason !== null && typeof (reason as { key?: unknown }).key === "string";
}
