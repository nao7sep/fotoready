import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRecordsStore, writeFallbackRecord, type ProviderCallRecord } from "@main/records-store";

let root: string;
const dbFile = () => path.join(root, "records.sqlite3");
const logsDir = () => path.join(root, "logs");
const sessionStart = new Date("2026-10-02T03:15:42.123Z");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-records-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function query(sql: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(dbFile());
  try {
    return db.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function fallbackLines(): Array<Record<string, unknown>> {
  const file = path.join(logsDir(), "20261002-031542-123-utc.log");
  return fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

const call: ProviderCallRecord = {
  time: "2026-10-02T03:16:00.000Z",
  taskId: "task-1",
  provider: "gemini",
  endpoint: "https://models.example",
  role: "slug",
  model: "gemini-3.5-flash-lite",
  attempt: 2,
  durationMs: 812.6,
  request: { model: "gemini-3.5-flash-lite", contents: [{ text: "Slugs" }] },
  response: { candidates: [{ finishReason: "STOP" }], usageMetadata: { totalTokenCount: 42 } },
  error: null
};

describe("openRecordsStore", () => {
  it("stores each log line with its session and task", () => {
    const records = openRecordsStore(dbFile(), logsDir(), sessionStart);
    records.writeLog({ time: "2026-10-02T03:15:43.000Z", level: "info", message: "vision started", fields: { mod: "vision", taskId: "task-1" } });
    records.writeLog({ time: "2026-10-02T03:15:44.000Z", level: "warn", message: "no task", fields: { mod: "main" } });
    records.close();

    expect(query("SELECT time, session, task_id, level, message, fields FROM log_records ORDER BY id")).toEqual([
      { time: "2026-10-02T03:15:43.000Z", session: sessionStart.toISOString(), task_id: "task-1", level: "info", message: "vision started", fields: '{"mod":"vision","taskId":"task-1"}' },
      { time: "2026-10-02T03:15:44.000Z", session: sessionStart.toISOString(), task_id: null, level: "warn", message: "no task", fields: '{"mod":"main"}' }
    ]);
  });

  it("stores a provider call whole, request and response, with its session and task", () => {
    const records = openRecordsStore(dbFile(), logsDir(), sessionStart);
    records.writeProviderCall(call);
    records.writeProviderCall({ ...call, attempt: 1, response: null, error: Object.assign(new Error("busy"), { status: 503 }) });
    records.close();

    const [ok, failed] = query("SELECT * FROM provider_calls ORDER BY id");
    expect(ok).toMatchObject({
      time: call.time, session: sessionStart.toISOString(), task_id: "task-1", provider: "gemini",
      endpoint: "https://models.example", role: "slug", model: "gemini-3.5-flash-lite", attempt: 2, duration_ms: 813, error: null
    });
    expect(JSON.parse(ok!.request as string)).toEqual(call.request);
    expect(JSON.parse(ok!.response as string)).toEqual(call.response);
    expect(failed!.response).toBeNull();
    expect(JSON.parse(failed!.error as string)).toMatchObject({ name: "Error", message: "busy", status: 503, stack: expect.any(String) });
  });

  it("leaves existing log files where they are", () => {
    fs.mkdirSync(logsDir());
    const old = path.join(logsDir(), "20200101-000000-000-utc.log");
    fs.writeFileSync(old, "{}\n");
    openRecordsStore(dbFile(), logsDir(), sessionStart).close();
    expect(fs.readFileSync(old, "utf8")).toBe("{}\n");
  });

  it("writes each record to this session's text file when the database cannot be opened", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fs.mkdirSync(dbFile()); // a folder where the database file belongs
    const records = openRecordsStore(dbFile(), logsDir(), sessionStart);
    records.writeLog({ time: "2026-10-02T03:15:43.000Z", level: "info", message: "still recorded", fields: { taskId: "task-1" } });
    records.writeProviderCall(call);
    records.close();

    const [notice, log, provider] = fallbackLines();
    expect(notice).toMatchObject({ level: "warn", message: "records database unavailable", err: expect.any(Object) });
    expect(log).toEqual({ time: "2026-10-02T03:15:43.000Z", level: "info", message: "still recorded", taskId: "task-1" });
    expect(provider).toMatchObject({ message: "provider call", taskId: "task-1", request: call.request, response: call.response });
  });

  it("falls back to the console when the text file cannot be written either, and never throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    fs.mkdirSync(dbFile());
    fs.writeFileSync(logsDir(), "x"); // a file where the fallback folder belongs
    const records = openRecordsStore(dbFile(), logsDir(), sessionStart);
    expect(() => records.writeLog({ time: "2026-10-02T03:15:43.000Z", level: "info", message: "still alive", fields: {} })).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"message":"still alive"'));
    expect(errorSpy).toHaveBeenCalled();
    records.close();
  });

  it("has an idempotent close", () => {
    const records = openRecordsStore(dbFile(), logsDir(), sessionStart);
    expect(() => {
      records.close();
      records.close();
    }).not.toThrow();
  });
});

describe("writeFallbackRecord", () => {
  it("writes the record to this session's text file", () => {
    writeFallbackRecord(logsDir(), sessionStart, { time: "2026-10-02T03:15:43.000Z", level: "error", message: "startup failed" }, "error");
    expect(fallbackLines()).toEqual([{ time: "2026-10-02T03:15:43.000Z", level: "error", message: "startup failed" }]);
  });

  it("writes the record to the console when the text file cannot be written, and never throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fs.writeFileSync(logsDir(), "x"); // a file where the fallback folder belongs
    expect(() => writeFallbackRecord(logsDir(), sessionStart, { level: "error", message: "startup failed" }, "error")).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"message":"startup failed"'));
  });
});
