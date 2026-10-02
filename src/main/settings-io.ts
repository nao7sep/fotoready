import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultGlobalSettings, SETTINGS_KEYS } from "@shared/defaults";
import type { GlobalSettings, MetadataFields } from "@shared/types/settings";
import { normalizeGlobalSettings } from "@shared/validation/settings";
import { isRecord } from "@shared/validation/common";
import { cleanMetadataField, multiline, singleLine } from "@shared/text-cleanup";
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

const MULTILINE_SETS: ReadonlySet<keyof GlobalSettings> = new Set(["visionDescriptionPrompt", "visionSlugPrompt"]);
const MODEL_ID_SETS: ReadonlySet<keyof GlobalSettings> = new Set(["gemini.description", "gemini.slug"]);

/**
 * The text-cleanup form a set is compared and stored in: multiline for the prompts, single-line for
 * other text. An empty metadata member is dropped, since an empty default injects nothing.
 */
function cleanSet(key: keyof GlobalSettings, value: unknown): unknown {
  if (typeof value === "string") return MULTILINE_SETS.has(key) ? multiline(value) : singleLine(value);
  if (key === "injectFields" && isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .map(([field, text]) => [field, typeof text === "string" ? cleanMetadataField(field as keyof MetadataFields, text) : text])
      .filter(([, text]) => text !== ""));
  }
  return value;
}

function equalsBuiltIn<K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K], builtIn: GlobalSettings[K]): boolean {
  if (MODEL_ID_SETS.has(key)) return String(value).toLowerCase() === String(builtIn).toLowerCase();
  return JSON.stringify(value) === JSON.stringify(builtIn);
}

/**
 * Writes the sets in `patch` and decides each one alone: a set equal to its built-in after cleanup
 * has its key removed, a set that differs is written whole, and an invalid set is reported and
 * leaves its stored copy untouched. A stored copy outside the patch that equals its built-in is
 * removed too. A result equal to the file writes nothing, so a missing file stays missing; a file
 * whose every set is back at its built-in holds `{}`.
 */
export async function saveSettings(
  settingsPath: string,
  patch: Partial<GlobalSettings>,
  logger?: AppLogger
): Promise<GlobalSettings> {
  const { sets } = await readSettingsMap(settingsPath, logger);
  const builtIns = defaults();
  const next: Record<string, unknown> = {};
  // The valid sets decided so far, in key order, so a set whose check or built-in follows another
  // set (a role's Thinking follows its model) is decided against that set's outcome.
  const decided: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) {
    const stored = Object.hasOwn(sets, key);
    const patched = Object.hasOwn(patch, key);
    if (!stored && !patched) continue;
    const { settings: parsed, issues } = normalizeGlobalSettings({ ...decided, [key]: cleanSet(key, patched ? patch[key] : sets[key]) }, builtIns);
    if (issues.length) {
      if (patched) for (const issue of issues) logger?.warn("settings patch contained invalid data; its stored copy is unchanged", { mod: "settings", issue });
      if (stored) next[key] = sets[key];
      continue;
    }
    const builtIn = normalizeGlobalSettings(decided, builtIns).settings[key];
    decided[key] = parsed[key];
    if (!equalsBuiltIn(key, parsed[key], builtIn)) {
      next[key] = patched ? parsed[key] : sets[key];
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(sets)) {
    // recorded: durable config sets use the managed atomic write and backup history.
    await writeManagedFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return effectiveSettings(next, logger);
}
