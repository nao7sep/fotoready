import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PathVariableError, resolveConfiguredPath } from "./configured-path";

// Resolves the single storage root per the storage-path conventions. The root
// is the FOTOREADY_DATA_DIR override when it is set and non-empty (its value is
// expanded for `~` and environment references, then made absolute against the
// HOME directory — never the working directory), otherwise the default
// `~/.fotoready`. An override that cannot be created/used is a reported startup
// error, never a silent fallback to the default.
//
// This module is deliberately free of any Electron import so the resolver can be
// exercised directly in tests by setting FOTOREADY_DATA_DIR, which is the one
// supported relocation seam.

const DATA_DIR_ENV_VAR = "FOTOREADY_DATA_DIR";

/**
 * The override expanded and made absolute against the HOME directory through the
 * shared configured-path resolver. A reference to an unset or empty variable is a
 * hard startup error naming it: a literal `$VAR` kept in the path would create a
 * directory literally named `$VAR`, and an empty one could collapse the root onto
 * the bare home directory.
 */
function expandOverride(value: string, homeDir: string): string {
  try {
    return path.resolve(resolveConfiguredPath(value, homeDir));
  } catch (error) {
    if (!(error instanceof PathVariableError)) throw error;
    throw new Error(
      `${DATA_DIR_ENV_VAR} is set to "${value}" but references the environment ` +
        `variable "${error.variable}", which is not set or is empty. Set "${error.variable}", point ` +
        `${DATA_DIR_ENV_VAR} at a usable directory, or unset it to use the ` +
        `default storage root.`,
      { cause: error }
    );
  }
}

/**
 * Resolve the storage root, honoring FOTOREADY_DATA_DIR. A relative override is made
 * absolute against the HOME directory (never `process.cwd()`); the default root
 * is `<homeDir>/<defaultDirName>`. The chosen root and its standard subdirs are
 * created (`mkdir -p`); if the root cannot be created or is not a usable
 * directory, this throws a clear startup error and does not fall back.
 */
export function resolveStorageRoot(
  defaultDirName: string,
  subDirs: readonly string[] = []
): string {
  const homeDir = os.homedir();
  const override = process.env[DATA_DIR_ENV_VAR];
  const trimmed = typeof override === "string" ? override.trim() : "";

  let root: string;
  let fromOverride = false;
  if (trimmed.length > 0) {
    fromOverride = true;
    root = expandOverride(trimmed, homeDir);
  } else {
    root = path.join(homeDir, defaultDirName);
  }

  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      throw new Error(`path exists but is not a directory: ${root}`);
    }
    for (const sub of subDirs) {
      fs.mkdirSync(path.join(root, sub), { recursive: true });
    }
    tightenRootPermissions(root);
  } catch (error) {
    const source = fromOverride ? `${DATA_DIR_ENV_VAR} (${override})` : "default storage root";
    throw new Error(
      `Failed to create or use the FotoReady storage root from ${source} at "${root}": ${(error as Error).message}`,
      { cause: error }
    );
  }

  return root;
}

/**
 * Tightens the storage root to owner-only (0700) when an existing root is
 * broader — `mkdirSync`'s `mode` only applies to a freshly created directory
 * and is masked by umask, so a pre-existing 0755 root (or one created before
 * this check existed) would otherwise stay group/other-readable, letting
 * accounts that cannot read the app's own data read its derived logs and
 * caches. POSIX only; Windows uses its own permission model. A failure to
 * tighten is logged and never stops the app.
 */
function tightenRootPermissions(root: string): void {
  if (process.platform === "win32") return;
  try {
    const mode = fs.statSync(root).mode;
    if ((mode & 0o077) !== 0) {
      fs.chmodSync(root, 0o700);
    }
  } catch (error) {
    console.error(`Failed to tighten permissions on the FotoReady storage root "${root}":`, error);
  }
}
