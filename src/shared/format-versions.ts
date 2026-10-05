// Each store's own format version (store-recovery-conventions). A JSON store records it as its
// top-level `formatVersion`, a SQLite store as `PRAGMA user_version`.
//
// The records worker loads this module under Node's own TypeScript stripping in the tests, so it
// imports nothing and uses only erasable syntax.

export const FORMAT_VERSIONS = {
  /** `config.json`. */
  config: 1,
  /** `state.json`. */
  state: 1,
  /** `api-keys.json`. */
  apiKeys: 1,
  /** A task sidecar written beside a saved image. */
  taskSidecar: 1,
  /** `records.sqlite3`. */
  records: 1,
  /** `backups.sqlite3`. */
  backups: 1
} as const;

export const FORMAT_VERSION_KEY = "formatVersion";

/** A store on disk records a newer format than this build reads; it is left exactly as it is. */
export class NewerFormatError extends Error {
  readonly filePath: string;
  readonly found: number;
  readonly supported: number;

  constructor(filePath: string, found: number, supported: number) {
    super(`${filePath} records format version ${found}; this build reads up to ${supported}.`);
    this.name = "NewerFormatError";
    this.filePath = filePath;
    this.found = found;
    this.supported = supported;
  }
}

export type VersionedJsonRead =
  | { kind: "current"; body: Record<string, unknown> }
  | { kind: "newer"; found: number }
  | { kind: "invalid"; error: unknown };

/**
 * Parses a JSON store's text against the format version this build writes. A missing marker reads
 * as 1; a marker that is not a positive integer, or text that is not a JSON object, is invalid.
 * `body` is the object without its marker. Never throws.
 */
export function parseVersionedJson(text: string, supported: number): VersionedJsonRead {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (error) {
    return { kind: "invalid", error };
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return { kind: "invalid", error: new Error("The file is not a JSON object.") };
  }
  const { [FORMAT_VERSION_KEY]: marker = 1, ...body } = root as Record<string, unknown>;
  if (typeof marker !== "number" || !Number.isInteger(marker) || marker < 1) {
    return { kind: "invalid", error: new Error(`${FORMAT_VERSION_KEY} is not a positive integer.`) };
  }
  return marker > supported ? { kind: "newer", found: marker } : { kind: "current", body };
}

/** A JSON store's text: its format version first, then `body`, with a trailing newline. */
export function versionedJson(version: number, body: object): string {
  return `${JSON.stringify({ [FORMAT_VERSION_KEY]: version, ...body }, null, 2)}\n`;
}
