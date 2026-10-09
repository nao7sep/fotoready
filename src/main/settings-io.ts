import fs from "node:fs/promises";
import os from "node:os";
import { AI_ROLES, defaultMediaResolutionFor, defaultThinkingFor } from "@shared/ai-models";
import { defaultGlobalSettings, SETTINGS_KEYS } from "@shared/defaults";
import { FORMAT_VERSIONS, NewerFormatError, parseVersionedJson, UNMARKED_EARLIER_FORM, versionedJson } from "@shared/format-versions";
import type { GlobalSettings, MetadataFields } from "@shared/types/settings";
import { normalizeGlobalSettings } from "@shared/validation/settings";
import { isRecord } from "@shared/validation/common";
import { cleanMetadataField, multiline, singleLine } from "@shared/text-cleanup";
import { setAsideStore, StoreNotWritableError } from "@adapters/json-store";
import { writeManagedFile } from "./write-managed-file";
import type { AppLogger } from "./logger";

function defaults(): GlobalSettings {
  return defaultGlobalSettings(null);
}

export function resolveWorkerPoolSize(workerPoolSize: number | null): number {
  return workerPoolSize ?? Math.min(8, os.cpus().length);
}

/** `config.json` as this session holds it. */
export type SettingsFile = {
  readonly path: string;
  /**
   * The sets as stored, invalid and unknown ones included: a save writes the user's changed sets over
   * this map, so nothing the user did not change is erased (developer decision).
   */
  stored: Record<string, unknown>;
  /** Whether load allowed this session to write the file; decided once, from the whole read. */
  readonly writable: boolean;
};

/** What startup tells the user about the settings file, once. */
export type SettingsNotice =
  | { kind: "setAside"; path: string }
  | { kind: "unreadable"; path: string };

export type SettingsLoadResult = {
  settings: GlobalSettings;
  file: SettingsFile;
  notice: SettingsNotice | null;
};

export class SettingsQuarantineError extends Error {
  constructor(readonly filePath: string, cause: unknown) {
    super("Unreadable settings could not be set aside and were left in place.", { cause });
    this.name = "SettingsQuarantineError";
  }
}

/**
 * Keys an earlier FotoReady stored that no build reads, dropped at the next save; every other
 * unknown key is kept. `model` was v0.1.0's one model id, now `gemini.description` and `gemini.slug`.
 */
const RETIRED_SETTINGS_KEYS: readonly string[] = ["model"];

/**
 * Store-recovery outcomes, decided once at load (developer decisions): a file that cannot be read
 * for access reasons is left in place, unwritten for the session and reported as such, never as
 * corruption; malformed content is set aside with one notice, and startup stops when that fails; a
 * newer file stops startup and is left exactly as it is. v0.1.0's unmarked file is read as it is.
 */
async function readSettingsFile(settingsPath: string, logger?: AppLogger): Promise<Omit<SettingsLoadResult, "settings">> {
  let text: string;
  try {
    text = await fs.readFile(settingsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { file: { path: settingsPath, stored: {}, writable: true }, notice: null };
    logger?.warn("settings file could not be read; using built-ins and leaving it as it is for this session", { mod: "settings", settingsPath, err: error });
    return { file: { path: settingsPath, stored: {}, writable: false }, notice: { kind: "unreadable", path: settingsPath } };
  }
  const read = parseVersionedJson(text, FORMAT_VERSIONS.config, UNMARKED_EARLIER_FORM);
  if (read.kind === "current") return { file: { path: settingsPath, stored: read.body, writable: true }, notice: null };
  if (read.kind === "newer") throw new NewerFormatError(settingsPath, read.found, FORMAT_VERSIONS.config);
  let setAsidePath: string;
  // not recorded: preserve the unreadable bytes; no replacement config is seeded.
  try { setAsidePath = await setAsideStore(settingsPath); } catch (cause) { throw new SettingsQuarantineError(settingsPath, cause); }
  logger?.warn("settings file was unreadable; using defaults", { mod: "settings", settingsPath, setAsidePath, err: read.error });
  return { file: { path: settingsPath, stored: {}, writable: true }, notice: { kind: "setAside", path: setAsidePath } };
}

function effectiveSettings(sets: Record<string, unknown>, logger?: AppLogger): GlobalSettings {
  const { settings, issues } = normalizeGlobalSettings(sets, defaults());
  for (const issue of issues) logger?.warn("settings set contained invalid data; using its built-in", { mod: "settings", issue });
  return settings;
}

/**
 * Throws {@link NewerFormatError} when a newer build wrote the file and {@link SettingsQuarantineError}
 * when malformed content could not be set aside.
 */
export async function loadSettings(settingsPath: string, logger?: AppLogger): Promise<SettingsLoadResult> {
  const read = await readSettingsFile(settingsPath, logger);
  return { settings: effectiveSettings(read.file.stored, logger), ...read };
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

/** The built-ins `settings` is compared with; a role's Thinking and image resolution built-ins follow the role's model. */
function builtInsFor(settings: GlobalSettings): GlobalSettings {
  const builtIns = defaults();
  for (const role of AI_ROLES) builtIns[`gemini.thinking.${role.id}`] = defaultThinkingFor("gemini", settings[`gemini.${role.id}`]);
  builtIns["gemini.mediaResolution.description"] = defaultMediaResolutionFor("gemini", settings["gemini.description"]);
  return builtIns;
}

/**
 * Saves the sets the user changed (config-sets-conventions). A changed set equal to its built-in is
 * removed so it follows the built-in; every set the user did not change keeps its stored value, valid
 * or not, as do unknown keys, except {@link RETIRED_SETTINGS_KEYS}. An invalid set is reported and
 * keeps its value from `previous`. Throws {@link StoreNotWritableError} when load left the file as it is.
 */
export async function saveSettings(
  file: SettingsFile,
  settings: unknown,
  previous: GlobalSettings,
  logger?: AppLogger
): Promise<GlobalSettings> {
  if (!file.writable) throw new StoreNotWritableError(file.path, "unreadable");
  const cleaned = isRecord(settings)
    ? Object.fromEntries(SETTINGS_KEYS.map((key) => [key, cleanSet(key, settings[key])]))
    : settings;
  const { settings: effective, issues } = normalizeGlobalSettings(cleaned, previous);
  for (const issue of issues) logger?.warn("settings contained invalid data; its previous value is kept", { mod: "settings", issue });
  const builtIns = builtInsFor(effective);
  const next = { ...file.stored };
  for (const key of RETIRED_SETTINGS_KEYS) delete next[key];
  for (const key of SETTINGS_KEYS) {
    // Compared in cleaned form, so a stored value that differs only by cleanup is not taken as changed.
    if (JSON.stringify(effective[key]) === JSON.stringify(cleanSet(key, previous[key]))) continue;
    if (equalsBuiltIn(key, effective[key], builtIns[key])) delete next[key];
    else next[key] = effective[key];
  }
  // First run writes nothing while every set is at its built-in (config-sets-conventions).
  if (Object.keys(next).length === 0 && !(await fileExists(file.path))) return effective;
  // recorded: durable config sets use the managed atomic write and backup history.
  await writeManagedFile(file.path, versionedJson(FORMAT_VERSIONS.config, next));
  file.stored = next;
  return effective;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
