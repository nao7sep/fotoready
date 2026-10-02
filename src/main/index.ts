import { app } from "electron";
import { bootstrap, recordStartupFailure } from "./bootstrap";
import { notifyStartupFailure } from "./startup-dialog";
import { windowCloseQuits } from "./window-close";

// One instance only: the project lives in memory per process, so a second instance has nothing to
// offer and would overwrite the first one's settings with its own stale copy. A second launch hands
// over to the running instance, which brings its window forward, and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Bootstrap failures need a visible terminal surface; the crash handler logs but
  // deliberately does not terminate the process on its own.
  void bootstrap().catch(async (error: unknown) => {
    recordStartupFailure("startup failed", error);
    try {
      await notifyStartupFailure();
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
