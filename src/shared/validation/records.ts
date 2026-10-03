import {
  RECORD_KINDS,
  RECORD_LEVEL_FILTERS,
  type RecordKind,
  type RecordsQuery
} from "../records";
import { assertNullableString, assertOneOf, assertRecord, assertString } from "./common";

// The Records window's requests arrive over IPC from a renderer, so each is checked before it
// reaches the database.

export function assertRecordKind(value: unknown, path = "kind"): RecordKind {
  return assertOneOf(value, path, RECORD_KINDS);
}

export function assertRecordId(value: unknown, path = "id"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${path} must be an integer.`);
  }
  return value;
}

export function parseRecordsQuery(value: unknown): RecordsQuery {
  const query = assertRecord(value, "query");
  let after: RecordsQuery["after"] = null;
  if (query.after !== null) {
    const cursor = assertRecord(query.after, "query.after");
    after = {
      time: assertString(cursor.time, "query.after.time"),
      kind: assertRecordKind(cursor.kind, "query.after.kind"),
      id: assertRecordId(cursor.id, "query.after.id")
    };
  }
  return {
    session: assertNullableString(query.session, "query.session"),
    kind: query.kind === null ? null : assertRecordKind(query.kind, "query.kind"),
    level: query.level === null ? null : assertOneOf(query.level, "query.level", RECORD_LEVEL_FILTERS),
    taskId: assertNullableString(query.taskId, "query.taskId"),
    search: assertString(query.search, "query.search"),
    after
  };
}
