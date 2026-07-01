/**
 * The startup edge for the data backup: runs one pass without blocking startup and logs the outcome. This
 * is the only place the feature logs; the pass itself ({@link runBackup}) does not. Best-effort — it never
 * blocks the window, shows an error, or crashes the app.
 *
 * Electron's main process is single-threaded, so "background" here means fire-and-forget async on the event
 * loop after the window is created: the renderer is a separate process, so this never blocks the UI's paint.
 */
import path from "node:path";
import type { AppPaths } from "../paths";
import type { AppLogger } from "../logger";
import { runBackup } from "./backup-engine";
import type { BackupPaths, BackupReport } from "./backup-types";

/** Derives the backup locations from the app paths: everything the feature writes lives under
 *  `~/.fotoready/backups/`, and the walk starts at the home root itself. */
export function resolveBackupPaths(paths: AppPaths): BackupPaths {
  const backupsDir = path.join(paths.dataDir, "backups");
  return {
    homeRoot: paths.dataDir,
    backupsDir,
    indexPath: path.join(backupsDir, "index.json"),
  };
}

/** Runs one backup pass in the background and logs its outcome. Fire-and-forget; never throws. */
export function runBackupInBackground(paths: AppPaths, logger: AppLogger): void {
  void runOnce(resolveBackupPaths(paths), logger);
}

async function runOnce(paths: BackupPaths, logger: AppLogger): Promise<void> {
  try {
    logReport(await runBackup(paths, new Date()), logger);
  } catch (err) {
    // The engine captures its own failures in the report; this is the final backstop so a bug here can
    // never surface to the user or take down the app.
    logger.error("backup: unexpected failure", { mod: "main.backup", err });
  }
}

function logReport(report: BackupReport, logger: AppLogger): void {
  for (const skip of report.skips) {
    logger.warn("backup: skipped a file", { mod: "main.backup", path: skip.path, reason: skip.reason });
  }

  if (report.indexWasReset) {
    logger.warn("backup: index was unreadable and reset; this run is a full backup", { mod: "main.backup" });
  }

  if (report.fatal !== undefined) {
    logger.error("backup: run failed", { mod: "main.backup", err: report.fatal });
    return;
  }

  if (report.nothingChanged) {
    logger.debug("backup: nothing changed, no archive written", { mod: "main.backup" });
    return;
  }

  logger.info("backup: archive written", {
    mod: "main.backup",
    archive: report.archiveFileName,
    files: report.filesArchived,
  });
}
