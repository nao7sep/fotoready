import type { MessageKey } from "@shared/i18n/catalogues";
import type {
  RecordCursor,
  RecordKind,
  RecordLevel,
  RecordLevelFilter,
  RecordsPage,
  RecordSummary
} from "@shared/records";

export function recordKey(record: { kind: RecordKind; id: number }): string {
  return `${record.kind}:${record.id}`;
}

function parseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

function isEmpty(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value).length === 0;
}

function shownJson(value: unknown): string | null {
  return isEmpty(value) ? null : JSON.stringify(value, null, 2);
}

/**
 * A stored value as its block shows it: JSON indented for reading, other text as it is, and null when
 * there is nothing in it, so the block is left out.
 */
export function blockText(text: string | null): string | null {
  if (text === null) return null;
  const json = parseJson(text);
  if (json === null) return text.trim() === "" ? null : text;
  return shownJson(json.value);
}

/** A log line's stored fields as Details shows them: without the task the Task field already shows. */
export function logDetailsText(fields: string, taskId: string | null): string | null {
  const json = parseJson(fields);
  if (json === null) return blockText(fields);
  const value = json.value;
  if (taskId !== null && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const rest: Record<string, unknown> = { ...value };
    if (rest.taskId === taskId) delete rest.taskId;
    return shownJson(rest);
  }
  return shownJson(value);
}

export const KIND_LABELS: Record<RecordKind, MessageKey> = {
  log: "records.kindLog",
  "provider-call": "records.kindProviderCall"
};

export const LEVEL_LABELS: Record<RecordLevel, MessageKey> = {
  error: "records.levelError",
  warn: "records.levelWarn",
  info: "records.levelInfo",
  debug: "records.levelDebug"
};

export const LEVEL_FILTER_LABELS: Record<RecordLevelFilter, MessageKey> = {
  attention: "records.levelAttention",
  ...LEVEL_LABELS
};

/** Each level's mark, in the app's own status chips. */
export const LEVEL_CHIPS: Record<RecordLevel, string> = {
  error: "status-chip status-chip-danger",
  warn: "status-chip status-chip-warning",
  info: "status-chip status-chip-muted",
  debug: "status-chip status-chip-muted"
};

// A stored role is the app's own name for which AI role made the call; the ones the interface names
// are shown in the interface language.
const ROLE_LABELS: Readonly<Record<string, MessageKey>> = {
  description: "output.description",
  slug: "output.slug"
};

export function roleLabel(role: string): MessageKey | null {
  return Object.hasOwn(ROLE_LABELS, role) ? ROLE_LABELS[role]! : null;
}

/** The page after the last record shown. */
export function cursorAfter(records: readonly RecordSummary[]): RecordCursor | null {
  const last = records.at(-1);
  return last === undefined ? null : { time: last.time, kind: last.kind, id: last.id };
}

// The order the list shows records in, newest first; the database pages them the same way.
function newestFirst(a: RecordSummary, b: RecordSummary): number {
  if (a.time !== b.time) return a.time < b.time ? 1 : -1;
  if (a.kind !== b.kind) return a.kind < b.kind ? 1 : -1;
  return b.id - a.id;
}

/**
 * The newest page read again, joined with the rows already shown: a row in both takes the page's
 * copy, and the rows shown beyond the page stay, so the pages already read are kept and a page read
 * out of order loses nothing.
 */
export function mergeNewestPage(
  shown: readonly RecordSummary[],
  shownMore: boolean,
  page: RecordsPage
): { records: RecordSummary[]; more: boolean } {
  const byKey = new Map(shown.map((record) => [recordKey(record), record]));
  for (const record of page.records) byKey.set(recordKey(record), record);
  const records = [...byKey.values()].sort(newestFirst);
  const last = page.records.at(-1);
  const beyond = last !== undefined && shown.some((record) => newestFirst(record, last) > 0);
  return { records, more: beyond ? shownMore : page.more };
}
