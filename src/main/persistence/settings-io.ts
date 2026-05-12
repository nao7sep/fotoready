import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultGlobalSettings } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";

function defaults(): GlobalSettings {
  return defaultGlobalSettings(Intl.DateTimeFormat().resolvedOptions().timeZone, Math.min(8, os.cpus().length));
}

export async function loadSettings(settingsPath: string): Promise<GlobalSettings> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    return { ...defaults(), ...JSON.parse(raw) } as GlobalSettings;
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
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}
