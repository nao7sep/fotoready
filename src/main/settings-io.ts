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

export type SettingsLoadResult = {
  settings: GlobalSettings;
  // Set when corrupt bytes were copied aside so startup can report the path.
  quarantinedTo: string | null;
};

// The load runs in two phases on purpose. Phase one CLASSIFIES the file and is the only
// part inside a try: reading and parsing are what legitimately fail in expected ways.
// Phase two ACTS on that classification, and the quarantine copy lives there — outside
// the catch — so a failed copy propagates instead of being re-read as "the file was
// unreadable" and falling through to a defaults reset over bytes that were never
// preserved (storage-path conventions: the quarantine either lands or its failure
// propagates). Collapsing these two phases back into one try is the bug this shape exists
// to prevent.
type SettingsClassification =
  | { kind: "ok"; settings: GlobalSettings }
  | { kind: "shape-invalid"; settings: GlobalSettings; issues: string[] }
  | { kind: "absent" }
  | { kind: "unreadable"; error: unknown };

export async function loadSettings(settingsPath: string, logger?: AppLogger): Promise<SettingsLoadResult> {
  let classified: SettingsClassification;
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const { settings, issues } = normalizeGlobalSettings(JSON.parse(raw), defaults());
    classified = issues.length > 0 ? { kind: "shape-invalid", settings, issues } : { kind: "ok", settings };
  } catch (error) {
    classified =
      (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable", error };
  }

  if (classified.kind === "ok") {
    return { settings: classified.settings, quarantinedTo: null };
  }

  if (classified.kind === "absent") {
    // First run: materialize the defaults, nothing to preserve.
    const settings = defaults();
    await saveSettings(settingsPath, settings);
    return { settings, quarantinedTo: null };
  }

  // Corrupt, either way. Preserve the bytes BEFORE the reset; a failure here propagates.
  const backupPath = await backupInvalidFile(settingsPath);
  const settings = classified.kind === "shape-invalid" ? classified.settings : defaults();
  if (classified.kind === "shape-invalid") {
    logger?.warn("settings file contained invalid data; using fallback values", { mod: "settings", settingsPath, backupPath, issues: classified.issues });
  } else {
    logger?.warn("settings file was unreadable; using defaults", { mod: "settings", settingsPath, backupPath, err: classified.error });
  }
  await saveSettings(settingsPath, settings);
  return { settings, quarantinedTo: backupPath };
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
  // The copy either lands or its failure propagates — swallowing it would let
  // the caller reset over the very bytes the copy exists to preserve
  // (storage-path conventions).
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}
