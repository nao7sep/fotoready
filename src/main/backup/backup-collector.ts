/**
 * Discovers what to back up by walking the app home root under `~/.fotoready/`: config.json,
 * api-keys.json, and the user-imported luts/ and stamps/ trees, minus the exclude list. Produces the
 * stat'd candidates for {@link selectChanged} and records a skip for any unreadable directory or file.
 * All I/O here is metadata only — directory walks and `stat`; file contents are read later, when a
 * changed file is archived.
 *
 * fotoready has no external managed roots (bundled LUTs/stamps live in packaged resources, outside the
 * home root, so they never appear in the walk) — only the one home-root tree is walked.
 */
import fs from "node:fs";
import path from "node:path";
import { forHomeFile, normalize } from "./archive-paths";
import { isExcludedDir, isExcludedFile } from "./home-root-exclusions";
import { truncateToSecondMs } from "./backup-time";
import type { BackupCandidate, BackupSkip } from "./backup-types";

export interface CollectedRoots {
  candidates: BackupCandidate[];
  skips: BackupSkip[];
}

/** Walks `homeRoot`, pruning the excluded `backups/` and `logs/` subtrees, and yields the deduplicated
 *  candidate set. */
export async function collectRoots(homeRoot: string): Promise<CollectedRoots> {
  const candidates: BackupCandidate[] = [];
  const skips: BackupSkip[] = [];
  await walk(homeRoot, homeRoot, skips, async (fullPath, relative) => {
    if (!isExcludedFile(relative)) {
      await addCandidate(candidates, skips, fullPath, forHomeFile(relative));
    }
  }, (relativeDir) => isExcludedDir(relativeDir));
  return { candidates: dedupeByFold(candidates, skips), skips };
}

/**
 * Recursively yields each file under `root` (relative path forward-slash normalized), skipping any
 * subdirectory the optional `pruneDir` predicate rejects. An unreadable directory is a logged skip, not a
 * throw, so the rest of the tree is still captured.
 */
async function walk(
  root: string,
  dir: string,
  skips: BackupSkip[],
  onFile: (fullPath: string, relative: string) => Promise<void>,
  pruneDir?: (relativeDir: string) => boolean,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    skips.push({ path: dir, reason: `could not enumerate: ${errorMessage(err)}` });
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = normalize(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      if (!pruneDir?.(relative)) {
        await walk(root, fullPath, skips, onFile, pruneDir);
      }
    } else if (entry.isFile()) {
      await onFile(fullPath, relative);
    }
  }
}

async function addCandidate(
  candidates: BackupCandidate[],
  skips: BackupSkip[],
  sourcePath: string,
  archivePath: string,
): Promise<void> {
  try {
    const stat = await fs.promises.stat(sourcePath);
    candidates.push({
      sourcePath,
      archivePath,
      sizeBytes: stat.size,
      mtimeMs: truncateToSecondMs(stat.mtimeMs),
    });
  } catch (err) {
    skips.push({ path: sourcePath, reason: `could not stat: ${errorMessage(err)}` });
  }
}

/**
 * Enforces case-insensitive entry uniqueness (data-backup conventions): a zip and a later manual unzip
 * on a case-insensitive filesystem cannot hold two entries that fold to the same path, so if two
 * candidates collide under case folding we keep the first and record the rest as skips. On a normal
 * tree nothing collides and this is a no-op.
 */
function dedupeByFold(candidates: BackupCandidate[], skips: BackupSkip[]): BackupCandidate[] {
  const seen = new Map<string, string>();
  const kept: BackupCandidate[] = [];
  for (const candidate of candidates) {
    const fold = candidate.archivePath.toLowerCase();
    const existing = seen.get(fold);
    if (existing !== undefined) {
      skips.push({
        path: candidate.archivePath,
        reason: `case-insensitive archive path collision with ${existing}`,
      });
      continue;
    }
    seen.set(fold, candidate.archivePath);
    kept.push(candidate);
  }
  return kept;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
