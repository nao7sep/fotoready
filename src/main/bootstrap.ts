import { BrowserWindow, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureUserDataPath, getAppPaths } from "./paths";
import { createLogger } from "./logging/logger";
import { loadSettings } from "./persistence/settings-io";
import { registerIpcHandlers } from "./ipc/router";
import { ProjectSession } from "./project/session";
import { QualityQueue } from "./queues/quality";
import { APP_NAME } from "@shared/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function bootstrap(): Promise<void> {
  configureUserDataPath();
  await app.whenReady();

  const paths = getAppPaths();
  const logger = await createLogger(paths.logsDir);
  const settings = await loadSettings(paths.settingsPath);
  const qualityQueue = new QualityQueue(paths);
  const projectSession = new ProjectSession(settings, qualityQueue);

  registerIpcHandlers({
    paths,
    settings,
    projectSession,
    version: app.getVersion()
  });

  const win = new BrowserWindow({
    title: APP_NAME,
    minWidth: 1440,
    minHeight: 900,
    width: 1600,
    height: 960,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once("ready-to-show", () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  logger.info({ mod: "main.bootstrap", dataDir: paths.dataDir }, "app started");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void bootstrap();
  });
}
