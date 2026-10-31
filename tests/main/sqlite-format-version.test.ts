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
const writer = { name: "fotoready", version: "1.0.0" };

function inspect(): { version: number; tables: string[]; header: Record<string, string> } {
  const db = new DatabaseSync(file);
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    const header = tables.includes("file_header")
      ? Object.fromEntries((db.prepare("SELECT key, value FROM file_header").all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]))
      : {};
    return { version: (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, tables, header };
  } finally {
    db.close();
  }
}

/** A store as another program might have left it: the schema, a version and these header rows. */
function stored(version: number, rows: Record<string, string> | null): Buffer {
  const db = new DatabaseSync(file);
  db.exec(schema);
  if (rows) {
    db.exec("CREATE TABLE file_header (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const [key, value] of Object.entries(rows)) db.prepare("INSERT INTO file_header (key, value) VALUES (?, ?)").run(key, value);
  }
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
  return fs.readFileSync(file);
}

const RECORDS = { "format.owner": "fotoready", "format.kind": "records" };

it("creates a fresh store with its schema, header and version together", () => {
  openSqliteStore(file, "records", schema, writer).close();
  expect(inspect()).toEqual({
    version: 1,
    tables: ["facts", "file_header"],
    header: { "format.owner": "fotoready", "format.kind": "records", "writer.name": "fotoready", "writer.version": "1.0.0" }
  });
});

it("treats an empty file left by an interrupted creation as new", () => {
  fs.writeFileSync(file, "");
  openSqliteStore(file, "records", schema, writer).close();
  expect(inspect()).toMatchObject({ version: 1, tables: ["facts", "file_header"] });
});

it("opens a current store and rewrites its writer rows, whatever they held", () => {
  stored(1, { ...RECORDS, "writer.name": "something-else", "writer.version": "9.9.9", "writer.caller.name": "x" });
  openSqliteStore(file, "records", schema, writer).close();
  expect(inspect().header).toEqual({ ...RECORDS, "writer.name": "fotoready", "writer.version": "1.0.0" });
});

it("opens a current store with no writer rows", () => {
  stored(1, RECORDS);
  openSqliteStore(file, "records", schema, writer).close();
  expect(inspect().header).toEqual({ ...RECORDS, "writer.name": "fotoready", "writer.version": "1.0.0" });
});

it("refuses a newer store, having written nothing", () => {
  const before = stored(2, RECORDS);
  expect(() => openSqliteStore(file, "records", schema, writer)).toThrow(expect.objectContaining({ name: "NewerFormatError", found: 2, supported: 1 }));
  expect(fs.readFileSync(file)).toEqual(before);
});

it.each([
  ["no version", 0, RECORDS],
  ["no file_header table", 1, null],
  ["another owner", 1, { ...RECORDS, "format.owner": "gptimg" }],
  ["another kind", 1, { ...RECORDS, "format.kind": "backups" }],
  ["no kind row", 1, { "format.owner": "fotoready" }]
])("refuses a store with %s, having written nothing", (_label, version, rows) => {
  const before = stored(version, rows);
  expect(() => openSqliteStore(file, "records", schema, writer)).toThrow(expect.objectContaining({ name: "InvalidSqliteFormatError" }));
  expect(fs.readFileSync(file)).toEqual(before);
});
