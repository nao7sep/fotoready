import type { DatabaseSync } from "node:sqlite";
import { NewerFormatError } from "../shared/format-versions.ts";

// A SQLite store's format version, kept in `PRAGMA user_version` (store-recovery-conventions). An
// unset one, 0, is a missing marker unless the database is still empty, as it is when just created.
//
// The records worker loads this module under Node's own TypeScript stripping in the tests, so its
// imports are relative and spelled with their extension.

/**
 * The recorded `user_version`, raw: 0 only for an empty database. Throws when a database with
 * tables records none, and {@link NewerFormatError} when it is newer than `supported`.
 */
function checkedUserVersion(db: DatabaseSync, supported: number, file: string): number {
  const recorded = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (recorded === 0 && db.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get() !== undefined) {
    throw new Error(`${file} records no format version.`);
  }
  if (recorded > supported) throw new NewerFormatError(file, recorded, supported);
  return recorded;
}

/**
 * Throws, having written nothing, when the open database records no format version or a newer one
 * than `supported` ({@link NewerFormatError}).
 */
export function assertSqliteFormatVersion(db: DatabaseSync, supported: number, file: string): void {
  checkedUserVersion(db, supported, file);
}

/**
 * For the database's writer: checks the version as {@link assertSqliteFormatVersion} does, then
 * records `supported` in a database just created. Call it before any pragma or schema statement
 * that could change the file.
 */
export function claimSqliteFormatVersion(db: DatabaseSync, supported: number, file: string): void {
  if (checkedUserVersion(db, supported, file) === 0) db.exec(`PRAGMA user_version = ${supported}`);
}
