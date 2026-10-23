import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordRow } from "@main/records-tables";
import type { StoreWriterData, StoreWriterRequest } from "@main/store-writer-protocol";

const boundary = vi.hoisted(() => ({
  port: { on: vi.fn<(event: string, listener: (request: StoreWriterRequest) => void) => void>(), postMessage: vi.fn() },
  data: {} as StoreWriterData,
  openRecords: vi.fn(), insert: vi.fn(), closeRecords: vi.fn(),
  openBackups: vi.fn(), recordBackup: vi.fn(), closeBackups: vi.fn()
}));
vi.mock("node:worker_threads", () => ({ parentPort: boundary.port, workerData: boundary.data }));
vi.mock("@main/records-tables", () => ({ openRecordsDatabase: boundary.openRecords }));
vi.mock("@main/backup-tables", () => ({ openBackupsDatabase: boundary.openBackups }));

let root: string;
let receive: (request: StoreWriterRequest) => void;
const session = "2026-10-09T05:06:07.250Z";
const row = (message: string): RecordRow => ({
  table: "log", time: session, taskId: null, level: "info", message, fields: "{}",
  fallback: JSON.stringify({ message })
});
const lines = (): Array<{ message: string }> => fs.readFileSync(boundary.data.fallbackPath, "utf8")
  .trim().split("\n").map((line) => JSON.parse(line) as { message: string });

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-store-writer-batch-"));
  Object.assign(boundary.data, {
    recordsPath: path.join(root, "records.sqlite3"), backupsPath: path.join(root, "backups.sqlite3"),
    fallbackPath: path.join(root, "logs", "fallback.log"), session
  });
  boundary.insert.mockReset();
  boundary.openRecords.mockReset().mockReturnValue({ insert: boundary.insert, close: boundary.closeRecords });
  boundary.recordBackup.mockReset();
  boundary.openBackups.mockReturnValue({ record: boundary.recordBackup, close: boundary.closeBackups });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await import("../../src/main/workers/store-writer");
  receive = boundary.port.on.mock.calls[0]![1];
});
afterEach(() => {
  receive({ kind: "close" });
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("one failed records attempt per batch", () => {
  it.each(["open", "insert"] as const)("falls back after a transient %s failure, advances backups, and retries the next batch", (failure) => {
    const busy = new Error("database is locked after its busy timeout");
    if (failure === "open") boundary.openRecords.mockImplementationOnce(() => { throw busy; });
    else boundary.insert.mockImplementationOnce(() => { throw busy; });
    const failed = [row("one"), row("two"), row("three")];
    const backup = { path: path.join(root, "config.json"), bytes: Buffer.from("saved"), writtenAt: session };
    boundary.recordBackup.mockImplementationOnce(() => {
      // Backups only run after every record in the failed batch reached fallback.
      expect(lines().map((line) => line.message)).toEqual(["records database unavailable", "one", "two", "three"]);
    });
    receive({ kind: "batch", id: 1, records: failed, backups: [backup] });
    expect(boundary.openRecords).toHaveBeenCalledTimes(1);
    expect(boundary.insert).toHaveBeenCalledTimes(failure === "open" ? 0 : 1);
    expect(boundary.recordBackup).toHaveBeenCalledExactlyOnceWith(session, backup);
    expect(boundary.port.postMessage).toHaveBeenLastCalledWith({ kind: "done", id: 1, stored: 0, warnings: [] });

    const recovered = row("recovered");
    receive({ kind: "batch", id: 2, records: [recovered], backups: [] });
    expect(boundary.openRecords).toHaveBeenCalledTimes(failure === "open" ? 2 : 1);
    expect(boundary.insert).toHaveBeenLastCalledWith(session, recovered);
    expect(boundary.insert).toHaveBeenCalledTimes(failure === "open" ? 1 : 2);
    expect(boundary.port.postMessage).toHaveBeenLastCalledWith({ kind: "done", id: 2, stored: 1, warnings: [] });
    expect(lines()).toHaveLength(4);
  });

  it("keeps records already inserted before the batch's failure and falls back only for the remainder", () => {
    boundary.insert.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("locked"); });
    receive({ kind: "batch", id: 1, records: [row("stored"), row("failed"), row("remaining")], backups: [] });
    expect(boundary.insert).toHaveBeenCalledTimes(2);
    expect(lines().map((line) => line.message)).toEqual(["records database unavailable", "failed", "remaining"]);
    expect(boundary.port.postMessage).toHaveBeenLastCalledWith({ kind: "done", id: 1, stored: 1, warnings: [] });
  });

  it.each(["newer", "invalid"] as const)("continues refusing a %s format in later batches", async (format) => {
    const { NewerFormatError } = await import("@shared/format-versions");
    const { InvalidSqliteFormatError } = await import("@main/sqlite-format-version");
    boundary.openRecords.mockImplementationOnce(() => {
      throw format === "newer" ? new NewerFormatError(boundary.data.recordsPath, 2, 1) : new InvalidSqliteFormatError(boundary.data.recordsPath);
    });
    receive({ kind: "batch", id: 1, records: [row("one")], backups: [] });
    receive({ kind: "batch", id: 2, records: [row("two")], backups: [] });
    expect(boundary.openRecords).toHaveBeenCalledTimes(1);
    expect(boundary.insert).not.toHaveBeenCalled();
    expect(lines().map((line) => line.message)).toEqual(["records database unavailable", "one", "two"]);
  });
});
