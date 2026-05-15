import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultGlobalSettings } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";
import { normalizeGlobalSettings } from "@shared/validation/settings";

function defaults(): GlobalSettings {
  return defaultGlobalSettings(null);
}

export function resolveWorkerPoolSize(workerPoolSize: number | null): number {
  return workerPoolSize ?? Math.min(8, os.cpus().length);
}

export async function loadSettings(settingsPath: string): Promise<GlobalSettings> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const { settings, issues } = normalizeGlobalSettings(JSON.parse(raw), defaults());
    for (const issue of issues) {
      console.warn(`Settings file contained invalid data; using fallback value: ${issue}`);
    }
    if (issues.length > 0) {
      await saveSettings(settingsPath, settings);
    }
    return settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Settings file was unreadable; using defaults: ${(error as Error).message}`);
    }

    const settings = defaults();
    await saveSettings(settingsPath, settings);
    return settings;
  }
}

export async function saveSettings(settingsPath: string, settings: GlobalSettings): Promise<void> {
  const normalized = normalizeGlobalSettings(settings, defaults()).settings;
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
