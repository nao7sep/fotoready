// The identity header every FotoReady file carries (file-identity-conventions): `format` says what
// the file is and `writer` which program and release wrote it. A JSON file holds them as its first
// two keys, a SQLite store as `PRAGMA user_version` and its `file_header` table.
//
// The records worker loads this module under Node's own TypeScript stripping in the tests, so it
// imports nothing and uses only erasable syntax.

/** The product every FotoReady file belongs to. */
export const FILE_OWNER = "fotoready";

/** Each kind of file FotoReady owns, with the format version this build reads and writes. */
export const FILE_FORMATS = {
  /** `config.json`. */
  config: 1,
  /** `state.json`. */
  state: 1,
  /** `api-keys.json`. */
  apiKeys: 1,
  /** A task sidecar written beside a saved image. */
  sidecar: 1,
  /** `records.sqlite3`. */
  records: 1,
  /** `backups.sqlite3`. */
  backups: 1,
  /** The built-in stamps' `catalog.json`. */
  stampCatalog: 1
} as const;

export type FileKind = keyof typeof FILE_FORMATS;

/** The program and release that wrote a file; written for people, never read. */
export type FileWriter = { name: string; version: string };

/** A file on disk records a newer format than this build reads; it is left exactly as it is. */
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

export type FormatCheck = { kind: "current" } | { kind: "newer"; found: number } | { kind: "invalid"; error: Error };

/**
 * Checks a file's `format` against the kind its reader expects: an object whose `owner` and `kind`
 * are exactly FotoReady's and that kind, and whose `version` is a positive integer. A version above
 * this build's is newer. Other keys inside `format` are ignored, and `writer` is never looked at.
 */
export function checkFormat(format: unknown, kind: FileKind): FormatCheck {
  if (typeof format !== "object" || format === null || Array.isArray(format)) {
    return { kind: "invalid", error: new Error("The file has no format header.") };
  }
  const { owner, kind: found, version } = format as Record<string, unknown>;
  if (owner !== FILE_OWNER || found !== kind) {
    return { kind: "invalid", error: new Error(`The file is not a ${FILE_OWNER} ${kind} file.`) };
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { kind: "invalid", error: new Error("The file's format version is not a positive integer.") };
  }
  return version > FILE_FORMATS[kind] ? { kind: "newer", found: version } : { kind: "current" };
}

/** The `format` object a file of `kind` is written with. */
export function fileFormat(kind: FileKind): { owner: string; kind: FileKind; version: number } {
  return { owner: FILE_OWNER, kind, version: FILE_FORMATS[kind] };
}

export type HeaderedJsonRead =
  | { kind: "current"; body: Record<string, unknown> }
  | { kind: "newer"; found: number }
  | { kind: "invalid"; error: unknown };

/**
 * Parses a JSON file's text as `kind`. Text that is not a JSON object, or whose header is missing,
 * malformed or names another file, is invalid. `body` is the object without `format` and `writer`.
 * Never throws.
 */
export function parseHeaderedJson(text: string, kind: FileKind): HeaderedJsonRead {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (error) {
    return { kind: "invalid", error };
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return { kind: "invalid", error: new Error("The file is not a JSON object.") };
  }
  const { format, writer: _writer, ...body } = root as Record<string, unknown>;
  const check = checkFormat(format, kind);
  return check.kind === "current" ? { kind: "current", body } : check;
}

/** A JSON file's text: `format` and `writer` first, then `body`, with a trailing newline. */
export function headeredJson(kind: FileKind, writer: FileWriter, body: object): string {
  return `${JSON.stringify({ format: fileFormat(kind), writer: { name: writer.name, version: writer.version }, ...body }, null, 2)}\n`;
}
