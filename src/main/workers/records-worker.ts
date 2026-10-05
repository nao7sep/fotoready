import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import {
  readRecords,
  type RecordsWorkerData,
  type RecordsWorkerRequest,
  type RecordsWorkerResponse
} from "../records-queries.ts";
import { assertSqliteFormatVersion } from "../sqlite-format-version.ts";
import { FORMAT_VERSIONS } from "../../shared/format-versions.ts";

// The Records window's reads, off the main process (PLAYBOOK, Own the work in flight). The worker
// holds its own read-only connection; the main process stays the database's only writer, and in
// WAL mode a reader sees every record already committed.

if (parentPort === null) {
  throw new Error("The records worker requires a parent port.");
}

const port = parentPort;
const { databasePath } = workerData as RecordsWorkerData;
let db: DatabaseSync | null = null;

port.on("message", ({ id, read }: RecordsWorkerRequest) => {
  let response: RecordsWorkerResponse;
  try {
    // Opened on the first read, and again after a failed one, so a database that appears or
    // recovers later is read then.
    if (db === null) {
      db = new DatabaseSync(databasePath, { readOnly: true });
      // A database a newer build wrote is not read: its tables may not be the ones queried here.
      assertSqliteFormatVersion(db, FORMAT_VERSIONS.records, databasePath);
    }
    response = { id, ok: true, value: readRecords(db, read) };
  } catch (error) {
    try {
      db?.close();
    } catch {
      // The failure below is the one worth reporting.
    }
    db = null;
    response = { id, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
  port.postMessage(response);
});
