import { app } from "electron";
import { bootstrap } from "./bootstrap";

void bootstrap();

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
