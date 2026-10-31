import { DatabaseSync } from "node:sqlite";
import { checkFormat, FILE_FORMATS, FILE_OWNER, NewerFormatError, type FileKind, type FileWriter } from "../shared/file-header.ts";

// The identity header of the SQLite stores (file-identity-conventions): `PRAGMA user_version` holds
// the format version and the `file_header` table the rest. The store writer loads this module on its worker
// thread under Node's TypeScript stripping in the tests, so it imports only relative `.ts` files and
// uses only erasable syntax.

export class InvalidSqliteFormatError extends Error {
  constructor(file: string) {
    super(`${file} is not a FotoReady store this build reads.`);
    this.name = "InvalidSqliteFormatError";
  }
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

const HEADER_TABLE = "CREATE TABLE file_header (key TEXT PRIMARY KEY, value TEXT NOT NULL)";

/** The `format` the store's `file_header` rows and version describe, or null without that table. */
function recordedFormat(db: DatabaseSync, version: number): Record<string, unknown> | null {
  const table = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'file_header'").get();
  if (table === undefined) return null;
  const rows = db.prepare("SELECT key, value FROM file_header WHERE key IN ('format.owner', 'format.kind')").all() as { key: string; value: string }[];
  const value = (key: string): string | undefined => rows.find((row) => row.key === key)?.value;
  return { owner: value("format.owner"), kind: value("format.kind"), version };
}

/** Rewrites the writer rows, so the header names the build that has the store open for writing. */
function writeWriter(db: DatabaseSync, writer: FileWriter): void {
  db.exec("DELETE FROM file_header WHERE key LIKE 'writer.%'");
  const insert = db.prepare("INSERT INTO file_header (key, value) VALUES (?, ?)");
  insert.run("writer.name", writer.name);
  insert.run("writer.version", writer.version);
}

/**
 * Opens a store of `kind` and checks its header once, here; a session's writes do not check it again,
 * since only this process writes the store while it runs (single-instance lock). A database with no
 * tables and no version, whether new or left empty by an interrupted creation, gets `schema`, its
 * `file_header` and the version in one transaction. A newer store, or one without FotoReady's header
 * for `kind`, is refused, having written nothing; an admitted store's writer rows name this build.
 * The store writer's connection is the store's only one, so it sets no busy timeout.
 */
export function openSqliteStore(file: string, kind: FileKind, schema: string, writer: FileWriter): DatabaseSync {
  const supported = FILE_FORMATS[kind];
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const recorded = userVersion(db);
      const tables = (db.prepare("SELECT count(*) AS n FROM sqlite_schema").get() as { n: number }).n;
      if (recorded === 0 && tables === 0) {
        db.exec(schema);
        db.exec(HEADER_TABLE);
        const insert = db.prepare("INSERT INTO file_header (key, value) VALUES (?, ?)");
        insert.run("format.owner", FILE_OWNER);
        insert.run("format.kind", kind);
        db.exec(`PRAGMA user_version = ${supported}`);
      } else {
        const check = checkFormat(recordedFormat(db, recorded), kind);
        if (check.kind === "newer") throw new NewerFormatError(file, check.found, supported);
        if (check.kind === "invalid") throw new InvalidSqliteFormatError(file);
      }
      writeWriter(db, writer);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* Preserve the admission failure. */ }
      throw error;
    }
    return db;
  } catch (error) {
    try { db.close(); } catch { /* Preserve the admission failure. */ }
    throw error;
  }
}
