import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultGlobalSettings } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";
import { normalizeGlobalSettings } from "@shared/validation/settings";
import { utcStamp } from "@shared/time";
import { writeManagedFile } from "./write-managed-file";
import type { AppLogger } from "./logger";

function defaults(): GlobalSettings {
  return defaultGlobalSettings(null);
}

export function resolveWorkerPoolSize(workerPoolSize: number | null): number {
  return workerPoolSize ?? Math.min(8, os.cpus().length);
}

export async function loadSettings(settingsPath: string, logger?: AppLogger): Promise<GlobalSettings> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const { settings, issues } = normalizeGlobalSettings(JSON.parse(raw), defaults());
    if (issues.length > 0) {
      const backupPath = await backupInvalidFile(settingsPath);
      logger?.warn("settings file contained invalid data; using fallback values", { mod: "settings", settingsPath, backupPath, issues });
      await saveSettings(settingsPath, settings);
    }
    return settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const backupPath = await backupInvalidFile(settingsPath);
      logger?.warn("settings file was unreadable; using defaults", { mod: "settings", settingsPath, backupPath, err: error });
    }

    const settings = defaults();
    await saveSettings(settingsPath, settings);
    return settings;
  }
}

export async function saveSettings(settingsPath: string, settings: GlobalSettings): Promise<void> {
  const normalized = normalizeGlobalSettings(settings, defaults()).settings;
  // recorded: config.json is durable, user-authored managed text (the app's own settings) — written
  // through the managed-text choke point, which records its exact bytes into backups.sqlite3 after the
  // rename (data-backup conventions).
  await writeManagedFile(settingsPath, `${JSON.stringify(normalized, null, 2)}\n`);
}

async function backupInvalidFile(filePath: string): Promise<string | null> {
  // <stem>-<timestamp>.invalid, alongside the source file (derived-filename grammar).
  const backupPath = path.join(path.dirname(filePath), `${path.parse(filePath).name}-${utcStamp()}.invalid`);
  try {
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}
