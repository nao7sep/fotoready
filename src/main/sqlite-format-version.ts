import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { DatabaseSync } from "node:sqlite";
import { NewerFormatError } from "../shared/format-versions.ts";

// Store recovery conventions; worker imports use Node TypeScript stripping.

export class InvalidSqliteFormatError extends Error {
  constructor(file: string) {
    super(`${file} records no format version.`);
    this.name = "InvalidSqliteFormatError";
  }
}

/** Reject absent, invalid and unsupported store markers. */
function checkedUserVersion(db: DatabaseSync, supported: number, file: string): number {
  const recorded = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (recorded <= 0) {
    throw new InvalidSqliteFormatError(file);
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

/** Publish a complete new schema and marker together; never initialize an existing file. */
export function openSqliteStore(file: string, supported: number, schema: string): DatabaseSync {
  if (!fs.existsSync(file)) {
    const temp = path.join(path.dirname(file), `${path.parse(file).name}-${nanoid(8)}.tmp`);
    const descriptor = fs.openSync(temp, "wx");
    fs.closeSync(descriptor);
    let staging: DatabaseSync | null = null;
    try {
      staging = new DatabaseSync(temp);
      staging.exec("BEGIN IMMEDIATE");
      staging.exec(schema);
      staging.exec(`PRAGMA user_version = ${supported}`);
      staging.exec("COMMIT");
      staging.close();
      staging = null;
      try { fs.linkSync(temp, file); } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL"].includes(code ?? "")) {
          try { fs.copyFileSync(temp, file, fs.constants.COPYFILE_EXCL); } catch (copyError) {
            if ((copyError as NodeJS.ErrnoException).code !== "EEXIST") throw copyError;
          }
        } else if (code !== "EEXIST") throw error;
      }
    } finally {
      try { staging?.close(); } catch (error) { console.warn("[sqlite] could not close initialization staging", error); }
      try { fs.rmSync(temp, { force: true }); } catch (error) { console.warn("[sqlite] could not remove initialization staging", error); }
    }
  }
  const db = new DatabaseSync(file);
  try {
    assertSqliteFormatVersion(db, supported, file);
    return db;
  } catch (error) {
    try { db.close(); } catch { /* Preserve admission failure. */ }
    throw error;
  }
}
