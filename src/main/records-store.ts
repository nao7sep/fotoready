import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { utcStamp } from "@shared/time";
import { FORMAT_VERSIONS, NewerFormatError } from "@shared/format-versions";
import type { LogLevel } from "@shared/types/log";
import { jsonSafe } from "./json-safe";
import { assertSqliteFormatVersion, InvalidSqliteFormatError, openSqliteStore } from "./sqlite-format-version";

// The app's records database (data-lifecycle-conventions, Records; logging-conventions). The main
// process is its only writer; the renderer forwards its entries over IPC. Every row carries its
// time, its session (this launch, by its start time) and the task it belongs to, if any.

/** One log line: the envelope and its JSON-safe fields. */
export type LogRecord = {
  time: string;
  level: LogLevel;
  message: string;
  fields: Record<string, unknown>;
};

/** One request to an AI provider, as sent, and what came back, as received. */
export type ProviderCallRecord = {
  /** When the request was sent. */
  time: string;
  taskId: string | null;
  provider: string;
  endpoint: string;
  /** Which of the app's AI roles made the call: `description` or `slug`. */
  role: string;
  model: string;
  /** 1 for the first send, counting each resend. */
  attempt: number;
  durationMs: number;
  request: unknown;
  /** Null when the call failed. */
  response: unknown;
  /** Null when the call succeeded. */
  error: unknown;
};

export interface RecordsStore {
  /** This launch's session, as every record of it carries: its start time. */
  readonly session: string;
  writeLog(record: LogRecord): void;
  writeProviderCall(record: ProviderCallRecord): void;
  /**
   * Called after each record the database stored; a record that went to the fallback file is not in
   * the database, so it calls nothing. The Records window follows the database through it.
   */
  onStored(listener: () => void): void;
  /** Idempotent and best-effort; safe to call from exit hooks. */
  close(): void;
}

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

// Writes one record as a JSON line to this session's `yyyymmdd-hhmmss-fff-utc.log` under
// `fallbackDir`, and when that fails, to the console, after telling `onFileFailure` why.
function writeTextRecord(
  fallbackDir: string,
  sessionStart: Date,
  line: Record<string, unknown>,
  level: LogLevel,
  onFileFailure: (error: unknown) => void
): void {
  const text = `${JSON.stringify(line)}\n`;
  try {
    fs.mkdirSync(fallbackDir, { recursive: true });
    fs.appendFileSync(path.join(fallbackDir, `${utcStamp(sessionStart)}.log`), text);
    return;
  } catch (error) {
    onFileFailure(error);
  }
  const sink = level === "error" || level === "warn" ? console.error : console.log;
  sink(text.trimEnd());
}

/**
 * Writes one record while no records store is open, such as a startup failure before the logger
 * exists: to the session's text file under `fallbackDir`, then to the console. Never throws.
 */
export function writeFallbackRecord(fallbackDir: string, sessionStart: Date, line: Record<string, unknown>, level: LogLevel): void {
  writeTextRecord(fallbackDir, sessionStart, line, level, (error) =>
    console.error("[records] the fallback log file could not be written; writing to the console", error)
  );
}

/**
 * Opens the records database at `file` for one session. A record the database cannot take is
 * written as a JSON line to this session's text file under `fallbackDir`, and when that fails too,
 * to the console. Never throws.
 */
