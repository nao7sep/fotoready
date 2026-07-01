// End-to-end backup runs over a throwaway home root: a first run captures config.json, api-keys.json,
// and the luts/ + stamps/ trees at their mirror paths while excluding the volatile state.json; an
// unchanged run writes nothing; an edit captures only what changed; a corrupt index resets to a full
// backup; and a case-insensitive path collision is skipped without failing the run. The backups
// directory is owner-only (0700) so a secret it may contain (api-keys.json) is not downgraded.

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
  it("captures managed files at mirror paths and excludes state.json", async () => {
    write("config.json", "{}");
    write("api-keys.json", "{}");
    write("state.json", '{"window":true}'); // volatile UI state — must NOT be captured
    write("luts/warm.cube", "LUT");
    write("stamps/logo.png", "PNG");
    write("logs/20260701-000000-utc.log", "log"); // recreatable — excluded

    const report = await runBackup(paths, RUN1);

    expect(report.fatal).toBeUndefined();
    expect(report.nothingChanged).toBe(false);
    expect(report.archiveFileName).toBe("backup-20260701-000000-utc.zip");

    const entries = await zipEntries(archivePath(report.archiveFileName!));
    expect(entries).toEqual([
      "api-keys.json",
      "config.json",
      "luts/warm.cube",
      "stamps/logo.png",
    ]);
    expect(entries).not.toContain("state.json");

    if (process.platform !== "win32") {
      expect(fs.statSync(paths.backupsDir).mode & 0o777).toBe(0o700);
    }
  });

  it("writes nothing on a second run with no changes", async () => {
    write("config.json", "{}");
    write("luts/warm.cube", "LUT");

    await runBackup(paths, RUN1);
    const report = await runBackup(paths, RUN2);

    expect(report.nothingChanged).toBe(true);
    expect(fs.existsSync(archivePath("backup-20260701-010000-utc.zip"))).toBe(false);
  });

  it("captures only the changed file after an edit", async () => {
    write("config.json", "{}");
    const lut = path.join(home, "luts", "warm.cube");
    write("luts/warm.cube", "LUT");
    await runBackup(paths, RUN1);

    fs.writeFileSync(lut, "LUT, now longer"); // size differs, caught regardless of mtime

    const report = await runBackup(paths, RUN2);

    expect(report.filesArchived).toBe(1);
    const entries = await zipEntries(archivePath("backup-20260701-010000-utc.zip"));
    expect(entries).toEqual(["luts/warm.cube"]);
  });

  it("resets a corrupt index to a full backup", async () => {
    write("config.json", "{}");
    write("luts/warm.cube", "LUT");
    await runBackup(paths, RUN1);

    fs.writeFileSync(paths.indexPath, "{ not valid json");

    const report = await runBackup(paths, RUN2);

    expect(report.indexWasReset).toBe(true);
    expect(report.filesArchived).toBe(2); // config.json + luts/warm.cube
  });

  it("skips a case-insensitive archive-path collision and continues", async () => {
    // On a case-sensitive filesystem two files fold to the same archive path; only one can live in the
    // zip, so the second is a recorded skip and the run still succeeds. Skipped on case-insensitive
    // filesystems (e.g. default macOS/Windows) where the second write just overwrites the first.
    write("config.json", "{}");
    write("luts/Warm.cube", "A");
    if (fs.existsSync(path.join(home, "luts", "warm.cube"))) return; // case-insensitive FS: no collision
    write("luts/warm.cube", "B");

    const report = await runBackup(paths, RUN1);

    expect(report.nothingChanged).toBe(false); // config.json + one of the luts is still captured
    expect(report.skips.some((s) => s.reason.includes("case-insensitive"))).toBe(true);
  });
});
