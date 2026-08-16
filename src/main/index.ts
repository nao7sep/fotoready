import { app, dialog } from "electron";
import { bootstrap } from "./bootstrap";

// Bootstrap failures need a visible terminal surface; the crash handler logs but
// deliberately does not terminate the process on its own.
void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox(
    "FotoReady could not start",
    `${message}\n\nNo photos or project files were changed. Check the session log, then start FotoReady again.`,
  );
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