export function openRecordsStore(file: string, fallbackDir: string, sessionStart = new Date()): RecordsStore {
  const session = sessionStart.toISOString();
  let db: { handle: DatabaseSync; insertLog: StatementSync; insertCall: StatementSync } | null = null;
  let dbFailureNoted = false;
  let fileFailureNoted = false;
  let storedListener: (() => void) | null = null;

  const writeFallback = (line: Record<string, unknown>, level: LogLevel): void => {
    writeTextRecord(fallbackDir, sessionStart, line, level, (error) => {
      if (fileFailureNoted) return;
      fileFailureNoted = true;
      console.error("[records] the fallback log file could not be written; writing to the console", error);
    });
  };

  const noteDbFailure = (error: unknown): void => {
    if (dbFailureNoted) return;
    dbFailureNoted = true;
    console.error("[records] the records database could not be written; writing records to a text file", error);
    writeFallback(
      { time: new Date().toISOString(), level: "warn", message: "records database unavailable", mod: "main.records", file, err: jsonSafe(error) },
      "warn"
    );
  };

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const opened = openSqliteStore(file, FORMAT_VERSIONS.records, SCHEMA);
    try {
      // First, so a database a newer build wrote is left exactly as it is and records go to the text file.
      opened.exec("PRAGMA journal_mode = WAL");
      opened.exec("PRAGMA synchronous = NORMAL");
      db = {
        handle: opened,
        insertLog: opened.prepare(
          "INSERT INTO log_records (time, session, task_id, level, message, fields) VALUES (?, ?, ?, ?, ?, ?)"
        ),
        insertCall: opened.prepare(
          "INSERT INTO provider_calls (time, session, task_id, provider, endpoint, role, model, attempt, duration_ms, request, response, error) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
      };
    } catch (error) {
      opened.close();
      throw error;
    }
  } catch (error) {
    noteDbFailure(error);
  }

  const write = (
    insert: (open: NonNullable<typeof db>) => void,
    fallback: () => Record<string, unknown>,
    level: LogLevel
  ): void => {
    if (db) {
      let stored = false;
      try {
        db.handle.exec("BEGIN IMMEDIATE");
        try {
          assertSqliteFormatVersion(db.handle, FORMAT_VERSIONS.records, file);
          insert(db);
          db.handle.exec("COMMIT");
          stored = true;
        } catch (error) {
          try { db.handle.exec("ROLLBACK"); } catch { /* Preserve the write failure. */ }
          throw error;
        }
      } catch (error) {
        if (error instanceof NewerFormatError || error instanceof InvalidSqliteFormatError) {
          const refused = db;
          db = null;
          try { refused?.handle.close(); } catch { /* Preserve admission failure. */ }
        }
        noteDbFailure(error);
      }
      if (stored) {
        // Outside the write's own catch: a listener that throws did not fail the write.
        try {
          storedListener?.();
        } catch (error) {
          console.error("[records] the stored-record listener failed", error);
        }
        return;
      }
    }
    writeFallback(fallback(), level);
  };

  return {
    session,
    writeLog(record) {
      const taskId = typeof record.fields.taskId === "string" ? record.fields.taskId : null;
      write(
        (open) => open.insertLog.run(record.time, session, taskId, record.level, record.message, JSON.stringify(record.fields)),
        () => ({ time: record.time, level: record.level, message: record.message, ...record.fields }),
        record.level
      );
    },
    writeProviderCall(record) {
      const request = jsonSafe(record.request);
      const response = jsonSafe(record.response);
      const error = jsonSafe(record.error);
      const level: LogLevel = error === null ? "info" : "warn";
      write(
        (open) =>
          open.insertCall.run(
            record.time, session, record.taskId, record.provider, record.endpoint, record.role, record.model,
            record.attempt, Math.round(record.durationMs), JSON.stringify(request),
            response === null ? null : JSON.stringify(response), error === null ? null : JSON.stringify(error)
          ),
        () => ({
          time: record.time, level, message: "provider call", taskId: record.taskId, provider: record.provider,
          endpoint: record.endpoint, role: record.role, model: record.model, attempt: record.attempt,
          durationMs: Math.round(record.durationMs), request, response, error
        }),
        level
      );
    },
    onStored(listener) {
      storedListener = listener;
    },
    close() {
      const open = db;
      db = null;
      if (!open) return;
      try {
        open.handle.close();
      } catch (error) {
        console.error("[records] the records database could not be closed", error);
      }
    }
  };
}
