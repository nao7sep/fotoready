import path from "node:path";
import os from "node:os";
import { app } from "electron";
import { DATA_DIR_NAME } from "@shared/constants";

export type AppPaths = {
  dataDir: string;
  settingsPath: string;
  statePath: string;
  apiKeysPath: string;
  logsDir: string;
  bundledLutsDir: string;
  bundledStampsDir: string;
};

export function getDataDir(): string {
  return path.join(os.homedir(), DATA_DIR_NAME);
}

export function getAppPaths(): AppPaths {
  const dataDir = getDataDir();
  return {
    dataDir,
    settingsPath: path.join(dataDir, "settings.json"),
    statePath: path.join(dataDir, "state.json"),
    apiKeysPath: path.join(dataDir, "api-keys.json"),
    logsDir: path.join(dataDir, "logs"),
    bundledLutsDir: bundledResourceDir("luts"),
    bundledStampsDir: bundledResourceDir("stamps")
  };
}

function bundledResourceDir(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(process.cwd(), "resources", name);
}
