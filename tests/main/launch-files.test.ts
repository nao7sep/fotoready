import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLaunchFiles } from "@main/launch-files";
import { openRecordsDatabase } from "@main/records-tables";
import { APP_WRITER } from "@main/app-writer";
import { header } from "../helpers/file-header";

let dir: string;
const paths = () => ({
  settingsPath: path.join(dir, "config.json"),
  apiKeysPath: path.join(dir, "api-keys.json"),
  statePath: path.join(dir, "state.json"),
  recordsPath: path.join(dir, "records.sqlite3"),
  backupsPath: path.join(dir, "backups.sqlite3")
});

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-launch-")); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

/** Every file in the folder with its bytes, so a test can prove the check wrote nothing. */
async function snapshot(): Promise<Record<string, string>> {
  const names = (await fs.readdir(dir)).sort();
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, (await fs.readFile(path.join(dir, name))).toString("base64")] as const)));
}

/** A SQLite store carrying FotoReady's header for `kind` at `version`. */
function sqliteStore(file: string, kind: string, version: number): void {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE file_header (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO file_header VALUES ('format.owner', 'fotoready'), ('format.kind', '${kind}'); PRAGMA user_version = ${version}`);
  db.close();
}

describe("the files FotoReady opens to start", () => {
  it("starts on a first run, writing nothing", async () => {
    expect(await readLaunchFiles(paths())).toEqual({ path: paths().settingsPath, stored: {} });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("starts with readable files and a readable store", async () => {
    await fs.writeFile(paths().settingsPath, JSON.stringify({ ...header("config"), defaultWebpQuality: 71 }));
    await fs.writeFile(paths().apiKeysPath, JSON.stringify({ ...header("api-keys"), keys: {} }));
    await fs.writeFile(paths().statePath, JSON.stringify(header("state")));
    openRecordsDatabase(paths().recordsPath, APP_WRITER).close();
    const before = await snapshot();
    expect((await readLaunchFiles(paths())).stored).toEqual({ defaultWebpQuality: 71 });
    expect(await snapshot()).toEqual(before);
  });

  it("starts with unreadable disposable state and unreadable side stores, which are handled later", async () => {
    await fs.writeFile(paths().statePath, "{ broken");
    await fs.writeFile(paths().recordsPath, "not a database");
    sqliteStore(paths().backupsPath, "records", 1);
    await expect(readLaunchFiles(paths())).resolves.toBeDefined();
  });

  it("stops, naming every refused file with its reason, and writes nothing", async () => {
    await fs.writeFile(paths().settingsPath, "{ broken");
    await fs.writeFile(paths().apiKeysPath, JSON.stringify({ ...header("api-keys", 2), keys: {} }));
    await fs.writeFile(paths().statePath, JSON.stringify(header("state", 2)));
    sqliteStore(paths().recordsPath, "records", 2);
    sqliteStore(paths().backupsPath, "backups", 2);
    const before = await snapshot();

    const stopped = await readLaunchFiles(paths()).then(() => null, (error: unknown) => error);

    expect(stopped).toMatchObject({ name: "LaunchRefusedError" });
    expect((stopped as { files: Array<{ filePath: string; reason: string }> }).files.map(({ filePath, reason }) => ({ filePath, reason }))).toEqual([
      { filePath: paths().settingsPath, reason: "unreadable" },
      { filePath: paths().apiKeysPath, reason: "newer" },
      { filePath: paths().statePath, reason: "newer" },
      { filePath: paths().recordsPath, reason: "newer" },
      { filePath: paths().backupsPath, reason: "newer" }
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ["newer settings", "settingsPath", JSON.stringify(header("config", 2)), "newer"],
    ["settings of another kind", "settingsPath", JSON.stringify(header("state")), "unreadable"],
    ["an unreadable key file", "apiKeysPath", "{ broken", "unreadable"],
    ["a key file of the wrong shape", "apiKeysPath", JSON.stringify(header("api-keys")), "unreadable"]
  ] as const)("stops on %s alone", async (_label, which, text, reason) => {
    await fs.writeFile(paths()[which], text);
    await expect(readLaunchFiles(paths())).rejects.toMatchObject({ files: [{ filePath: paths()[which], reason }] });
    expect(await fs.readFile(paths()[which], "utf8")).toBe(text);
  });
});
