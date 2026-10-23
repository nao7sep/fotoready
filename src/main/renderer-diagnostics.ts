import type { BrowserWindow, Event, RenderProcessGoneDetails } from "electron";
import type { Logger } from "@shared/types/log";

/** Keep renderer process failures observable even when the renderer cannot forward its own logs. */
export function configureRendererDiagnostics(
  win: BrowserWindow,
  windowIdentity: "main" | "records",
  logger: Pick<Logger, "error">
): void {
  const contents = win.webContents;
  const onProcessGone = (_event: Event, details: RenderProcessGoneDetails): void => {
    logger.error("renderer process exited", {
      mod: "main.renderer", window: windowIdentity, reason: details.reason, exitCode: details.exitCode
    });
  };
  contents.on("render-process-gone", onProcessGone);
  win.once("closed", () => contents.removeListener("render-process-gone", onProcessGone));
}
