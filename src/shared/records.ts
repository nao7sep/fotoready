// What the Records window reads from records.sqlite3: a filtered page of summaries, newest first,
// and one record whole. JSON fields arrive as the text the database holds; the window decides how
// to show them.
//
// The records worker runs this module under Node's own TypeScript stripping in the tests, so it
// imports nothing at runtime.

export type RecordKind = "log" | "provider-call";

export type RecordLevel = "debug" | "info" | "warn" | "error";

export const RECORD_KINDS: readonly RecordKind[] = ["log", "provider-call"];

export const RECORD_LEVELS: readonly RecordLevel[] = ["error", "warn", "info", "debug"];

// What the level filter offers: a record's own level, or `attention`, every record at `warn` or
// `error`.
export type RecordLevelFilter = "attention" | RecordLevel;

export const RECORD_LEVEL_FILTERS: readonly RecordLevelFilter[] = ["attention", ...RECORD_LEVELS];

export const RECORDS_PAGE_SIZE = 100;

// Where the next page starts: the last summary of the page before it.
export type RecordCursor = {
  time: string;
  kind: RecordKind;
  id: number;
};

export type RecordsQuery = {
  // A launch, named by its session.
  session: string | null;
  kind: RecordKind | null;
  // A provider call reads as `error` when it failed and `info` otherwise.
  level: RecordLevelFilter | null;
  taskId: string | null;
  search: string;
  after: RecordCursor | null;
};

export type RecordSummary = {
  kind: RecordKind;
  id: number;
  session: string;
  time: string;
  level: RecordLevel;
  // A log line's message, or a provider call's provider and role.
  title: string;
  // A log line's module, or a provider call's model.
  text: string | null;
  taskId: string | null;
};

export type RecordsPage = {
  records: RecordSummary[];
  more: boolean;
};

export type LogRecordDetail = {
  kind: "log";
  id: number;
  session: string;
  time: string;
  level: RecordLevel;
  message: string;
  taskId: string | null;
  fields: string;
};

export type ProviderCallRecordDetail = {
  kind: "provider-call";
  id: number;
  session: string;
  time: string;
  durationMs: number;
  taskId: string | null;
  provider: string;
  endpoint: string;
  role: string;
  model: string;
  attempt: number;
  request: string;
  response: string | null;
  error: string | null;
};

export type RecordDetail = LogRecordDetail | ProviderCallRecordDetail;

// What the records worker is asked, and what it answers.
export type RecordsRead =
  | { op: "page"; query: RecordsQuery }
  | { op: "sources" }
  | { op: "detail"; kind: RecordKind; id: number };

export type RecordsReadResults = {
  page: RecordsPage;
  sources: { sessions: string[]; taskIds: string[] };
  detail: RecordDetail | null;
};

// The values the filters offer: every launch and every task that has records.
export type RecordSources = {
  currentSession: string;
  sessions: string[];
  // A task still in the workspace carries its original's file name.
  tasks: { taskId: string; name: string | null }[];
};

// The channel on which the main process tells the Records window that a record was stored.
export const RECORDS_CHANGED_CHANNEL = "records.changed";
