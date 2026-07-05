// End-to-end backup runs over a throwaway home root: a first run captures the user's work-product
// (config.json and other durable managed data) at their mirror paths while excluding the volatile
// state.json, the api-keys.json secret, the imported luts/ + stamps/ instrument trees, and .invalid
// quarantine copies; an unchanged run writes nothing; an edit captures only what changed; a corrupt
// index resets to a full backup; and a case-insensitive path collision is skipped without failing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yauzl from "yauzl";
import { runBackup } from "@main/backup/backup-engine";
import type { BackupPaths } from "@main/backup/backup-types";

const RUN1 = new Date("2026-07-01T00:00:00Z");
const RUN2 = new Date("2026-07-01T01:00:00Z");

let home: string;
let paths: BackupPaths;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-backup-"));
  const backupsDir = path.join(home, "backups");
  paths = { homeRoot: home, backupsDir, indexPath: path.join(backupsDir, "index.json") };
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function write(relative: string, contents: string): void {
  const full = path.join(home, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

function archivePath(name: string): string {
  return path.join(paths.backupsDir, name);
}

function zipEntries(zipFile: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const names: string[] = [];
    yauzl.open(zipFile, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("no zip"));
      zip.on("entry", (entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on("end", () => resolve(names.sort()));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

describe("runBackup", () => {
  it("captures the user's work-product and excludes secrets, instruments, state and quarantine copies", async () => {
    write("config.json", "{}");
    write("notes/durable.json", "{}"); // durable managed data — captured
    write("api-keys.json", "{}"); // a secret — must NOT be captured
    write("state.json", '{"window":true}'); // volatile UI state — must NOT be captured
    write("luts/warm.cube", "LUT"); // imported instrument — must NOT be captured
    write("stamps/logo.png", "PNG"); // imported instrument — must NOT be captured
    write("config-20260701-000000-000-utc.invalid", "{ broken"); // quarantine copy — must NOT be captured
    write("logs/20260701-000000-utc.log", "log"); // recreatable — excluded

    const report = await runBackup(paths, RUN1);

    expect(report.fatal).toBeUndefined();
    expect(report.nothingChanged).toBe(false);
    expect(report.archiveFileName).toBe("backup-20260701-000000-000-utc.zip");

    const entries = await zipEntries(archivePath(report.archiveFileName!));
    expect(entries).toEqual([
      "config.json",
      "notes/durable.json",
    ]);
    expect(entries).not.toContain("api-keys.json");
    expect(entries).not.toContain("state.json");
    expect(entries).not.toContain("luts/warm.cube");
    expect(entries).not.toContain("stamps/logo.png");
  });

  it("writes nothing on a second run with no changes", async () => {
    write("config.json", "{}");
    write("notes/durable.json", "{}");

    await runBackup(paths, RUN1);
    const report = await runBackup(paths, RUN2);

    expect(report.nothingChanged).toBe(true);
    expect(fs.existsSync(archivePath("backup-20260701-010000-000-utc.zip"))).toBe(false);
  });

  it("captures only the changed file after an edit", async () => {
    write("config.json", "{}");
    const note = path.join(home, "notes", "durable.json");
    write("notes/durable.json", "{}");
    await runBackup(paths, RUN1);

    fs.writeFileSync(note, '{"now":"longer"}'); // size differs, caught regardless of mtime

    const report = await runBackup(paths, RUN2);

    expect(report.filesArchived).toBe(1);
    const entries = await zipEntries(archivePath("backup-20260701-010000-000-utc.zip"));
    expect(entries).toEqual(["notes/durable.json"]);
  });

  it("resets a corrupt index to a full backup", async () => {
    write("config.json", "{}");
    write("notes/durable.json", "{}");
    await runBackup(paths, RUN1);

    fs.writeFileSync(paths.indexPath, "{ not valid json");

    const report = await runBackup(paths, RUN2);

    expect(report.indexWasReset).toBe(true);
    expect(report.filesArchived).toBe(2); // config.json + notes/durable.json
  });

  it("advances to the next free millisecond when the target archive name already exists (no-clobber create)", async () => {
    write("config.json", "{}");
    write("notes/durable.json", "{}");

    // Simulate a second instance (or a leftover) that already claimed the exact millisecond this run
    // would otherwise stamp — the engine must advance rather than overwrite it.
    fs.mkdirSync(paths.backupsDir, { recursive: true });
    fs.writeFileSync(archivePath("backup-20260701-000000-000-utc.zip"), "");

    const report = await runBackup(paths, RUN1);

    expect(report.fatal).toBeUndefined();
    expect(report.nothingChanged).toBe(false);
    expect(report.archiveFileName).toBe("backup-20260701-000000-001-utc.zip");

    const entries = await zipEntries(archivePath(report.archiveFileName!));
    expect(entries).toEqual(["config.json", "notes/durable.json"]);

    // The pre-existing archive at the original stamp is left untouched, not overwritten.
    expect(fs.readFileSync(archivePath("backup-20260701-000000-000-utc.zip"), "utf-8")).toBe("");

    const index = JSON.parse(fs.readFileSync(paths.indexPath, "utf-8")) as {
      entries: Array<{ archivedAt: string }>;
    };
    expect(index.entries.length).toBe(2);
    expect(index.entries.every((e) => e.archivedAt === "20260701-000000-001-utc")).toBe(true);
  });

  it("skips a case-insensitive archive-path collision and continues", async () => {
    // On a case-sensitive filesystem two files fold to the same archive path; only one can live in the
    // zip, so the second is a recorded skip and the run still succeeds. Skipped on case-insensitive
    // filesystems (e.g. default macOS/Windows) where the second write just overwrites the first.
    write("config.json", "{}");
    write("notes/Durable.json", "A");
    if (fs.existsSync(path.join(home, "notes", "durable.json"))) return; // case-insensitive FS: no collision
    write("notes/durable.json", "B");

    const report = await runBackup(paths, RUN1);

    expect(report.nothingChanged).toBe(false); // config.json + one of the notes is still captured
    expect(report.skips.some((s) => s.reason.includes("case-insensitive"))).toBe(true);
  });
});
