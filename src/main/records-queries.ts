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

// The Records window's reads of records.sqlite3 (records-tables.ts owns the schema). The store
// writer's worker runs them on its one connection, in order with its writes, never on the main process.
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
  const table = (kind: RecordKind, select: string, from: string, level: string, searched: string[]): void => {
    const where = ["1 = 1"];
    if (query.session !== null) {
      where.push("session = ?");
      params.push(query.session);
    }
    if (query.level === "warn-or-error") {
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
    if (query.after !== null) {
      const after = query.after;
      if (kind === after.kind) {
        where.push("(time, id) < (?, ?)");
        params.push(after.time, after.id);
      } else {
        where.push(kind < after.kind ? "time <= ?" : "time < ?");
        params.push(after.time);
      }
    }
    // Each table uses its ordered index and contributes only enough rows for the final page.
    // Ordering the entire union first would scan/sort the whole retained history on every refresh.
    params.push(RECORDS_PAGE_SIZE + 1);
    parts.push(`SELECT * FROM (${select} FROM ${from} WHERE ${where.join(" AND ")} ORDER BY time DESC, id DESC LIMIT ?)`);
  };
  if (query.kind !== "provider-call") {
    table(
      "log",
      `SELECT 'log' AS kind, id, session, time, level, message AS title,
        CASE WHEN json_valid(fields) THEN json_extract(fields, '$.mod') END AS text, task_id AS taskId`,
      "log_records", "level", LOG_SEARCHED
    );
  }
  if (query.kind !== "log") {
    table(
      "provider-call",
      `SELECT 'provider-call' AS kind, id, session, time, ${CALL_LEVEL} AS level,
        provider || ' ' || role AS title, model AS text, task_id AS taskId`,
      "provider_calls", CALL_LEVEL, CALL_SEARCHED
    );
  }
  params.push(RECORDS_PAGE_SIZE + 1);
  const rows = db.prepare(
    `SELECT * FROM (${parts.join(" UNION ALL ")}) ORDER BY time DESC, kind DESC, id DESC LIMIT ?`
  ).all(...params) as unknown as RecordSummary[];
  return { records: rows.slice(0, RECORDS_PAGE_SIZE), more: rows.length > RECORDS_PAGE_SIZE };
}

function readSources(db: DatabaseSync): RecordsReadResults["sources"] {
  const sessions = db.prepare(
    "SELECT session FROM log_records UNION SELECT session FROM provider_calls ORDER BY session DESC"
  ).all() as { session: string }[];
  const tasks = db.prepare(
    `SELECT task_id AS taskId, MAX(last) AS last FROM (
      SELECT task_id, MAX(time) AS last FROM log_records WHERE task_id IS NOT NULL GROUP BY task_id
      UNION ALL
      SELECT task_id, MAX(time) AS last FROM provider_calls WHERE task_id IS NOT NULL GROUP BY task_id
    ) GROUP BY task_id ORDER BY last DESC`
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
