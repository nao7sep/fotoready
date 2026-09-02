import { app } from "electron";
import { bootstrap } from "./bootstrap";
import { showPlainMessageDialog } from "./plain-message-dialog";

// Bootstrap failures need a visible terminal surface; the crash handler logs but
// deliberately does not terminate the process on its own.
void bootstrap().catch(async (error: unknown) => {
  console.error("[fotoready] Bootstrap failed:", error instanceof Error ? error.stack : String(error));
  await showPlainMessageDialog({
    title: "FotoReady could not start",
    message: "FotoReady could not finish opening its settings and workspace.",
    detail: "No photos or project files were changed. Check the session log, then start FotoReady again.",
  });
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
