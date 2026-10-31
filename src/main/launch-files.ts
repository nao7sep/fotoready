import { checkApiKeysFile } from "@adapters/api-keys";
import { LaunchRefusedError, RefusedFileError, refusalOf } from "@adapters/json-store";
import type { AppPaths } from "./paths";
import { readSettingsFile, type SettingsFile } from "./settings-io";
import { isNewerSqliteStore } from "./sqlite-format-version";

/**
 * Checks every file FotoReady opens to start, before anything is written (store-recovery-conventions,
 * What a refused file does). Settings and the key file stop startup when they are newer or cannot be
 * read; `state.json`, `records.sqlite3` and `backups.sqlite3` stop it only when a newer FotoReady
 * wrote them, since unreadable state takes defaults and an unreadable side store is switched off.
 * Throws {@link LaunchRefusedError} naming every refused file; otherwise returns the settings file.
 */
export async function readLaunchFiles(paths: Pick<AppPaths, "settingsPath" | "apiKeysPath" | "statePath" | "recordsPath" | "backupsPath">): Promise<SettingsFile> {
  const refused: RefusedFileError[] = [];
  let settingsFile: SettingsFile | null = null;
  try {
    settingsFile = await readSettingsFile(paths.settingsPath);
  } catch (error) {
    if (!(error instanceof RefusedFileError)) throw error;
    refused.push(error);
  }
  const keys = await checkApiKeysFile(paths.apiKeysPath);
  if (keys) refused.push(keys);
  if (await refusalOf(paths.statePath, "state") === "newer") refused.push(new RefusedFileError(paths.statePath, "newer"));
  if (isNewerSqliteStore(paths.recordsPath, "records")) refused.push(new RefusedFileError(paths.recordsPath, "newer"));
  if (isNewerSqliteStore(paths.backupsPath, "backups")) refused.push(new RefusedFileError(paths.backupsPath, "newer"));
  if (refused.length > 0 || settingsFile === null) throw new LaunchRefusedError(refused);
  return settingsFile;
}
