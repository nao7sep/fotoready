import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRecordsStore, type ProviderCallRecord, type RecordsStore } from "@main/records-store";
import { readRecords } from "@main/records-queries";
import { RECORDS_PAGE_SIZE, type RecordsQuery, type RecordSummary } from "@shared/records";

let root: string;
let db: DatabaseSync | null = null;
const dbFile = () => path.join(root, "records.sqlite3");
const first = new Date("2026-10-01T08:00:00.000Z");
const second = new Date("2026-10-02T08:00:00.000Z");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-records-read-"));
});

afterEach(() => {
  db?.close();
  db = null;
  fs.rmSync(root, { recursive: true, force: true });
});

const ALL: RecordsQuery = { session: null, kind: null, level: null, taskId: null, search: "", after: null };

const call = (time: string, overrides: Partial<ProviderCallRecord> = {}): ProviderCallRecord => ({
  time,
  taskId: "task-1",
  provider: "gemini",
  endpoint: "https://models.example",
  role: "description",
  model: "gemini-3.5-flash",
  attempt: 1,
  durationMs: 1250,
  request: { contents: [{ text: "Describe" }] },
  response: { text: "A harbour at dusk" },
  error: null,
  ...overrides
});

function store(sessionStart: Date, write: (records: RecordsStore) => void): void {
  const records = openRecordsStore(dbFile(), path.join(root, "logs"), sessionStart);
  write(records);
  records.close();
}

function open(): DatabaseSync {
  db = new DatabaseSync(dbFile(), { readOnly: true });
  return db;
}

const page = (query: Partial<RecordsQuery> = {}) => readRecords(open(), { op: "page", query: { ...ALL, ...query } });
const titles = (records: RecordSummary[]) => records.map((record) => record.title);

function seed(): void {
  store(first, (records) => {
    records.writeLog({ time: "2026-10-01T08:00:01.000Z", level: "info", message: "app started", fields: { mod: "main.bootstrap" } });
    records.writeLog({ time: "2026-10-01T08:00:02.000Z", level: "debug", message: "ipc preview.render", fields: { mod: "main.ipc" } });
  });
  store(second, (records) => {
    records.writeLog({ time: "2026-10-02T08:00:01.000Z", level: "warn", message: "vision retry", fields: { mod: "vision", taskId: "task-1" } });
    records.writeProviderCall(call("2026-10-02T08:00:02.000Z", { response: null, error: new Error("quota exceeded") }));
    records.writeProviderCall(call("2026-10-02T08:00:03.000Z", { role: "slug", taskId: "task-2" }));
    records.writeLog({ time: "2026-10-02T08:00:04.000Z", level: "error", message: "save failed", fields: { mod: "main.ipc", err: { message: "EACCES" } } });
  });
}

describe("readRecords: page", () => {
  it("lists log lines and provider calls together, newest first, summarized", () => {
    seed();
    const { records, more } = page();
    expect(more).toBe(false);
    expect(titles(records)).toEqual([
      "save failed", "gemini slug", "gemini description", "vision retry", "ipc preview.render", "app started"
    ]);
    expect(records[0]).toEqual({
      kind: "log", id: 4, session: second.toISOString(), time: "2026-10-02T08:00:04.000Z", level: "error",
      title: "save failed", text: "main.ipc", taskId: null
    });
    expect(records[1]).toMatchObject({ kind: "provider-call", level: "info", text: "gemini-3.5-flash", taskId: "task-2" });
  });

  it("reads a failed provider call as an error", () => {
    seed();
    expect(page({ kind: "provider-call" }).records.map((record) => record.level)).toEqual(["info", "error"]);
  });

  it("filters by launch, kind, task and level", () => {
    seed();
    expect(titles(page({ session: first.toISOString() }).records)).toEqual(["ipc preview.render", "app started"]);
    expect(titles(page({ kind: "log" }).records)).toEqual(["save failed", "vision retry", "ipc preview.render", "app started"]);
    expect(titles(page({ taskId: "task-1" }).records)).toEqual(["gemini description", "vision retry"]);
    expect(titles(page({ level: "error" }).records)).toEqual(["save failed", "gemini description"]);
    expect(titles(page({ level: "debug" }).records)).toEqual(["ipc preview.render"]);
  });

  it("offers warnings, errors and failed provider calls as needing attention", () => {
    seed();
    expect(titles(page({ level: "attention" }).records)).toEqual(["save failed", "gemini description", "vision retry"]);
  });

  it("searches every stored field, taking the search text literally", () => {
    seed();
    expect(titles(page({ search: "EACCES" }).records)).toEqual(["save failed"]);
    expect(titles(page({ search: "quota" }).records)).toEqual(["gemini description"]);
    expect(titles(page({ search: "harbour" }).records)).toEqual(["gemini slug"]);
    expect(titles(page({ search: "  " }).records)).toHaveLength(6);
    expect(page({ search: "%" }).records).toEqual([]);
  });

  it("pages by a cursor, a hundred records at a time, without repeating or skipping one", () => {
    store(second, (records) => {
      for (let index = 0; index < RECORDS_PAGE_SIZE + 20; index++) {
        // Pairs share a time, so the cursor has to break ties.
        const time = new Date(Date.UTC(2026, 9, 2, 8, 0, Math.floor(index / 2))).toISOString();
        if (index % 2 === 0) records.writeLog({ time, level: "info", message: `line ${index}`, fields: {} });
        else records.writeProviderCall(call(time, { model: `model ${index}` }));
      }
    });
    const firstPage = page();
    expect(firstPage.records).toHaveLength(RECORDS_PAGE_SIZE);
    expect(firstPage.more).toBe(true);
    const last = firstPage.records.at(-1)!;
    const secondPage = page({ after: { time: last.time, kind: last.kind, id: last.id } });
    expect(secondPage.records).toHaveLength(20);
    expect(secondPage.more).toBe(false);
    const keys = [...firstPage.records, ...secondPage.records].map((record) => `${record.kind}:${record.id}`);
    expect(new Set(keys).size).toBe(RECORDS_PAGE_SIZE + 20);
  });
});

describe("readRecords: detail and sources", () => {
  it("reads one record whole, every field as stored", () => {
    seed();
    expect(readRecords(open(), { op: "detail", kind: "log", id: 4 })).toEqual({
      kind: "log", id: 4, session: second.toISOString(), time: "2026-10-02T08:00:04.000Z", level: "error",
      message: "save failed", taskId: null, fields: JSON.stringify({ mod: "main.ipc", err: { message: "EACCES" } })
    });
    const failed = readRecords(open(), { op: "detail", kind: "provider-call", id: 1 });
    expect(failed).toMatchObject({
      kind: "provider-call", id: 1, session: second.toISOString(), time: "2026-10-02T08:00:02.000Z", durationMs: 1250,
      taskId: "task-1", provider: "gemini", endpoint: "https://models.example", role: "description",
      model: "gemini-3.5-flash", attempt: 1, response: null
    });
    expect(JSON.parse((failed as { request: string }).request)).toEqual({ contents: [{ text: "Describe" }] });
    expect(JSON.parse((failed as { error: string }).error)).toMatchObject({ message: "quota exceeded" });
    expect(readRecords(open(), { op: "detail", kind: "log", id: 99 })).toBeNull();
  });

  it("lists every launch and every task that has records, newest first", () => {
    seed();
    expect(readRecords(open(), { op: "sources" })).toEqual({
      sessions: [second.toISOString(), first.toISOString()],
      taskIds: ["task-2", "task-1"]
    });
  });
});
