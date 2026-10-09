import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openSqliteStore } from "@main/sqlite-format-version";

let root: string;
let file: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-sqlite-open-")); file = path.join(root, "facts.sqlite3"); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
const schema = "CREATE TABLE facts (id INTEGER PRIMARY KEY, note TEXT)";

function inspect(): { version: number; tables: string[] } {
  const db = new DatabaseSync(file);
  try {
    return {
      version: (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      tables: (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name)
    };
  } finally {
    db.close();
  }
}

it("creates a fresh store with its schema and version together", () => {
  openSqliteStore(file, 2, schema).close();
  expect(inspect()).toEqual({ version: 2, tables: ["facts"] });
});

it("treats an empty file left by an interrupted creation as new", () => {
  fs.writeFileSync(file, "");
  openSqliteStore(file, 1, schema).close();
  expect(inspect()).toEqual({ version: 1, tables: ["facts"] });
});

it("opens a current store without changing it", () => {
  openSqliteStore(file, 1, schema).close();
  const before = fs.readFileSync(file);
  openSqliteStore(file, 1, schema).close();
  expect(fs.readFileSync(file)).toEqual(before);
});

it("refuses a newer store, having written nothing", () => {
  const db = new DatabaseSync(file);
  db.exec(schema);
  db.exec("PRAGMA user_version = 3");
  db.close();
  const before = fs.readFileSync(file);
  expect(() => openSqliteStore(file, 2, schema)).toThrow(expect.objectContaining({ name: "NewerFormatError", found: 3, supported: 2 }));
  expect(fs.readFileSync(file)).toEqual(before);
});

it("refuses a store with tables but no version, having written nothing", () => {
  const db = new DatabaseSync(file);
  db.exec(schema);
  db.close();
  const before = fs.readFileSync(file);
  expect(() => openSqliteStore(file, 1, schema)).toThrow(expect.objectContaining({ name: "InvalidSqliteFormatError" }));
  expect(fs.readFileSync(file)).toEqual(before);
});

it("upgrades a store at a known earlier version in place, keeping its rows", () => {
  const db = new DatabaseSync(file);
  db.exec(schema);
  db.exec("INSERT INTO facts (note) VALUES ('kept')");
  db.exec("PRAGMA user_version = 1");
  db.close();
  openSqliteStore(file, 2, `${schema}; CREATE TABLE more (id INTEGER PRIMARY KEY)`, { upgrades: { 1: "CREATE TABLE more (id INTEGER PRIMARY KEY)" } }).close();
  expect(inspect()).toEqual({ version: 2, tables: ["facts", "more"] });
  const check = new DatabaseSync(file);
  expect(check.prepare("SELECT note FROM facts").all()).toEqual([{ note: "kept" }]);
  check.close();
});

it("refuses an earlier version it has no upgrade for, having written nothing", () => {
  const db = new DatabaseSync(file);
  db.exec(schema);
  db.exec("PRAGMA user_version = 1");
  db.close();
  const before = fs.readFileSync(file);
  expect(() => openSqliteStore(file, 2, schema)).toThrow(expect.objectContaining({ name: "InvalidSqliteFormatError" }));
  expect(fs.readFileSync(file)).toEqual(before);
});
