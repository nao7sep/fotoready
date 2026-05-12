import { app } from "electron";
import path from "node:path";
import os from "node:os";
import { DATA_DIR_NAME } from "@shared/constants";

export type AppPaths = {
  dataDir: string;
  settingsPath: string;
  apiKeysPath: string;
  cacheDir: string;
  sourceFactsPath: string;
  visionFactsPath: string;
  logsDir: string;
  lutsDir: string;
};

export function getDataDir(): string {
  return path.join(os.homedir(), DATA_DIR_NAME);
}

export function configureUserDataPath(): void {
  app.setPath("userData", getDataDir());
}

export function getAppPaths(): AppPaths {
  const dataDir = getDataDir();
  const cacheDir = path.join(dataDir, "cache");

  return {
    dataDir,
    settingsPath: path.join(dataDir, "settings.json"),
    apiKeysPath: path.join(dataDir, "api-keys.enc"),
    cacheDir,
    sourceFactsPath: path.join(cacheDir, "source-facts.json"),
    visionFactsPath: path.join(cacheDir, "vision-facts.json"),
    logsDir: path.join(dataDir, "logs"),
    lutsDir: path.join(dataDir, "luts")
  };
}
