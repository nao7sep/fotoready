import fs from "node:fs";
import path from "node:path";
import { utcStamp } from "@shared/time";
import type { LogLevel } from "@shared/types/log";
import { jsonSafe } from "./json-safe";
import type { RecordRow } from "./records-tables";
import type { StoreWriter } from "./store-writer";

// The app's records (data-lifecycle-conventions, Records; logging-conventions). The main process
// makes each record JSON-safe and hands it to the store writer, which stores it off the main process;
// the renderer forwards its entries over IPC. Every row carries its time, its session (this launch, by
// its start time) and the task it belongs to, if any.

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
}

// Writes one record as a JSON line to this session's `yyyymmdd-hhmmss-utc.log` under
// `fallbackDir`, and when that fails, to the console.
function writeTextRecord(fallbackDir: string, sessionStart: Date, line: Record<string, unknown>, level: LogLevel): void {
  const text = `${JSON.stringify(line)}\n`;
  try {
    fs.mkdirSync(fallbackDir, { recursive: true });
    fs.appendFileSync(fallbackFile(fallbackDir, sessionStart), text);
    return;
  } catch (error) {
    console.error("[records] the fallback log file could not be written; writing to the console", error);
  }
  const sink = level === "error" || level === "warn" ? console.error : console.log;
  sink(text.trimEnd());
}

/** This session's text file under `fallbackDir`, which takes the records the database cannot. */
export function fallbackFile(fallbackDir: string, sessionStart: Date): string {
  return path.join(fallbackDir, `${utcStamp(sessionStart)}.log`);
}

/**
 * Writes one record while no records store is open, such as a startup failure before the logger
 * exists: to the session's text file under `fallbackDir`, then to the console. Never throws.
 */
export function writeFallbackRecord(fallbackDir: string, sessionStart: Date, line: Record<string, unknown>, level: LogLevel): void {
  writeTextRecord(fallbackDir, sessionStart, line, level);
}

/** A log line as the store writer stores it, serialized here on the main process. */
export function logRow(record: LogRecord): RecordRow {
  return {
    table: "log",
    time: record.time,
    taskId: typeof record.fields.taskId === "string" ? record.fields.taskId : null,
    level: record.level,
    message: record.message,
    fields: JSON.stringify(record.fields),
    fallback: JSON.stringify({ time: record.time, level: record.level, message: record.message, ...record.fields })
  };
}

/** A provider call as the store writer stores it, serialized here on the main process. */
export function providerCallRow(record: ProviderCallRecord): RecordRow {
  const request = jsonSafe(record.request);
  const response = jsonSafe(record.response);
  const error = jsonSafe(record.error);
  // The Records window reads a failed call as an error (records-queries.ts).
  const level: LogLevel = error === null ? "info" : "error";
  const durationMs = Math.round(record.durationMs);
  return {
    table: "call",
    time: record.time,
    taskId: record.taskId,
    provider: record.provider,
    endpoint: record.endpoint,
    role: record.role,
    model: record.model,
    attempt: record.attempt,
    durationMs,
    request: JSON.stringify(request),
    response: response === null ? null : JSON.stringify(response),
    error: error === null ? null : JSON.stringify(error),
    level,
    fallback: JSON.stringify({
      time: record.time, level, message: "provider call", taskId: record.taskId, provider: record.provider,
      endpoint: record.endpoint, role: record.role, model: record.model, attempt: record.attempt,
      durationMs, request, response, error
    })
  };
}

/** The record that reports how many records the busy writer dropped. */
export function droppedRecordsRow(count: number): RecordRow {
  return logRow({
    time: new Date().toISOString(),
    level: "warn",
    message: "records were dropped while the records store was busy",
    fields: { mod: "main.records", count }
  });
}

/** This session's records, handed to the store writer; never waits and never throws. */
export function createRecordsStore(writer: Pick<StoreWriter, "writeRecord">, sessionStart: Date): RecordsStore {
  return {
    session: sessionStart.toISOString(),
    writeLog: (record) => writer.writeRecord(logRow(record)),
    writeProviderCall: (record) => writer.writeRecord(providerCallRow(record))
  };
}
