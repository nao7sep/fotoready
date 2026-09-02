import type { RendererLogEntry } from "@shared/types/ipc";

// Capture the native sink before App mirrors console calls into the session log,
// so a failed bridge can never recurse through that mirror.
const consoleFallback = console.error.bind(console);

export function reportRendererLog(entry: RendererLogEntry): void {
  try {
    const log = window.api?.system?.log;
    if (typeof log !== "function") {
      consoleFallback("[FotoReady] Renderer diagnostic bridge is unavailable.", entry);
      return;
    }
    void log(entry).catch((reportError) => {
      consoleFallback("[FotoReady] Renderer diagnostic could not be recorded.", { reportError, entry });
    });
  } catch (reportError) {
    consoleFallback("[FotoReady] Renderer diagnostic could not be recorded.", { reportError, entry });
  }
}
