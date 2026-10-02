import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { utcStamp } from "@shared/time";
import type { LogLevel } from "@shared/types/log";
import { jsonSafe } from "./json-safe";

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
  writeLog(record: LogRecord): void;
  writeProviderCall(record: ProviderCallRecord): void;
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

/**
 * Opens the records database at `file` for one session. A record the database cannot take is
 * written as a JSON line to this session's `yyyymmdd-hhmmss-fff-utc.log` under `fallbackDir`, and
 * when that fails too, to the console. Never throws.
 */
export function openRecordsStore(file: string, fallbackDir: string, sessionStart = new Date()): RecordsStore {
  const session = sessionStart.toISOString();
  const fallbackFile = path.join(fallbackDir, `${utcStamp(sessionStart)}.log`);
  let db: { handle: DatabaseSync; insertLog: StatementSync; insertCall: StatementSync } | null = null;
  let dbFailureNoted = false;
  let fileFailureNoted = false;

  const writeFallback = (line: Record<string, unknown>, level: LogLevel): void => {
    const text = `${JSON.stringify(line)}\n`;
    try {
      fs.mkdirSync(fallbackDir, { recursive: true });
      fs.appendFileSync(fallbackFile, text);
      return;
    } catch (error) {
      if (!fileFailureNoted) {
        fileFailureNoted = true;
        console.error("[records] the fallback log file could not be written; writing to the console", error);
      }
    }
    const sink = level === "error" || level === "warn" ? console.error : console.log;
    sink(text.trimEnd());
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
    const opened = new DatabaseSync(file);
    try {
      opened.exec("PRAGMA journal_mode = WAL");
      opened.exec("PRAGMA synchronous = NORMAL");
      opened.exec(SCHEMA);
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
      try {
        insert(db);
        return;
      } catch (error) {
        noteDbFailure(error);
      }
    }
    writeFallback(fallback(), level);
  };

  return {
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
