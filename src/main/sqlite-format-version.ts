import type { DatabaseSync } from "node:sqlite";
import { NewerFormatError } from "../shared/format-versions.ts";

// A SQLite store's format version, kept in `PRAGMA user_version` (store-recovery-conventions). An
// unset one, 0, reads as 1.
//
// The records worker loads this module under Node's own TypeScript stripping in the tests, so its
// imports are relative and spelled with their extension.

/** The recorded `user_version`, raw; throws {@link NewerFormatError} when it is newer than `supported`. */
function checkedUserVersion(db: DatabaseSync, supported: number, file: string): number {
  const recorded = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const found = recorded === 0 ? 1 : recorded;
  if (found > supported) throw new NewerFormatError(file, found, supported);
  return recorded;
}

/**
 * Throws {@link NewerFormatError}, having written nothing, when the open database records a newer
 * format than `supported`.
 */
export function assertSqliteFormatVersion(db: DatabaseSync, supported: number, file: string): void {
  checkedUserVersion(db, supported, file);
}

/**
 * For the database's writer: checks the version as {@link assertSqliteFormatVersion} does, then
 * records `supported` in a database that has none. Call it before any pragma or schema statement
 * that could change the file.
 */
export function claimSqliteFormatVersion(db: DatabaseSync, supported: number, file: string): void {
  if (checkedUserVersion(db, supported, file) === 0) db.exec(`PRAGMA user_version = ${supported}`);
}
