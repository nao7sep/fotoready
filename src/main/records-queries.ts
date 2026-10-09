import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  RECORDS_PAGE_SIZE,
  type RecordDetail,
  type RecordKind,
  type RecordsPage,
  type RecordsQuery,
  type RecordsRead,
  type RecordsReadResults,
  type RecordSummary
} from "../shared/records.ts";

// The Records window's reads of records.sqlite3 (records-tables.ts owns the schema). They run on the
// records worker, never on the main process, and only read.
//
// The worker loads this module under Node's own TypeScript stripping in the tests, so its imports
// are relative and spelled with their extension.

// A provider call has no level of its own; a failed one reads as an error.
const CALL_LEVEL = "CASE WHEN error IS NULL THEN 'info' ELSE 'error' END";
const LOG_SEARCHED = ["message", "task_id", "fields"];
const CALL_SEARCHED = ["provider", "endpoint", "role", "model", "task_id", "request", "response", "error"];

export function readRecords<R extends RecordsRead>(db: DatabaseSync, read: R): RecordsReadResults[R["op"]] {
  if (read.op === "page") return readPage(db, read.query) as RecordsReadResults[R["op"]];
  if (read.op === "sources") return readSources(db) as RecordsReadResults[R["op"]];
  return readDetail(db, read.kind, read.id) as RecordsReadResults[R["op"]];
}

function likePattern(search: string): string | null {
  const trimmed = search.trim();
  return trimmed === "" ? null : `%${trimmed.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function readPage(db: DatabaseSync, query: RecordsQuery): RecordsPage {
  const pattern = likePattern(query.search);
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  const table = (select: string, from: string, level: string, searched: string[]): void => {
    const where = ["1 = 1"];
    if (query.session !== null) {
      where.push("session = ?");
      params.push(query.session);
    }
    if (query.level === "attention") {
      where.push(`${level} IN ('warn', 'error')`);
    } else if (query.level !== null) {
      where.push(`${level} = ?`);
      params.push(query.level);
    }
    if (query.taskId !== null) {
      where.push("task_id = ?");
      params.push(query.taskId);
    }
    if (pattern !== null) {
      where.push(`(${searched.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
      params.push(...searched.map(() => pattern));
    }
    parts.push(`${select} FROM ${from} WHERE ${where.join(" AND ")}`);
  };
  if (query.kind !== "provider-call") {
    table(
      `SELECT 'log' AS kind, id, session, time, level, message AS title,
        CASE WHEN json_valid(fields) THEN json_extract(fields, '$.mod') END AS text, task_id AS taskId`,
      "log_records", "level", LOG_SEARCHED
    );
  }
  if (query.kind !== "log") {
    table(
      `SELECT 'provider-call' AS kind, id, session, time, ${CALL_LEVEL} AS level,
        provider || ' ' || role AS title, model AS text, task_id AS taskId`,
      "provider_calls", CALL_LEVEL, CALL_SEARCHED
    );
  }
  let after = "";
  if (query.after !== null) {
    const { time, kind, id } = query.after;
    after = "WHERE time < ? OR (time = ? AND (kind < ? OR (kind = ? AND id < ?)))";
    params.push(time, time, kind, kind, id);
  }
  params.push(RECORDS_PAGE_SIZE + 1);
  const rows = db.prepare(
    `SELECT * FROM (${parts.join(" UNION ALL ")}) ${after} ORDER BY time DESC, kind DESC, id DESC LIMIT ?`
  ).all(...params) as unknown as RecordSummary[];
  return { records: rows.slice(0, RECORDS_PAGE_SIZE), more: rows.length > RECORDS_PAGE_SIZE };
}

function readSources(db: DatabaseSync): RecordsReadResults["sources"] {
  const sessions = db.prepare(
    "SELECT session FROM log_records UNION SELECT session FROM provider_calls ORDER BY session DESC"
  ).all() as { session: string }[];
  const tasks = db.prepare(
    `SELECT task_id AS taskId, MAX(time) AS last FROM (
      SELECT task_id, time FROM log_records UNION ALL SELECT task_id, time FROM provider_calls
    ) WHERE task_id IS NOT NULL GROUP BY task_id ORDER BY last DESC`
  ).all() as { taskId: string }[];
  return { sessions: sessions.map((row) => row.session), taskIds: tasks.map((row) => row.taskId) };
}

function readDetail(db: DatabaseSync, kind: RecordKind, id: number): RecordDetail | null {
  if (kind === "log") {
    const row = db.prepare(
      `SELECT 'log' AS kind, id, session, time, level, message, task_id AS taskId, fields
        FROM log_records WHERE id = ?`
    ).get(id);
    return (row as unknown as RecordDetail | undefined) ?? null;
  }
  const row = db.prepare(
    `SELECT 'provider-call' AS kind, id, session, time, duration_ms AS durationMs, task_id AS taskId,
      provider, endpoint, role, model, attempt, request, response, error
      FROM provider_calls WHERE id = ?`
  ).get(id);
  return (row as unknown as RecordDetail | undefined) ?? null;
}

// What the main process and the records worker say to each other.
export type RecordsWorkerData = { databasePath: string };

export type RecordsWorkerRequest = { id: number; read: RecordsRead };

export type RecordsWorkerResponse =
  | { id: number; ok: true; value: RecordsReadResults[RecordsRead["op"]] }
  | { id: number; ok: false; error: string };
