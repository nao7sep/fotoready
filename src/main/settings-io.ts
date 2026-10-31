import fs from "node:fs/promises";
import path from "node:path";
import { AI_ROLES, defaultMediaResolutionFor, defaultThinkingFor } from "@shared/ai-models";
import { defaultGlobalSettings, SETTINGS_KEYS } from "@shared/defaults";
import { headeredJson, parseHeaderedJson } from "@shared/file-header";
import { APP_WRITER } from "./app-writer";
import type { GlobalSettings, MetadataFields } from "@shared/types/settings";
import { normalizeGlobalSettings } from "@shared/validation/settings";
import { isRecord } from "@shared/validation/common";
import { cleanMetadataField, multiline, singleLine } from "@shared/text-cleanup";
import { RefusedFileError, refusalOf, StoreNotWritableError } from "@adapters/json-store";
import { writeManagedFile } from "./write-managed-file";
import type { AppLogger } from "./logger";

function defaults(): GlobalSettings {
  return defaultGlobalSettings();
}

/** `config.json` as this session holds it. */
export type SettingsFile = {
  readonly path: string;
  /**
   * The sets as stored, invalid and unknown ones included: a save writes the user's changed sets over
   * this map, so nothing the user did not change is erased.
   */
  stored: Record<string, unknown>;
};

export type SettingsLoadResult = {
  settings: GlobalSettings;
  file: SettingsFile;
};

/**
 * Reads `config.json` at launch. A missing file is first run. A file that cannot be read, has no
 * readable header, or that a newer FotoReady wrote,
 * is refused: {@link RefusedFileError} stops startup and the file is left exactly as it is
 * (store-recovery-conventions, What a refused file does).
 */
export async function readSettingsFile(settingsPath: string): Promise<SettingsFile> {
  let text: string;
  try {
    text = await fs.readFile(settingsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: settingsPath, stored: {} };
    throw new RefusedFileError(settingsPath, "unreadable", error);
  }
  const read = parseHeaderedJson(text, "config");
  if (read.kind === "newer") throw new RefusedFileError(settingsPath, "newer");
  if (read.kind === "invalid") throw new RefusedFileError(settingsPath, "unreadable", read.error);
  return { path: settingsPath, stored: read.body };
}

export function effectiveSettings(sets: Record<string, unknown>, logger?: AppLogger): GlobalSettings {
  const { settings, issues } = normalizeGlobalSettings(sets, defaults());
  for (const issue of issues) logger?.warn("settings set contained invalid data; using its built-in", { mod: "settings", issue });
  return settings;
}

/** The settings in effect and the file they came from; throws {@link RefusedFileError} as {@link readSettingsFile} does. */
export async function loadSettings(settingsPath: string, logger?: AppLogger): Promise<SettingsLoadResult> {
  const file = await readSettingsFile(settingsPath);
  return { settings: effectiveSettings(file.stored, logger), file };
}

const MULTILINE_SETS: ReadonlySet<keyof GlobalSettings> = new Set(["visionDescriptionPrompt", "visionSlugPrompt"]);
const PATH_SETS: ReadonlySet<keyof GlobalSettings> = new Set(["defaultOutputDirectory", "lutFolder", "stampFolder", "defaultWatermarkImage"]);
const MODEL_ID_SETS: ReadonlySet<keyof GlobalSettings> = new Set(["gemini.description", "gemini.slug"]);

/**
 * The text-cleanup form a set is compared and stored in: multiline for the prompts, single-line for
 * other text, preserving absolute filesystem references literally. An empty metadata member is dropped, since an empty default injects nothing.
 */
function cleanSet(key: keyof GlobalSettings, value: unknown): unknown {
  if (typeof value === "string") {
    // Native selections carry file identity: cleanup could select a different file or folder.
    if (PATH_SETS.has(key) && path.isAbsolute(value)) return value;
    return MULTILINE_SETS.has(key) ? multiline(value) : singleLine(value);
  }
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
 * or not, as do unknown keys. An invalid set is reported and
 * keeps its value from `previous`. Throws {@link StoreNotWritableError} when the file on disk is refused
 * now, so a save never replaces a file this build cannot read.
 */
export async function saveSettings(
  file: SettingsFile,
  settings: unknown,
  previous: GlobalSettings,
  logger?: AppLogger
): Promise<GlobalSettings> {
  const cleaned = isRecord(settings)
    ? Object.fromEntries(SETTINGS_KEYS.map((key) => [key, cleanSet(key, settings[key])]))
    : settings;
  const { settings: effective, issues } = normalizeGlobalSettings(cleaned, previous);
  for (const issue of issues) logger?.warn("settings contained invalid data; its previous value is kept", { mod: "settings", issue });
  const builtIns = builtInsFor(effective);
  const next = { ...file.stored };
  for (const key of SETTINGS_KEYS) {
    // Compared in cleaned form, so a stored value that differs only by cleanup is not taken as changed.
    if (JSON.stringify(effective[key]) === JSON.stringify(cleanSet(key, previous[key]))) continue;
    if (equalsBuiltIn(key, effective[key], builtIns[key])) delete next[key];
    else next[key] = effective[key];
  }
  // First run writes nothing while every set is at its built-in (config-sets-conventions).
  if (Object.keys(next).length === 0 && !(await fileExists(file.path))) return effective;
  const refused = await refusalOf(file.path, "config");
  if (refused) throw new StoreNotWritableError(file.path, refused);
  // recorded: durable config sets use the managed atomic write and backup history.
  await writeManagedFile(file.path, headeredJson("config", APP_WRITER, next));
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
