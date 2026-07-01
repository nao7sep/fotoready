/**
 * The optimistic exclude list for the `~/.fotoready/` home root: everything under the root is backed up
 * except the entries here. Pure, so the "did we pick the right files?" decision is unit-testable.
 *
 * Captured like any durable file: config.json, api-keys.json (a secret — backed up too, see the
 * data-backup conventions; the backups/ directory is 0700 so it is not downgraded), and the user's
 * imported luts/ and stamps/ trees. Excluded are:
 *   - `backups/` — the feature's own output; capturing it would recurse.
 *   - `logs/` — recreatable session logs.
 *   - `state.json` — volatile UI state (window geometry, panel visibility); it changes on nearly every
 *     session and is harmless to lose, so capturing it would emit a near-worthless backup on almost
 *     every launch and defeat the skip-empty property.
 *   - `*.tmp` — atomic-write temporaries (and the `.<name>.<n>.invalid` quarantine copies are matched
 *     by neither, so they are captured; harmless and rare).
 *   - `.DS_Store`, `Thumbs.db` — OS directory-metadata droppings that appear anywhere in the tree.
 * Paths are the forward-slash relative path under the root.
 */
import { normalize } from "./archive-paths";

const EXCLUDED_DIRS = ["backups", "logs"];
const EXCLUDED_FILES = new Set(["state.json"]);
// OS/file-manager metadata that appears under the root just from browsing it (the fleet floor); matched
// against the lowercased base name so `Desktop.ini`/`thumbs.db` etc. all match, case-insensitively.
const EXCLUDED_BASENAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/** True when a home-root file must not be backed up. */
export function isExcludedFile(relativePath: string): boolean {
  const path = normalize(relativePath);
  if (path.toLowerCase().endsWith(".tmp")) return true;
  if (EXCLUDED_FILES.has(path)) return true;
  const basename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (EXCLUDED_BASENAMES.has(basename)) return true;
  return EXCLUDED_DIRS.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/** True when a home-root subdirectory should be pruned (not descended into) during the walk. */
export function isExcludedDir(relativeDirPath: string): boolean {
  const path = normalize(relativeDirPath);
  return EXCLUDED_DIRS.includes(path);
}
