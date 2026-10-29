import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import type { RecordRow } from "@main/records-tables";

const workers = vi.hoisted(() => [] as Array<{
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  finish(): void;
}>);
vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    unref() {}
    finish!: () => void;
    terminate = vi.fn(() => new Promise<number>((resolve) => { this.finish = () => resolve(0); }));
    constructor() { super(); workers.push(this); }
  }
}));
import { startStoreWriter } from "@main/store-writer";

afterEach(() => { workers.length = 0; vi.useRealTimers(); });

it("skips the drain at OS session end without waiting for worker termination to settle", async () => {
  vi.useFakeTimers();
  const row: RecordRow = {
    table: "log", time: "2026-10-09T05:06:07.250Z", taskId: null, level: "info",
    message: "pending", fields: "{}", fallback: "pending"
  };
  const writer = startStoreWriter({
    recordsPath: "unused-records.sqlite3", backupsPath: "unused-backups.sqlite3", fallbackPath: "unused.log",
    session: row.time, onWarning: vi.fn()
  });
  writer.writeRecord(row);
  const owner = workers[0]!;
  expect(owner.postMessage).toHaveBeenCalledTimes(1);
  let result: boolean | undefined;
  const closing = writer.close({ drain: false }).then((value) => { result = value; });
  try {
    await Promise.resolve();
    expect(owner.terminate).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    owner.finish();
    await closing;
  }
});

it("sends nothing after the close message, so a record arriving then cannot reopen a store", async () => {
  const row: RecordRow = {
    table: "log", time: "2026-10-09T05:06:07.250Z", taskId: null, level: "info",
    message: "past the exit", fields: "{}", fallback: "past the exit"
  };
  const writer = startStoreWriter({
    recordsPath: "unused-records.sqlite3", backupsPath: "unused-backups.sqlite3", fallbackPath: "unused.log",
    session: row.time, onWarning: vi.fn()
  });
  const owner = workers[0]! as unknown as EventEmitter & { postMessage: ReturnType<typeof vi.fn> };
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const closing = writer.close({ drain: true });
  await Promise.resolve();
  expect(owner.postMessage).toHaveBeenLastCalledWith({ kind: "close" });
  writer.writeRecord(row);
  writer.writeBackup({ path: "/config.json", bytes: new Uint8Array([1]), writtenAt: row.time });
  expect(owner.postMessage).toHaveBeenCalledTimes(1);
  owner.emit("message", { kind: "closed" });
  expect(await closing).toBe(true);
  log.mockRestore();
});
