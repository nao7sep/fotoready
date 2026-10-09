import { nowIso } from "@shared/time";
import type { LogFields, LogLevel, Logger } from "@shared/types/log";
import { jsonSafeObject } from "./json-safe";
import type { LogRecord, RecordsStore } from "./records-store";

/** The session logger; its records are flushed by the store writer's bounded drain at quit. */
export type AppLogger = Logger;

export type CreateLoggerOptions = {
  /**
   * Whether developer-only `debug` lines are written. Computed by the caller
   * from the build/runtime (unpackaged dev build or `FOTOREADY_DEBUG=1`); when
   * false, `debug` calls are dropped before they touch the disk.
   */
  debug: boolean;
};

// Envelope fields are the only fixed contract; user fields may never overwrite them.
const ENVELOPE_KEYS = new Set(["time", "level", "message"]);

function buildRecord(level: LogLevel, message: string, fields?: LogFields): LogRecord {
  // Null-prototype field bag (see jsonSafeObject), with reserved envelope names dropped so fields
  // can never shadow the contract.
  const safe: Record<string, unknown> = Object.create(null);
  if (fields) {
    for (const [key, val] of Object.entries(jsonSafeObject(fields))) {
      if (ENVELOPE_KEYS.has(key)) continue;
      safe[key] = val;
    }
  }
  return { time: nowIso(), level, message, fields: safe };
}

/**
 * Writes each log line as a record (logging-conventions), handed to the store writer without waiting;
 * the writer owns the fallback when the database cannot take it. Lines from just before a crash may
 * be lost (developer decision). Never throws.
 */
export function createLogger(records: Pick<RecordsStore, "writeLog">, options: CreateLoggerOptions): AppLogger {
  const { debug } = options;

  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (level === "debug" && !debug) return;
    let record: LogRecord;
    try {
      record = buildRecord(level, message, fields);
    } catch (error) {
      // Serialization itself failed — logging must never throw or crash the app.
      console.error("[logger] failed to serialize a log entry", { level, message }, error);
      return;
    }
    records.writeLog(record);
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields)
  };
}

/**
 * Global last-resort hooks: log the failure with full fidelity before the
 * process dies, then preserve default behavior (re-throw uncaught exceptions,
 * mark a non-zero exit code for unhandled rejections). Called exactly once per
 * launch — `bootstrap` runs a single time and only the window is recreated on
 * macOS re-activate, so there is no second logger to swap in.
 */
export function installCrashHandlers(logger: AppLogger): void {
  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { mod: "main", err: error });
    throw error;
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled rejection", { mod: "main", err: reason });
    process.exitCode = 1;
  });
}
