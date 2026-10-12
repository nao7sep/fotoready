import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startStoreWriter, type StoreWriter, type StoreWriterOptions } from "@main/store-writer";
import { createRecordsStore, droppedRecordsRow, fallbackFile, type ProviderCallRecord } from "@main/records-store";
import { createLogger } from "@main/logger";
import { openRecordsDatabase, STORE_BUSY_TIMEOUT_MS } from "@main/records-tables";
import { openBackupsDatabase } from "@main/backup-tables";
import { record, setBackupWriter } from "@main/backup-store";
import { loadSettings, saveSettings } from "@main/settings-io";
import type { StoreWriterWarning } from "@main/store-writer-protocol";

// The real store writer on its own worker thread, as the app runs it, over real databases.

let root: string;
const writers: StoreWriter[] = [];
const locks: DatabaseSync[] = [];
let warnings: StoreWriterWarning[];
const sessionStart = new Date("2026-10-09T05:06:07.250Z");
const session = sessionStart.toISOString();
const recordsFile = () => path.join(root, "records.sqlite3");
const backupsFile = () => path.join(root, "backups.sqlite3");
const logsDir = () => path.join(root, "logs");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-store-writer-"));
  warnings = [];
});

afterEach(async () => {
  setBackupWriter(null);
  for (const lock of locks.splice(0)) {
    try { lock.exec("ROLLBACK"); } catch { /* not in a transaction */ }
    lock.close();
  }
  await Promise.all(writers.splice(0).map((writer) => writer.close({ drain: false, timeoutMs: 0 })));
  fs.rmSync(root, { recursive: true, force: true });
});

function writer(options: Partial<StoreWriterOptions> = {}): StoreWriter {
  const started = startStoreWriter({
    recordsPath: recordsFile(),
    backupsPath: backupsFile(),
    fallbackPath: fallbackFile(logsDir(), sessionStart),
    session,
    droppedRecord: droppedRecordsRow,
    onWarning: (warning) => warnings.push(warning),
    ...options
  });
  writers.push(started);
  return started;
}

const drain = (target: StoreWriter) => target.close({ drain: true, timeoutMs: 10_000 });

