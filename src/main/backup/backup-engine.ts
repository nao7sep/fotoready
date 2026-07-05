/**
 * Runs one backup pass and returns a {@link BackupReport}. It never throws for an expected problem (a
 * fatal error is captured in the report) and never logs — the caller logs the report. See the data-backup
 * conventions: change is size + mtime, the archive mirrors `~/.fotoready/`, and the archive is written and
 * renamed into place *before* the index so a crash never records a phantom backup.
 */
import fs from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import { nanoid } from "nanoid";
import { utcStamp } from "@shared/time";
import { atomicWriteFile } from "@adapters/atomic-file";
import { collectRoots } from "./backup-collector";
import { selectChanged } from "./backup-plan";
import { toIsoSeconds } from "./backup-time";
import type { BackupCandidate, BackupIndex, BackupPaths, BackupReport, BackupSkip } from "./backup-types";

/** Captures everything changed since the last run. `now` is a parameter so the archive stamp is
 *  deterministic under test. */
export async function runBackup(paths: BackupPaths, now: Date): Promise<BackupReport> {
  try {
    return await runCore(paths, now);
  } catch (fatal) {
    return { nothingChanged: false, filesArchived: 0, skips: [], indexWasReset: false, fatal };
  }
}

async function runCore(paths: BackupPaths, now: Date): Promise<BackupReport> {
  const { index, indexWasReset } = await loadIndex(paths.indexPath);
  const { candidates, skips } = await collectRoots(paths.homeRoot);

  const changed = selectChanged(candidates, index);
  if (changed.length === 0) {
    return { nothingChanged: true, filesArchived: 0, skips, indexWasReset };
  }

  const { archived, archivedAt, archiveFileName } = await writeArchive(paths.backupsDir, now, changed, skips);
  if (archived.length === 0) {
    // Every changed file vanished before it could be archived; nothing was written, nothing is recorded.
    return { nothingChanged: true, filesArchived: 0, skips, indexWasReset };
  }

  for (const item of archived) {
    index.entries.push({
      archivedAt,
      archivePath: item.archivePath,
      sizeBytes: item.sizeBytes,
      lastWriteUtc: toIsoSeconds(item.mtimeMs),
    });
  }
  // Index second: the archive is already in place, so a crash here just re-captures next run.
  await atomicWriteFile(paths.indexPath, `${JSON.stringify(index, null, 2)}\n`);

  return { nothingChanged: false, archiveFileName, filesArchived: archived.length, skips, indexWasReset };
}

async function loadIndex(indexPath: string): Promise<{ index: BackupIndex; indexWasReset: boolean }> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(indexPath, "utf-8");
  } catch (err) {
    // Absent index (first run, or freshly relocated root) is normal: back up everything.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { index: { entries: [] }, indexWasReset: false };
    }
    // Unreadable for another reason — treat as reset (full backup) rather than fail the run.
    return { index: { entries: [] }, indexWasReset: true };
  }

  try {
    const parsed = JSON.parse(raw) as BackupIndex;
    if (!parsed || !Array.isArray(parsed.entries)) throw new Error("malformed index");
    return { index: { entries: parsed.entries }, indexWasReset: false };
  } catch {
    // A corrupt index is deleted and treated as empty: the run becomes a full backup, costing one
    // redundant archive, never data.
    await tryDelete(indexPath);
    return { index: { entries: [] }, indexWasReset: true };
  }
}

/** Streams the changed files to a temp zip and renames it into place, returning the files that were
 *  actually archived (a file that vanished since collection is skipped, not recorded) alongside the
 *  stamp and archive name that won. `now` seeds the stamp; on a name collision (a no-clobber create) it
 *  is advanced one millisecond at a time — keeping the same Date instant, re-formatted via {@link
 *  utcStamp} — until a free name is found, and the winning stamp is what the caller records in the
 *  index, so the zip stays derivable from `archivedAt`. */
async function writeArchive(
  backupsDir: string,
  now: Date,
  changed: readonly BackupCandidate[],
  skips: BackupSkip[],
): Promise<{ archived: BackupCandidate[]; archivedAt: string; archiveFileName: string }> {
  const dir = await ensureBackupsDir(backupsDir);
  let stamp = now;
  let archivedAt = utcStamp(stamp);
  let archiveFileName = `backup-${archivedAt}.zip`;
  // <stem>-<nanoid>.tmp, alongside the target archive (derived-filename grammar).
  const tempPath = path.join(dir, `${path.parse(archiveFileName).name}-${nanoid(8)}.tmp`);

  const zip = new yazl.ZipFile();
  const archived: BackupCandidate[] = [];
  for (const item of changed) {
    if (!fs.existsSync(item.sourcePath)) {
      skips.push({ path: item.archivePath, reason: "vanished before archive" });
      continue;
    }
    zip.addFile(item.sourcePath, item.archivePath);
    archived.push(item);
  }
  if (archived.length === 0) {
    return { archived, archivedAt, archiveFileName };
  }

  zip.end();
  try {
    await pipeline(zip.outputStream, createWriteStream(tempPath));
    // No-clobber create: before the final move, if another run already claimed this exact millisecond,
    // advance to the next free one and use it for both the zip name and the index records.
    let finalPath = path.join(dir, archiveFileName);
    while (fs.existsSync(finalPath)) {
      stamp = new Date(stamp.getTime() + 1);
      archivedAt = utcStamp(stamp);
      archiveFileName = `backup-${archivedAt}.zip`;
      finalPath = path.join(dir, archiveFileName);
    }
    await fs.promises.rename(tempPath, finalPath);
  } catch (err) {
    await tryDelete(tempPath);
    throw err;
  }
  return { archived, archivedAt, archiveFileName };
}

async function ensureBackupsDir(backupsDir: string): Promise<string> {
  await fs.promises.mkdir(backupsDir, { recursive: true });
  return backupsDir;
}

async function tryDelete(target: string): Promise<void> {
  try {
    await fs.promises.rm(target, { force: true });
  } catch {
    // best effort: a leftover temp is harmless and lives under the excluded backups/ directory
  }
}
