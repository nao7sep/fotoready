import type { RecordsRead, RecordsReadResults } from "../shared/records.ts";
import type { BackupWrite } from "./backup-tables.ts";
import type { RecordRow } from "./records-tables.ts";
import type { FileWriter } from "../shared/file-header.ts";

// Messages between the main process and the store writer's worker thread.

export type StoreWriterData = {
  recordsPath: string;
  backupsPath: string;
  /** This session's text file, which takes the records the database cannot. */
  fallbackPath: string;
  /** This launch's session: every record carries it, and the backup history keeps one row per path in it. */
  session: string;
  /** The build that writes both stores, named in their headers. */
  writer: FileWriter;
};

export type StoreWriterRequest =
  | { kind: "batch"; id: number; records: RecordRow[]; backups: BackupWrite[] }
  | { kind: "read"; id: number; read: RecordsRead }
  | { kind: "close" };

/** A failure the main process logs: the writer cannot log through the records it writes. */
export type StoreWriterWarning = { message: string; fields: Record<string, unknown> };

export type StoreWriterResponse =
  | { kind: "done"; id: number; stored: number; warnings: StoreWriterWarning[] }
  | { kind: "read"; id: number; ok: true; value: RecordsReadResults[RecordsRead["op"]] }
  | { kind: "read"; id: number; ok: false; error: string }
  | { kind: "closed" };
