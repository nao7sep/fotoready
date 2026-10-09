import { createHash } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { FORMAT_VERSIONS } from "../shared/format-versions.ts";
import { openSqliteStore } from "./sqlite-format-version.ts";
import { STORE_BUSY_TIMEOUT_MS } from "./records-tables.ts";

// The backup history's table (data-backup-conventions, The store). The store writer opens it on its
// worker thread, so this module imports only relative `.ts` files.

/** One protected file as just written: its full absolute path and its exact bytes. */
export type BackupWrite = { path: string; bytes: Uint8Array; writtenAt: string };

const SCHEMA = `
CREATE TABLE backups (
  id             INTEGER PRIMARY KEY,
  session_id     TEXT,
  path           TEXT NOT NULL,
  content        BLOB NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  written_at_utc TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_backups_path_session ON backups (path, session_id);
CREATE INDEX idx_backups_path_id ON backups (path, id);
`;

/**
 * Version 1 had no sessions. Its rows keep a NULL session as earlier history; SQLite's unique index
 * treats each NULL as distinct, so they never conflict.
 */
const UPGRADES: Record<number, string> = {
  1: `
ALTER TABLE backups ADD COLUMN session_id TEXT;
CREATE UNIQUE INDEX idx_backups_path_session ON backups (path, session_id);
`
};

export type BackupsDatabase = { db: DatabaseSync; record(session: string, write: BackupWrite): void; close(): void };

/** Opens backups.sqlite3 for one writer; throws when it cannot be opened or admitted. */
export function openBackupsDatabase(file: string): BackupsDatabase {
  // not recorded: backups.sqlite3 is the history itself, written here and never through the managed save.
  const db = openSqliteStore(file, FORMAT_VERSIONS.backups, SCHEMA, { upgrades: UPGRADES, busyTimeoutMs: STORE_BUSY_TIMEOUT_MS });
  let ownRow: StatementSync;
  let latestRow: StatementSync;
  let upsert: StatementSync;
  try {
    db.exec("PRAGMA journal_mode = WAL");
    ownRow = db.prepare("SELECT 1 FROM backups WHERE path = ? AND session_id = ?");
    latestRow = db.prepare("SELECT content_sha256 AS hash FROM backups WHERE path = ? ORDER BY id DESC LIMIT 1");
    upsert = db.prepare(
      "INSERT INTO backups (session_id, path, content, content_sha256, byte_size, written_at_utc) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (path, session_id) DO UPDATE SET content = excluded.content, content_sha256 = excluded.content_sha256, " +
        "byte_size = excluded.byte_size, written_at_utc = excluded.written_at_utc"
    );
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    db,
    /**
     * This session's row for the path takes the latest bytes. A session's first save of a path whose
     * bytes equal the latest earlier row writes nothing. Writes arrive in save order from one owner,
     * so the read and the upsert need no transaction of their own.
     */
    record(session, write) {
      const hash = createHash("sha256").update(write.bytes).digest("hex");
      if (ownRow.get(write.path, session) === undefined) {
        const latest = latestRow.get(write.path) as { hash: string } | undefined;
        if (latest?.hash === hash) return;
      }
      upsert.run(session, write.path, write.bytes, hash, write.bytes.byteLength, write.writtenAt);
    },
    close: () => db.close()
  };
}
