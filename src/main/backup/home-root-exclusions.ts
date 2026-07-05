/**
 * The optimistic exclude list for the `~/.fotoready/` home root: everything under the root is backed up
 * except the entries here. Pure, so the "did we pick the right files?" decision is unit-testable.
 *
 * Captured is the user's own work-product: config.json and any other durable managed data. Excluded are:
 *   - `backups/` — the feature's own output; capturing it would recurse.
 *   - `logs/` — recreatable session logs.
 *   - `luts/`, `stamps/` — imported instruments (tools that produce output), not user work-product.
 *   - `state.json` — volatile UI state (window geometry, panel visibility); it changes on nearly every
 *     session and is harmless to lose, so capturing it would emit a near-worthless backup on almost
 *     every launch and defeat the skip-empty property.
 *   - `api-keys.json` — a secret; not part of the backed-up work-product.
 *   - `*.tmp` — atomic-write temporaries (`<stem>-<nanoid>.tmp`).
 *   - `*.invalid` — the `<stem>-<stamp>.invalid` quarantine copies fotoready writes when a managed
 *     file fails to parse (settings-io.ts, state-io.ts, adapters/api-keys.ts); throwaway, not backed up.
 *   - `.DS_Store`, `Thumbs.db` — OS directory-metadata droppings that appear anywhere in the tree.
 * Paths are the forward-slash relative path under the root.
 */
import { normalize } from "./archive-paths";

const EXCLUDED_DIRS = ["backups", "logs", "luts", "stamps"];
const EXCLUDED_FILES = new Set(["state.json", "api-keys.json"]);
// OS/file-manager metadata that appears under the root just from browsing it (the fleet floor); matched
// against the lowercased base name so `Desktop.ini`/`thumbs.db` etc. all match, case-insensitively.
const EXCLUDED_BASENAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/** True when a home-root file must not be backed up. */
export function isExcludedFile(relativePath: string): boolean {
  const path = normalize(relativePath);
  if (path.toLowerCase().endsWith(".tmp")) return true;
  if (path.toLowerCase().endsWith(".invalid")) return true;
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