function query(file: string, sql: string, ...params: Array<string | number>): Array<Record<string, unknown>> {
  const db = new DatabaseSync(file);
  try {
    return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function fallbackLines(): Array<Record<string, unknown>> {
  const file = fallbackFile(logsDir(), sessionStart);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Another connection holding the database's write lock, as a stalled or contended store would. */
function lock(file: string): void {
  const held = new DatabaseSync(file);
  held.exec("BEGIN EXCLUSIVE");
  locks.push(held);
}

function release(): void {
  for (const held of locks.splice(0)) {
    held.exec("ROLLBACK");
    held.close();
  }
}

const call: ProviderCallRecord = {
  time: "2026-10-09T05:06:08.000Z", taskId: "task-1", provider: "gemini", endpoint: "https://models.example", role: "slug",
  model: "gemini-3.5-flash-lite", attempt: 2, durationMs: 812.6, request: { contents: [{ text: "Slugs" }] },
  response: { candidates: [{ finishReason: "STOP" }] }, error: null
};

describe("records", () => {
  it("stores log lines and provider calls with their session and task, and signals once stored", async () => {
    const target = writer();
    let signals = 0;
    target.onStored(() => { signals += 1; });
    const records = createRecordsStore(target, sessionStart);
    records.writeLog({ time: "2026-10-09T05:06:08.000Z", level: "info", message: "vision started", fields: { mod: "vision", taskId: "task-1" } });
    records.writeProviderCall(call);
    expect(await drain(target)).toBe(true);

    expect(query(recordsFile(), "SELECT session, task_id, level, message FROM log_records")).toEqual([
      { session, task_id: "task-1", level: "info", message: "vision started" }
    ]);
    expect(query(recordsFile(), "SELECT session, task_id, attempt, duration_ms FROM provider_calls")).toEqual([
      { session, task_id: "task-1", attempt: 2, duration_ms: 813 }
    ]);
    expect(query(recordsFile(), "PRAGMA user_version")).toEqual([{ user_version: 1 }]);
    expect(signals).toBeGreaterThan(0);
    expect(fallbackLines()).toEqual([]);
  });

  it("writes each record to this session's text file when the database cannot be opened, signalling nothing", async () => {
    fs.mkdirSync(recordsFile()); // a folder where the database belongs
    const target = writer();
    let signals = 0;
    target.onStored(() => { signals += 1; });
    const records = createRecordsStore(target, sessionStart);
    records.writeLog({ time: "2026-10-09T05:06:08.000Z", level: "info", message: "still recorded", fields: { taskId: "task-1" } });
    records.writeProviderCall({ ...call, response: null, error: new Error("busy") });
    await drain(target);

    const [notice, log, provider] = fallbackLines();
    expect(notice).toMatchObject({ level: "warn", message: "records database unavailable", err: expect.any(Object) });
    expect(log).toEqual({ time: "2026-10-09T05:06:08.000Z", level: "info", message: "still recorded", taskId: "task-1" });
    expect(provider).toMatchObject({ level: "error", message: "provider call", taskId: "task-1" });
    expect(signals).toBe(0);
  });

  it.each([
    ["a newer database", (db: DatabaseSync) => db.exec("CREATE TABLE elsewhere (id INTEGER PRIMARY KEY); PRAGMA user_version = 2"), "NewerFormatError"],
    ["a database with tables but no version", (db: DatabaseSync) => db.exec("CREATE TABLE elsewhere (id INTEGER PRIMARY KEY)"), "InvalidSqliteFormatError"],
    ["an empty database with version -1", (db: DatabaseSync) => db.exec("PRAGMA user_version = -1"), "InvalidSqliteFormatError"],
  ])("leaves %s byte-identical and writes this session's records to the text file", async (_label, prepare, errorName) => {
    const existing = new DatabaseSync(recordsFile());
    prepare(existing);
    existing.close();
    const before = fs.readFileSync(recordsFile());
    const target = writer();
    createRecordsStore(target, sessionStart).writeLog({ time: "2026-10-09T05:06:08.000Z", level: "info", message: "still recorded", fields: {} });
    await drain(target);

    expect(fs.readFileSync(recordsFile()).equals(before)).toBe(true);
    const [notice, log] = fallbackLines();
    expect(notice).toMatchObject({ message: "records database unavailable", err: { name: errorName } });
    expect(log).toMatchObject({ message: "still recorded" });
  });

  it("keeps a record stored when the stored-record signal throws", async () => {
    const target = writer();
    target.onStored(() => { throw new Error("window gone"); });
    createRecordsStore(target, sessionStart).writeLog({ time: "2026-10-09T05:06:08.000Z", level: "info", message: "kept", fields: {} });
    await drain(target);
    expect(query(recordsFile(), "SELECT message FROM log_records")).toEqual([{ message: "kept" }]);
  });
});

describe("a locked or stalled store", () => {
  it("never holds up the main process: a log line, a provider call and a settings save return at once", async () => {
    openRecordsDatabase(recordsFile()).close();
    openBackupsDatabase(backupsFile()).close();
    lock(recordsFile());
    lock(backupsFile());
    const target = writer();
    setBackupWriter(target);
    const logger = createLogger(createRecordsStore(target, sessionStart), { debug: false });
    const records = createRecordsStore(target, sessionStart);
    const settingsPath = path.join(root, "config.json");
    const loaded = await loadSettings(settingsPath);

    const started = performance.now();
    logger.info("ipc settings.get", { mod: "main.ipc" });
    records.writeProviderCall(call);
    await saveSettings(loaded.file, { ...loaded.settings, defaultWebpQuality: 71 }, loaded.settings);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(performance.now() - started).toBeLessThan(STORE_BUSY_TIMEOUT_MS / 2);
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toMatchObject({ defaultWebpQuality: 71 });

    release();
    await drain(target);
  });

  it("drops records beyond its bound while busy, and records how many once it catches up", async () => {
    openRecordsDatabase(recordsFile()).close();
    lock(recordsFile());
    const target = writer({ maxPendingRecords: 2 });
    const records = createRecordsStore(target, sessionStart);
    for (let index = 0; index < 8; index += 1) {
      records.writeLog({ time: sessionStart.toISOString(), level: "info", message: `line ${index}`, fields: {} });
    }
    release();
    await drain(target);

    const messages = [
      ...query(recordsFile(), "SELECT message, fields FROM log_records ORDER BY id"),
      ...fallbackLines().filter((line) => line.message !== "records database unavailable")
    ].map((row) => row.message);
    // The first line was already with the writer; two waited; the other five were dropped.
    expect(messages).toEqual(expect.arrayContaining(["line 0", "line 1", "line 2", "records were dropped while the records store was busy"]));
    expect(messages).toHaveLength(4);
    const notice = query(recordsFile(), "SELECT fields FROM log_records WHERE message LIKE 'records were dropped%'")[0]
      ?? { fields: JSON.stringify(fallbackLines().find((line) => String(line.message).startsWith("records were dropped"))) };
    expect(JSON.parse(String(notice.fields))).toMatchObject({ count: 5 });
  });

  it("gives up the drain at its bound at quit, and skips it at OS session end", async () => {
    openRecordsDatabase(recordsFile()).close();
    lock(recordsFile());
    const draining = writer();
    const records = createRecordsStore(draining, sessionStart);
    for (let index = 0; index < 4; index += 1) records.writeLog({ time: session, level: "info", message: `line ${index}`, fields: {} });
    const started = performance.now();
    expect(await draining.close({ drain: true, timeoutMs: 100 })).toBe(false);
    expect(performance.now() - started).toBeLessThan(STORE_BUSY_TIMEOUT_MS);

    const skipping = writer();
    createRecordsStore(skipping, sessionStart).writeLog({ time: session, level: "info", message: "skipped", fields: {} });
    const skipStarted = performance.now();
    expect(await skipping.close({ drain: false, timeoutMs: 1_000 })).toBe(false);
    expect(performance.now() - skipStarted).toBeLessThan(50);

    const idle = writer();
    expect(await idle.close({ drain: false, timeoutMs: 1_000 })).toBe(true);
  });
});

describe("backups", () => {
  function rows(): Array<Record<string, unknown>> {
    return query(backupsFile(), "SELECT session_id, path, CAST(content AS TEXT) AS content, byte_size FROM backups ORDER BY id");
  }

  it("keeps one row per path per session holding its latest bytes, applied in save order", async () => {
    const target = writer();
    setBackupWriter(target);
    const file = path.join(root, "config.json");
    for (let index = 0; index < 20; index += 1) record(file, Buffer.from(`version ${index}`));
    record(path.join(root, "luts", "warm.cube"), Buffer.from("LUT_3D_SIZE 2"));
    await drain(target);

    expect(rows()).toEqual([
      { session_id: session, path: file, content: "version 19", byte_size: 10 },
      { session_id: session, path: path.join(root, "luts", "warm.cube"), content: "LUT_3D_SIZE 2", byte_size: 13 }
    ]);
    expect(query(backupsFile(), "PRAGMA user_version")).toEqual([{ user_version: 2 }]);
  });

  it("stores the exact bytes: CR/LF and a non-UTF-8 byte, with their SHA-256", async () => {
    const target = writer();
    setBackupWriter(target);
    const file = path.join(root, "config.json");
    const bytes = Buffer.from([0x61, 0x0d, 0x0a, 0xff, 0x62]);
    record(file, bytes);
    await drain(target);
    const [row] = query(backupsFile(), "SELECT content, content_sha256, written_at_utc FROM backups");
    expect(Buffer.from(row!.content as Uint8Array).equals(bytes)).toBe(true);
    expect(row!.content_sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(row!.written_at_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("writes nothing for a session's first save equal to the latest earlier row, and a row once it differs", async () => {
    const file = path.join(root, "config.json");
    const earlier = openBackupsDatabase(backupsFile());
    earlier.record("2026-10-08T00:00:00.000Z", { path: file, bytes: Buffer.from("same"), writtenAt: "2026-10-08T00:00:00.000Z" });
    earlier.close();

    const target = writer();
    setBackupWriter(target);
    record(file, Buffer.from("same"));
    await drain(target);
    expect(rows().map((row) => row.session_id)).toEqual(["2026-10-08T00:00:00.000Z"]);

    const next = writer();
    setBackupWriter(next);
    record(file, Buffer.from("changed"));
    await drain(next);
    expect(rows().map((row) => [row.session_id, row.content])).toEqual([["2026-10-08T00:00:00.000Z", "same"], [session, "changed"]]);
  });

  it("upgrades a store from before sessions in place, keeping its rows as earlier history", async () => {
    const file = path.join(root, "config.json");
    const old = new DatabaseSync(backupsFile());
    old.exec(`
CREATE TABLE backups (id INTEGER PRIMARY KEY, path TEXT NOT NULL, content BLOB NOT NULL, content_sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, written_at_utc TEXT NOT NULL);
CREATE INDEX idx_backups_path_id ON backups (path, id);
PRAGMA user_version = 1;`);
    old.prepare("INSERT INTO backups (path, content, content_sha256, byte_size, written_at_utc) VALUES (?, ?, ?, ?, ?)").run(file, Buffer.from("one"), "h1", 3, "2026-07-06T04:05:12.345Z");
    old.prepare("INSERT INTO backups (path, content, content_sha256, byte_size, written_at_utc) VALUES (?, ?, ?, ?, ?)").run(file, Buffer.from("two"), "h2", 3, "2026-07-07T04:05:12.345Z");
    old.close();

    const target = writer();
    setBackupWriter(target);
    record(file, Buffer.from("three"));
    await drain(target);

    expect(rows().map((row) => [row.session_id, row.content])).toEqual([[null, "one"], [null, "two"], [session, "three"]]);
    expect(query(backupsFile(), "PRAGMA user_version")).toEqual([{ user_version: 2 }]);
  });

  it("leaves a newer store byte-identical, records nothing and warns once", async () => {
    const newer = new DatabaseSync(backupsFile());
    newer.exec("CREATE TABLE backups (id INTEGER PRIMARY KEY); PRAGMA user_version = 3");
    newer.close();
    const before = fs.readFileSync(backupsFile());
    const target = writer();
    setBackupWriter(target);
    record(path.join(root, "config.json"), Buffer.from("a"));
    record(path.join(root, "config.json"), Buffer.from("b"));
    await drain(target);

    expect(fs.readFileSync(backupsFile()).equals(before)).toBe(true);
    expect(warnings).toEqual([{ message: "backup store: could not open; recording disabled for this session", fields: expect.objectContaining({ err: expect.objectContaining({ name: "NewerFormatError" }) }) }]);
  });
});
