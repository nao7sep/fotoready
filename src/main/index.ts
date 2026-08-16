import { app, dialog } from "electron";
import { bootstrap } from "./bootstrap";

// A store that is corrupt AND cannot be copied aside rejects out of bootstrap: fotoready
// must not reset over bytes it failed to preserve, so it halts. Without this catch the
// rejection reached the crash handler, which logs and sets an exit code but does not exit
// — leaving a running process with no window and no message, which is not a halt
// (storage-path conventions: a halt names the store and reaches the user).
void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox(
    "fotoready could not start",
    "A settings file could not be read, and fotoready could not copy it aside either — so it has been " +
      "left exactly where it is rather than risk overwriting it.\n\n" +
      message +
      "\n\nYour photos and projects are not affected. Repair or move the file under the fotoready data " +
      "folder, then start fotoready again.",
  );
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
