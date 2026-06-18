import path from "node:path";
import { app } from "electron";
import { DATA_DIR_NAME } from "@shared/constants";
import { resolveStorageRoot } from "./storage-root";

export type AppPaths = {
  dataDir: string;
  settingsPath: string;
  statePath: string;
  apiKeysPath: string;
  logsDir: string;
  bundledLutsDir: string;
  bundledStampsDir: string;
};

// Standard subdirectories created under the storage root on first use.
const STANDARD_SUBDIRS = ["logs"] as const;

// Resolves the storage root from the home directory (honoring FOTOREADY_HOME),
// never from the working directory or the code's location, and creates the root
// plus its standard subdirs. An unusable override is a reported startup error.
export function getDataDir(): string {
  return resolveStorageRoot(DATA_DIR_NAME, STANDARD_SUBDIRS);
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
