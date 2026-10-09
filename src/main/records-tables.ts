import type { DatabaseSync, StatementSync } from "node:sqlite";
import { FORMAT_VERSIONS } from "../shared/format-versions.ts";
import type { LogLevel } from "../shared/types/log.ts";
import { openSqliteStore } from "./sqlite-format-version.ts";

// The records database's tables (data-lifecycle-conventions, Records; logging-conventions). The store
// writer opens it on its worker thread and the records reader reads it; both load this module under
// Node's TypeScript stripping in the tests, so it imports only relative `.ts` files.

/**
 * One record ready to store: its column values, already JSON-safe and serialized on the main process,
 * and the JSON line that stands in for it in the session's text file when the database cannot take it.
 */
export type RecordRow =
  | { table: "log"; time: string; taskId: string | null; level: LogLevel; message: string; fields: string; fallback: string }
  | {
    table: "call"; time: string; taskId: string | null; provider: string; endpoint: string; role: string; model: string;
    attempt: number; durationMs: number; request: string; response: string | null; error: string | null;
    level: LogLevel; fallback: string;
  };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS log_records (
  id      INTEGER PRIMARY KEY,
  time    TEXT NOT NULL,
  session TEXT NOT NULL,
  task_id TEXT,
  level   TEXT NOT NULL,
  message TEXT NOT NULL,
  fields  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_records_session ON log_records (session);
CREATE INDEX IF NOT EXISTS idx_log_records_task_id ON log_records (task_id);
CREATE TABLE IF NOT EXISTS provider_calls (
  id          INTEGER PRIMARY KEY,
  time        TEXT NOT NULL,
  session     TEXT NOT NULL,
  task_id     TEXT,
  provider    TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  role        TEXT NOT NULL,
  model       TEXT NOT NULL,
  attempt     INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  request     TEXT NOT NULL,
  response    TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_provider_calls_session ON provider_calls (session);
CREATE INDEX IF NOT EXISTS idx_provider_calls_task_id ON provider_calls (task_id);
`;

/** How long a write waits for SQLite's lock (data-backup-conventions: a short busy_timeout). */
export const STORE_BUSY_TIMEOUT_MS = 500;

export type RecordsDatabase = { db: DatabaseSync; insert(session: string, row: RecordRow): void; close(): void };

/** Opens records.sqlite3 for one writer; throws when it cannot be opened or admitted. */
export function openRecordsDatabase(file: string): RecordsDatabase {
  const db = openSqliteStore(file, FORMAT_VERSIONS.records, SCHEMA, { busyTimeoutMs: STORE_BUSY_TIMEOUT_MS });
  let insertLog: StatementSync;
  let insertCall: StatementSync;
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    insertLog = db.prepare("INSERT INTO log_records (time, session, task_id, level, message, fields) VALUES (?, ?, ?, ?, ?, ?)");
    insertCall = db.prepare(
      "INSERT INTO provider_calls (time, session, task_id, provider, endpoint, role, model, attempt, duration_ms, request, response, error) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    db,
    insert(session, row) {
      if (row.table === "log") {
        insertLog.run(row.time, session, row.taskId, row.level, row.message, row.fields);
      } else {
        insertCall.run(
          row.time, session, row.taskId, row.provider, row.endpoint, row.role, row.model, row.attempt,
          row.durationMs, row.request, row.response, row.error
        );
      }
    },
    close: () => db.close()
  };
}
