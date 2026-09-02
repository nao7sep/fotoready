import { app } from "electron";
import { bootstrap } from "./bootstrap";
import { notifyStartupFailure } from "./startup-dialog";

// Bootstrap failures need a visible terminal surface; the crash handler logs but
// deliberately does not terminate the process on its own.
void bootstrap().catch(async (error: unknown) => {
  console.error("[fotoready] Bootstrap failed:", error instanceof Error ? error.stack : String(error));
  await notifyStartupFailure();
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
