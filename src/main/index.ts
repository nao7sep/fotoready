// First, before anything can start the I/O thread pool.
import "./threadpool-size";
import { app } from "electron";
import { bootstrap, recordStartupFailure } from "./bootstrap";
import { notifyNewerFormat, notifySettingsQuarantineFailure, notifyStartupFailure } from "./startup-dialog";
import { SettingsQuarantineError } from "./settings-io";
import { NewerFormatError } from "@shared/file-header";

// A bootstrap failure is recorded (see recordStartupFailure), shown in the startup dialog, and
// ends the process here. Uncaught exceptions are logged and rethrown; unhandled rejections
// are logged by their separate process handler.
void bootstrap().catch(async (error: unknown) => {
  recordStartupFailure("startup failed", error);
  try {
    // A store a newer build wrote halts startup with its own notice (store-recovery-conventions).
    await (error instanceof NewerFormatError ? notifyNewerFormat(error.filePath) : error instanceof SettingsQuarantineError ? notifySettingsQuarantineFailure(error.filePath) : notifyStartupFailure());
  } catch (dialogError) {
    recordStartupFailure("could not show the startup recovery dialog", dialogError);
  } finally {
    app.exit(1);
  }
});

// The app ends with its main window on every platform (window-conventions); this covers a window
// that closes without passing its close guard, such as a failed startup's.
app.on("window-all-closed", () => {
  app.quit();
});
