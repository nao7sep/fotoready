import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Resolves the single storage root per the storage-path conventions. The root
// is the FOTOREADY_HOME override when it is set and non-empty (its value is
// expanded for `~` and environment references, then made absolute against the
// HOME directory — never the working directory), otherwise the default
// `~/.fotoready`. An override that cannot be created/used is a reported startup
// error, never a silent fallback to the default.
//
// This module is deliberately free of any Electron import so the resolver can be
// exercised directly in tests by setting FOTOREADY_HOME, which is the one
// supported relocation seam.

const HOME_ENV_VAR = "FOTOREADY_HOME";

/**
 * Expand a leading `~`/`~/` against the home directory and any `$VAR` / `%VAR%`
 * environment references. Used for the override value only; the default root is
 * built directly from `os.homedir()`.
 *
 * A reference to an environment variable that is not set is a hard startup
 * error, matching the fleet reference shape (mumbler/tapebox): a literal
 * `$VAR` kept in the path would be a silent misconfiguration — the app would
 * create a directory literally named `$VAR` — and the storage-path-conventions
 * require an override that does not resolve to a usable directory to be a
 * reported startup error, never a silent fallback of any shape. A variable set
 * to the empty string expands to "" (shell-like); if the whole value then
 * collapses to empty, the caller's empty-expansion check reports it.
 */
function expandHome(value: string, homeDir: string): string {
  let expanded = value;
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = path.join(homeDir, expanded.slice(2));
  }
  expanded = expanded.replace(/\$(\w+)|\$\{(\w+)\}|%(\w+)%/g, (_match, a, b, c) => {
    const name = (a ?? b ?? c) as string;
    const env = process.env[name];
    if (env === undefined) {
      throw new Error(
        `${HOME_ENV_VAR} is set to "${value}" but references the environment ` +
          `variable "${name}", which is not set. Set "${name}", point ` +
          `${HOME_ENV_VAR} at a usable directory, or unset it to use the ` +
          `default storage root.`
      );
    }
    return env;
  });
  return expanded;
}

/**
 * Resolve the storage root, honoring FOTOREADY_HOME. A relative override is made
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
  const override = process.env[HOME_ENV_VAR];
  const trimmed = typeof override === "string" ? override.trim() : "";

  let root: string;
  let fromOverride = false;
  if (trimmed.length > 0) {
    fromOverride = true;
    const expanded = expandHome(trimmed, homeDir);
    // An override that is set but expands to nothing — a `$VAR`/`%VAR%`
    // reference to a variable that is itself set to the empty string, say —
    // must never silently collapse the root onto the bare home directory
    // (path.resolve(homeDir, "") === homeDir). This is a reported startup
    // error, never a silent fallback, per the storage-path-conventions.
    if (expanded.trim().length === 0) {
      throw new Error(
        `${HOME_ENV_VAR} is set to "${override}" but expands to an empty path ` +
          `(a $VAR/%VAR% reference set to an empty string?). Set it to a usable ` +
          `directory, or unset it to use the default storage root.`
      );
    }
    root = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(homeDir, expanded);
  } else {
    root = path.join(homeDir, defaultDirName);
  }

  try {
    fs.mkdirSync(root, { recursive: true });
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      throw new Error(`path exists but is not a directory: ${root}`);
    }
    for (const sub of subDirs) {
      fs.mkdirSync(path.join(root, sub), { recursive: true });
    }
  } catch (error) {
    const source = fromOverride ? `${HOME_ENV_VAR} (${override})` : "default storage root";
    throw new Error(
      `Failed to create or use the FotoReady storage root from ${source} at "${root}": ${(error as Error).message}`,
      { cause: error }
    );
  }

  return root;
}
