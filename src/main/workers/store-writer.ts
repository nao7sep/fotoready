import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { openBackupsDatabase, type BackupsDatabase } from "../backup-tables.ts";
import { NewerFormatError } from "../../shared/file-header.ts";
import { InvalidSqliteFormatError } from "../sqlite-format-version.ts";
import { jsonSafe } from "../json-safe.ts";
import { readRecords } from "../records-queries.ts";
import { openRecordsDatabase, type RecordRow, type RecordsDatabase } from "../records-tables.ts";
import type { StoreWriterData, StoreWriterRequest, StoreWriterResponse, StoreWriterWarning } from "../store-writer-protocol.ts";

// The owner of records.sqlite3 and backups.sqlite3, off the main process, with one connection to
// each: the main process posts each batch and never waits on it, so a stalled store cannot hold up a
// save, an IPC call or quitting. Batches arrive one at a time and in order, so backup writes for a
// path apply in save order. The Records window's reads arrive here too and are answered in turn.

if (parentPort === null) {
  throw new Error("The store writer requires a parent port.");
}

const port = parentPort;
const data = workerData as StoreWriterData;

let records: RecordsDatabase | null = null;
// Why the records database is refused for the session, once it is.
let recordsRefusal: unknown = null;
let recordsFailureNoted = false;
let fallbackFailureNoted = false;
let backups: BackupsDatabase | null = null;
let backupsUnavailable = false;
let backupsOpenWarned = false;

/**
 * A store a newer build wrote, or one with no version, is left exactly as it is for the session.
 * Any other failure to open is tried again with the next batch or read.
 */
function refusedForSession(error: unknown): boolean {
  return error instanceof NewerFormatError || error instanceof InvalidSqliteFormatError;
}

function appendFallback(line: string, level: RecordRow["level"]): void {
  try {
    fs.mkdirSync(path.dirname(data.fallbackPath), { recursive: true });
    fs.appendFileSync(data.fallbackPath, `${line}\n`);
    return;
  } catch (error) {
    if (!fallbackFailureNoted) {
      fallbackFailureNoted = true;
      console.error("[records] the fallback log file could not be written; writing to the console", error);
    }
  }
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

/** The first failure of the records database is noted, on the console and in the text file, once. */
function noteRecordsFailure(error: unknown): void {
  if (recordsFailureNoted) return;
  recordsFailureNoted = true;
  console.error("[records] the records database could not be written; writing records to a text file", error);
  appendFallback(JSON.stringify({
    time: new Date().toISOString(), level: "warn", message: "records database unavailable", mod: "main.records",
    file: data.recordsPath, err: jsonSafe(error)
  }), "warn");
}

/** The open records database; throws when it cannot be opened or is refused for the session. */
function recordsDatabase(): RecordsDatabase {
  if (records !== null) return records;
  if (recordsRefusal !== null) throw recordsRefusal;
  try {
    fs.mkdirSync(path.dirname(data.recordsPath), { recursive: true });
    records = openRecordsDatabase(data.recordsPath, data.writer);
  } catch (error) {
    if (refusedForSession(error)) recordsRefusal = error;
    noteRecordsFailure(error);
    throw error;
  }
  return records;
}

/** Stores each record, or writes it to the text file when the database cannot take it; returns how many it stored. */
function writeRecords(rows: RecordRow[]): number {
  let stored = 0;
  // One failed attempt per batch: its remaining records fall back so backups progress too, and the
  // database is tried again when the next batch arrives.
  let db: RecordsDatabase | null = null;
  if (rows.length > 0) {
    try { db = recordsDatabase(); } catch { /* Noted once; the rows fall back below. */ }
  }
  for (const row of rows) {
    if (db !== null) {
      try {
        db.insert(data.session, row);
        stored += 1;
        continue;
      } catch (error) {
        noteRecordsFailure(error);
        db = null;
      }
    }
    appendFallback(row.fallback, row.level);
  }
  return stored;
}

function backupsDatabase(warnings: StoreWriterWarning[]): BackupsDatabase | null {
  if (backups !== null || backupsUnavailable) return backups;
  try {
    fs.mkdirSync(path.dirname(data.backupsPath), { recursive: true });
    backups = openBackupsDatabase(data.backupsPath, data.writer);
  } catch (error) {
    backupsUnavailable = refusedForSession(error);
    if (!backupsOpenWarned) {
      backupsOpenWarned = true;
      warnings.push({
        message: backupsUnavailable ? "backup store: could not open; recording disabled for this session" : "backup store: could not open; trying again at the next save",
        fields: { mod: "main.backup-store", file: data.backupsPath, err: jsonSafe(error) }
      });
    }
  }
  return backups;
}

port.on("message", (request: StoreWriterRequest) => {
  if (request.kind === "close") {
    for (const db of [records, backups]) {
      try { db?.close(); } catch (error) { console.error("[store-writer] a store could not be closed", error); }
    }
    records = null;
    backups = null;
    port.postMessage({ kind: "closed" } satisfies StoreWriterResponse);
    return;
  }
  if (request.kind === "read") {
    let response: StoreWriterResponse;
    try {
      response = { kind: "read", id: request.id, ok: true, value: readRecords(recordsDatabase().db, request.read) };
    } catch (error) {
      response = { kind: "read", id: request.id, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
    port.postMessage(response);
    return;
  }
  const warnings: StoreWriterWarning[] = [];
  const stored = writeRecords(request.records);
  for (const write of request.backups) {
    const db = backupsDatabase(warnings);
    if (db === null) break;
    try {
      db.record(data.session, write);
    } catch (error) {
      // A lost record heals at the file's next save in a later session; the save itself already succeeded.
      warnings.push({ message: "backup store: failed to record a managed write", fields: { mod: "main.backup-store", file: write.path, err: jsonSafe(error) } });
    }
  }
  port.postMessage({ kind: "done", id: request.id, stored, warnings } satisfies StoreWriterResponse);
});
