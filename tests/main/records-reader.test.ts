import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRecordsReader, type RecordsReader } from "@main/records-reader";
import { openRecordsStore, type RecordsStore } from "@main/records-store";
import type { RecordsQuery } from "@shared/records";

// The reader runs the real records worker, as the app does, over a database the main process's own
// store writes.

let root: string;
const readers: RecordsReader[] = [];
const stores: RecordsStore[] = [];
const dbFile = () => path.join(root, "records.sqlite3");
const ALL: RecordsQuery = { session: null, kind: null, level: null, taskId: null, search: "", after: null };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-records-reader-"));
});

afterEach(async () => {
  await Promise.all(readers.splice(0).map((reader) => reader.close()));
  for (const store of stores.splice(0)) store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function reader(options?: { timeoutMs?: number }): RecordsReader {
  const created = createRecordsReader(dbFile(), options);
  readers.push(created);
  return created;
}

function store(): RecordsStore {
  const created = openRecordsStore(dbFile(), path.join(root, "logs"), new Date("2026-10-02T08:00:00.000Z"));
  stores.push(created);
  return created;
}

describe("createRecordsReader", () => {
  it("reads on the worker every record the open store has written", async () => {
    const records = store();
    records.writeLog({ time: "2026-10-02T08:00:01.000Z", level: "info", message: "first", fields: {} });
    const read = reader();
    expect((await read.read({ op: "page", query: ALL })).records.map((record) => record.title)).toEqual(["first"]);

    records.writeLog({ time: "2026-10-02T08:00:02.000Z", level: "warn", message: "second", fields: {} });
    expect((await read.read({ op: "page", query: ALL })).records.map((record) => record.title)).toEqual(["second", "first"]);
    expect(await read.read({ op: "sources" })).toEqual({ sessions: ["2026-10-02T08:00:00.000Z"], taskIds: [] });
  });

  it("fails a read while the database is missing, and reads it once it exists", async () => {
    const read = reader();
    await expect(read.read({ op: "page", query: ALL })).rejects.toThrow();

    store().writeLog({ time: "2026-10-02T08:00:01.000Z", level: "info", message: "later", fields: {} });
    expect((await read.read({ op: "page", query: ALL })).records).toHaveLength(1);
  });

  it("gives up on a read that does not answer in time", async () => {
    store().writeLog({ time: "2026-10-02T08:00:01.000Z", level: "info", message: "kept", fields: {} });
    // A worker cannot even start within a millisecond.
    const read = reader({ timeoutMs: 1 });
    await expect(read.read({ op: "page", query: ALL })).rejects.toThrow("did not finish within 1 ms");
  });

  it("fails every read after it closes", async () => {
    const read = reader();
    await read.close();
    await expect(read.read({ op: "sources" })).rejects.toThrow("closed");
  });
});
