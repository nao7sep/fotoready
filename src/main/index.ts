import { app } from "electron";
import { bootstrap, recordStartupFailure } from "./bootstrap";
import { notifyNewerFormat, notifySettingsQuarantineFailure, notifyStartupFailure } from "./startup-dialog";
import { SettingsQuarantineError } from "./settings-io";
import { NewerFormatError } from "@shared/format-versions";
import { windowCloseQuits } from "./window-close";

// One instance only: the project lives in memory per process, so a second instance has nothing to
// offer and would overwrite the first one's settings with its own stale copy. A second launch hands
// over to the running instance, which brings its window forward, and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A bootstrap failure is recorded (see recordStartupFailure), shown in the startup dialog, and
  // ends the process here; the crash handler logs but deliberately does not terminate it.
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
}

app.on("window-all-closed", () => {
  if (windowCloseQuits(process.platform)) {
    app.quit();
  }
});
