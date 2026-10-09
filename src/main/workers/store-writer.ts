import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { openBackupsDatabase, type BackupsDatabase } from "../backup-tables.ts";
import { NewerFormatError } from "../../shared/format-versions.ts";
import { InvalidSqliteFormatError } from "../sqlite-format-version.ts";
import { jsonSafe } from "../json-safe.ts";
import { openRecordsDatabase, type RecordRow, type RecordsDatabase } from "../records-tables.ts";
import type { StoreWriterData, StoreWriterRequest, StoreWriterResponse, StoreWriterWarning } from "../store-writer-protocol.ts";

// The one writer of records.sqlite3 and backups.sqlite3, off the main process (developer decision):
// the main process posts each batch and never waits on it, so a locked or stalled store cannot hold up
// a save, an IPC call or quitting. Batches arrive one at a time and in order, so backup writes for a
// path apply in save order. The Records window reads through its own worker.

if (parentPort === null) {
  throw new Error("The store writer requires a parent port.");
}

const port = parentPort;
const data = workerData as StoreWriterData;

let records: RecordsDatabase | null = null;
let recordsUnavailable = false;
let recordsFailureNoted = false;
let fallbackFailureNoted = false;
let backups: BackupsDatabase | null = null;
let backupsUnavailable = false;
let backupsOpenWarned = false;

/**
 * A store a newer build wrote, or one with no version, is left exactly as it is for the session.
 * Any other failure to open, such as a lock held past the busy timeout, is tried again with the
 * next batch.
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

function recordsDatabase(): RecordsDatabase | null {
  if (records !== null || recordsUnavailable) return records;
  try {
    fs.mkdirSync(path.dirname(data.recordsPath), { recursive: true });
    records = openRecordsDatabase(data.recordsPath);
  } catch (error) {
    recordsUnavailable = refusedForSession(error);
    noteRecordsFailure(error);
  }
  return records;
}

/** Stores each record, or writes it to the text file when the database cannot take it; returns how many it stored. */
function writeRecords(rows: RecordRow[]): number {
  let stored = 0;
  for (const row of rows) {
    const db = recordsDatabase();
    if (db !== null) {
      try {
        db.insert(data.session, row);
        stored += 1;
        continue;
      } catch (error) {
        noteRecordsFailure(error);
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
    backups = openBackupsDatabase(data.backupsPath);
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
