import { DatabaseSync } from "node:sqlite";
import { NewerFormatError } from "../shared/format-versions.ts";

// Format version checks for the SQLite stores. The store writer loads this module on its worker
// thread under Node's TypeScript stripping in the tests, so it imports only relative `.ts` files and
// uses only erasable syntax.

export class InvalidSqliteFormatError extends Error {
  constructor(file: string) {
    super(`${file} records no format version.`);
    this.name = "InvalidSqliteFormatError";
  }
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

/**
 * Opens a store and checks its format version once, here; a session's writes do not check it again,
 * since only this process writes the store while it runs (single-instance lock). A database with no
 * tables and no version, whether new or left empty by an interrupted creation, gets `schema` and the
 * version in one transaction. `upgrades[n]` brings a store at version n to n + 1, for the earlier
 * versions this build still reads. A newer or unversioned store is refused, having written nothing.
 * The store writer's connection is the store's only one, so it sets no busy timeout.
 */
export function openSqliteStore(
  file: string,
  supported: number,
  schema: string,
  { upgrades = {} }: { upgrades?: Record<number, string> } = {}
): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const recorded = userVersion(db);
      const tables = (db.prepare("SELECT count(*) AS n FROM sqlite_schema").get() as { n: number }).n;
      if (recorded > supported) throw new NewerFormatError(file, recorded, supported);
      if (recorded === 0 && tables === 0) {
        db.exec(schema);
      } else if (recorded <= 0) {
        throw new InvalidSqliteFormatError(file);
      } else {
        for (let version = recorded; version < supported; version++) {
          const upgrade = upgrades[version];
          if (upgrade === undefined) throw new InvalidSqliteFormatError(file);
          db.exec(upgrade);
        }
      }
      if (recorded !== supported) db.exec(`PRAGMA user_version = ${supported}`);
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
