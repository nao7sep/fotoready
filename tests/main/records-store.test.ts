import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { droppedRecordsRow, logRow, providerCallRow, writeFallbackRecord, type ProviderCallRecord } from "@main/records-store";

let root: string;
const logsDir = () => path.join(root, "logs");
const sessionStart = new Date("2026-10-02T03:15:42.123Z");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-records-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});


function fallbackLines(): Array<Record<string, unknown>> {
  const file = path.join(logsDir(), "20261002-031542-utc.log");
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

describe("records as the store writer receives them", () => {
  it("serializes a log line with its task, and the line that stands in for it in the text file", () => {
    expect(logRow({ time: "2026-10-02T03:15:43.000Z", level: "info", message: "vision started", fields: { mod: "vision", taskId: "task-1" } })).toEqual({
      table: "log", time: "2026-10-02T03:15:43.000Z", taskId: "task-1", level: "info", message: "vision started",
      fields: '{"mod":"vision","taskId":"task-1"}',
      fallback: '{"time":"2026-10-02T03:15:43.000Z","level":"info","message":"vision started","mod":"vision","taskId":"task-1"}'
    });
  });

  it("serializes a provider call whole, and a failed one at the error level the Records window reads", () => {
    const ok = providerCallRow(call);
    expect(ok).toMatchObject({ table: "call", taskId: "task-1", attempt: 2, durationMs: 813, level: "info", error: null });
    expect(JSON.parse((ok as { request: string }).request)).toEqual(call.request);
    const failed = providerCallRow({ ...call, response: null, error: Object.assign(new Error("busy"), { status: 503 }) });
    expect(failed).toMatchObject({ level: "error", response: null });
    expect(JSON.parse((failed as { error: string }).error)).toMatchObject({ name: "Error", message: "busy", status: 503 });
    expect(JSON.parse(failed.fallback)).toMatchObject({ level: "error", message: "provider call", taskId: "task-1" });
  });

  it("reports how many records were dropped while the store was busy", () => {
    expect(droppedRecordsRow(7)).toMatchObject({ table: "log", level: "warn", message: "records were dropped while the records store was busy", fields: '{"mod":"main.records","count":7}' });
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
