/**
 * Pure mapping from a file's role to its entry path within the archive, which mirrors what
 * `~/.fotoready/` contains (see the data-backup conventions): every backed-up file keeps its real
 * relative path under the home root. fotoready has no external managed roots — config.json,
 * api-keys.json, and the luts/ and stamps/ trees all live under the home root — so the mapping is a
 * straight forward-slash normalization. All entry paths use forward slashes.
 */

/** Normalizes a filesystem-relative path to a forward-slash archive path. */
export function normalize(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** A file directly under `~/.fotoready/`: its relative path is the archive path (`config.json`,
 *  `luts/warm.cube`). */
export function forHomeFile(relativePath: string): string {
  return normalize(relativePath);
}
