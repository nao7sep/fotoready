import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultGlobalSettings, SETTINGS_KEYS } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";
import { normalizeGlobalSettings } from "@shared/validation/settings";
import { isRecord } from "@shared/validation/common";
import { utcStamp } from "@shared/time";
import { writeManagedFile } from "./write-managed-file";
import type { AppLogger } from "./logger";

function defaults(): GlobalSettings {
  return defaultGlobalSettings(null);
}

export function resolveWorkerPoolSize(workerPoolSize: number | null): number {
  return workerPoolSize ?? Math.min(8, os.cpus().length);
}

export type SettingsLoadResult = {
  settings: GlobalSettings;
  // Set when corrupt bytes were moved aside so startup can report the path.
  quarantinedTo: string | null;
};

// Classify read/parse failures first; quarantine outside the catch so its failure propagates.
async function readSettingsMap(settingsPath: string, logger?: AppLogger): Promise<{
  sets: Record<string, unknown>;
  quarantinedTo: string | null;
}> {
  let failure: unknown;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    if (!isRecord(parsed)) throw new Error("settings must be a JSON object.");
    return { sets: parsed, quarantinedTo: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sets: {}, quarantinedTo: null };
    failure = error;
  }
  const quarantinedTo = path.join(path.dirname(settingsPath), `${path.parse(settingsPath).name}-${utcStamp()}.invalid`);
  // not recorded: preserve the unreadable bytes; no replacement config is seeded.
  await fs.rename(settingsPath, quarantinedTo);
  logger?.warn("settings file was unreadable; using defaults", { mod: "settings", settingsPath, quarantinedTo, err: failure });
  return { sets: {}, quarantinedTo };
}

function effectiveSettings(sets: Record<string, unknown>, logger?: AppLogger): GlobalSettings {
  const { settings, issues } = normalizeGlobalSettings(sets, defaults());
  for (const issue of issues) logger?.warn("settings set contained invalid data; using its built-in", { mod: "settings", issue });
  return settings;
}

export async function loadSettings(settingsPath: string, logger?: AppLogger): Promise<SettingsLoadResult> {
  const { sets, quarantinedTo } = await readSettingsMap(settingsPath, logger);
  return { settings: effectiveSettings(sets, logger), quarantinedTo };
}

export async function saveSettings(
  settingsPath: string,
  patch: Partial<GlobalSettings>,
  resetKeys: (keyof GlobalSettings)[] = [],
  logger?: AppLogger
): Promise<GlobalSettings> {
  const { sets } = await readSettingsMap(settingsPath, logger);
  const { settings: normalizedPatch, issues } = normalizeGlobalSettings(patch, effectiveSettings(sets));
  for (const issue of issues) logger?.warn("settings patch contained invalid data", { mod: "settings", issue });
  const next: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) {
    if (Object.hasOwn(sets, key)) next[key] = sets[key];
    if (Object.hasOwn(patch, key)) next[key] = normalizedPatch[key];
    if (resetKeys.includes(key)) delete next[key];
  }
  // recorded: durable config sets use the managed atomic write and backup history.
  await writeManagedFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  return effectiveSettings(next, logger);
}
