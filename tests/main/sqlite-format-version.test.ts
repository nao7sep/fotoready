import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewerFormatError } from "@shared/format-versions";
import { openSqliteStore } from "@main/sqlite-format-version";
let root: string;
let file: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-sqlite-init-")); file = path.join(root, "records.sqlite3"); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const schema = "CREATE TABLE facts (id INTEGER PRIMARY KEY)";

it("leaves no final store or staging when schema initialization fails", () => {
  expect(() => openSqliteStore(file, 1, `${schema}; invalid sql`)).toThrow();
  expect(fs.readdirSync(root)).toEqual([]);
});
it("claims the final name only with complete schema and marker", () => {
  const link = fs.linkSync;
  vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
    expect(fs.existsSync(file)).toBe(false);
    const inspected = new DatabaseSync(String(from), { readOnly: true });
    try {
      expect(inspected.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 1 });
      expect(inspected.prepare("SELECT * FROM facts").all()).toEqual([]);
    } finally { inspected.close(); }
    link(from, to);
  });
  openSqliteStore(file, 1, schema).close();
  expect(fs.readdirSync(root)).toEqual(["records.sqlite3"]);
});
it("preserves a competing newer final store and refuses it", () => {
  vi.spyOn(fs, "linkSync").mockImplementation(() => {
    const competitor = new DatabaseSync(file);
    competitor.exec("CREATE TABLE future (id); PRAGMA user_version = 2"); competitor.close();
    throw Object.assign(new Error("exists"), { code: "EEXIST" });
  });
  expect(() => openSqliteStore(file, 1, schema)).toThrow(NewerFormatError);
  const inspected = new DatabaseSync(file);
  try { expect(inspected.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 }); expect(inspected.prepare("SELECT * FROM future").all()).toEqual([]); }
  finally { inspected.close(); }
  expect(fs.readdirSync(root)).toEqual(["records.sqlite3"]);
});
it("uses an exclusive complete copy when hard links are unavailable", () => {
  vi.spyOn(fs, "linkSync").mockImplementation(() => { throw Object.assign(new Error("unsupported"), { code: "ENOTSUP" }); });
  const db = openSqliteStore(file, 1, schema);
  try { expect(db.prepare("SELECT * FROM facts").all()).toEqual([]); }
  finally { db.close(); }
});
