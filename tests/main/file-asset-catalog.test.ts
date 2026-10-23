import fs from "node:fs";
import fsAsync from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@shared/types/log";
import { asPlatform, fileHandlePrototype } from "../helpers/platform";
import { temporaryPathFor } from "@adapters/atomic-file";
import { setBackupWriter } from "@main/backup-store";
import type { BackupWrite } from "@main/backup-tables";

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));

import { LibraryFolderError, importDirectoryAssets, listDirectoryAssets, readDirectoryAssets } from "@main/file-asset-catalog";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  setBackupWriter(null);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("readDirectoryAssets", () => {
  it("keeps the empty-library fallback observable when the directory cannot be read", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-assets-"));
    roots.push(root);
    const notADirectory = path.join(root, "library");
    fs.writeFileSync(notADirectory, "not a directory");
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await expect(readDirectoryAssets(notADirectory, [".cube"], logger)).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/asset library directory/i),
      expect.objectContaining({ assetDir: notADirectory, err: expect.anything() }),
    );
  });
});

describe("listDirectoryAssets", () => {
  it("fails with a reason naming the folder when the library folder cannot be created or read", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-assets-"));
    roots.push(root);
    const notADirectory = path.join(root, "library");
    fs.writeFileSync(notADirectory, "not a directory");

    const failure = await listDirectoryAssets(notADirectory, [".cube"]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LibraryFolderError);
    expect((failure as LibraryFolderError).reason).toEqual({
      key: "failure.libraryFolderUnreadable",
      values: { path: notADirectory }
    });
    expect((failure as Error).cause).toMatchObject({ code: "EEXIST" });
  });
  it("keeps arbitrary diagnostics in the cause, outside the trusted presentation", () => {
    const cause = new Error("EACCES /private/FOTOREADY_LIBRARY_DIAGNOSTIC_SENTINEL");
    const failure = new LibraryFolderError("/chosen/stamps", cause);
    expect(failure.cause).toBe(cause);
    expect(failure.reason).toEqual({ key: "failure.libraryFolderUnreadable", values: { path: "/chosen/stamps" } });
    expect(JSON.stringify(failure.reason)).not.toContain("DIAGNOSTIC_SENTINEL");
    expect(new LibraryFolderError("/internal/data/stamps", cause, null).reason).toEqual({ key: "failure.libraryUnreadable" });
  });
});

describe("importDirectoryAssets", () => {
  function arrangeImport() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-assets-"));
    roots.push(root);
    const source = path.join(root, "warm.cube");
    const library = path.join(root, "library");
    const destination = path.join(library, "warm.cube");
    const staging = `${temporaryPathFor(destination)}-import`;
    fs.writeFileSync(source, "LUT_3D_SIZE 2\n");
    return { source, library, destination, staging };
  }

  it("does not publish or back up a partially written import, and keeps its source", async () => {
    const { source, library, destination, staging } = arrangeImport();
    const backup = vi.fn();
    setBackupWriter({ writeBackup: backup });
    const prototype = await fileHandlePrototype();
    const writeFile = prototype.writeFile;
    const failure = new Error("injected partial write");
    vi.spyOn(prototype, "writeFile").mockImplementationOnce(async function (this: typeof prototype) {
      expect(fs.existsSync(destination)).toBe(false);
      if (process.platform !== "win32") {
        expect(fs.statSync(staging).mode & 0o777).toBe(0o700);
        expect(fs.statSync(path.join(staging, "warm.cube")).mode & 0o777).toBe(0o600);
      }
      await writeFile.call(this, Buffer.from("partial"));
      throw failure;
    });

    await expect(importDirectoryAssets([source], library, [".cube"])).rejects.toBe(failure);

    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.readFileSync(source, "utf8")).toBe("LUT_3D_SIZE 2\n");
    expect(backup).not.toHaveBeenCalled();
  });

  it("does not overwrite or remove a file created by another writer before publication", async () => {
    const { source, library, destination, staging } = arrangeImport();
    const backup = vi.fn();
    setBackupWriter({ writeBackup: backup });
    const link = fsAsync.link;
    vi.spyOn(fsAsync, "link").mockImplementationOnce(async (from, to) => {
      fs.writeFileSync(destination, "other writer", { flag: "wx" });
      return link(from, to);
    });

    const [result] = await importDirectoryAssets([source], library, [".cube"]);

    expect(result!.status).toBe("skipped-name-conflict");
    expect(fs.readFileSync(destination, "utf8")).toBe("other writer");
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.readFileSync(source, "utf8")).toBe("LUT_3D_SIZE 2\n");
    expect(backup).not.toHaveBeenCalled();
  });

  it("replaces stale private staging and backs up exact bytes only after publication", async () => {
    const { source, library, destination, staging } = arrangeImport();
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, "warm.cube"), "stale partial bytes");
    const sync = vi.spyOn(await fileHandlePrototype(), "sync");
    const backup = vi.fn((input: BackupWrite) => {
      expect(fs.readFileSync(destination)).toEqual(Buffer.from(input.bytes));
      expect(sync).toHaveBeenCalledOnce();
    });
    setBackupWriter({ writeBackup: backup });

    const [result] = await importDirectoryAssets([source], library, [".cube"]);

    expect(result!.status).toBe("imported");
    expect(backup).toHaveBeenCalledWith(expect.objectContaining({ path: destination, bytes: new Uint8Array(Buffer.from("LUT_3D_SIZE 2\n")) }));
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.readFileSync(source, "utf8")).toBe("LUT_3D_SIZE 2\n");
  });

  it("keeps a published import and its backup when private staging cleanup fails", async () => {
    const { source, library, destination, staging } = arrangeImport();
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const backup = vi.fn();
    setBackupWriter({ writeBackup: backup });
    const rm = fsAsync.rm;
    const failure = new Error("injected cleanup failure");
    vi.spyOn(fsAsync, "rm").mockImplementation(async (target, options) => {
      if (target === staging && fs.existsSync(destination)) throw failure;
      return rm(target, options);
    });

    const [result] = await importDirectoryAssets([source], library, [".cube"], [], logger);

    expect(result!.status).toBe("imported");
    expect(fs.readFileSync(destination, "utf8")).toBe("LUT_3D_SIZE 2\n");
    expect(backup).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith("could not remove asset import staging", expect.objectContaining({ staging, err: failure }));
  });

  it("imports through exclusive-copy publication on a volume without hard links", async () => {
    const { source, library, destination, staging } = arrangeImport();
    vi.spyOn(fsAsync, "link").mockRejectedValue(Object.assign(new Error("hard links unsupported"), { code: "ENOTSUP" }));

    const [result] = await importDirectoryAssets([source], library, [".cube"]);

    expect(result!.status).toBe("imported");
    expect(fs.readFileSync(destination, "utf8")).toBe("LUT_3D_SIZE 2\n");
    expect(fs.readFileSync(source, "utf8")).toBe("LUT_3D_SIZE 2\n");
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.existsSync(temporaryPathFor(destination))).toBe(false);
  });

  it("keeps earlier imported files when a later source cannot be read", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-assets-"));
    roots.push(root);
    const source = path.join(root, "first.cube");
    const library = path.join(root, "library");
    fs.writeFileSync(source, "LUT_3D_SIZE 2\n");
    await expect(importDirectoryAssets([source, path.join(root, "missing.cube")], library, [".cube"])).rejects.toMatchObject({ code: "ENOENT" });
    expect(await listDirectoryAssets(library, [".cube"])).toEqual([
      { extension: ".cube", fileName: "first.cube", path: path.join(library, "first.cube") }
    ]);
    expect(fs.readFileSync(path.join(library, "first.cube"), "utf8")).toBe("LUT_3D_SIZE 2\n");
  });

  it("keeps the imported file's modified time and mode", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-assets-"));
    roots.push(root);
    const source = path.join(root, "warm.cube");
    fs.writeFileSync(source, "LUT_3D_SIZE 2\n");
    const modified = new Date("2024-03-04T05:06:07.000Z");
    fs.chmodSync(source, 0o640);
    fs.utimesSync(source, modified, modified);

    const [result] = await importDirectoryAssets([source], path.join(root, "library"), [".cube"]);

    const stat = fs.statSync(result!.entry.path);
    expect(result!.status).toBe("imported");
    expect(stat.mtime.toISOString()).toBe(modified.toISOString());
    if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o640);
  });

  it("on Windows, imports without applying POSIX modes, keeping bytes and modified time", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-assets-"));
    roots.push(root);
    const source = path.join(root, "warm.cube");
    fs.writeFileSync(source, "LUT_3D_SIZE 2\n");
    const modified = new Date("2024-03-04T05:06:07.000Z");
    fs.utimesSync(source, modified, modified);
    const handleChmod = vi.spyOn(await fileHandlePrototype(), "chmod");

    const [result] = await asPlatform("win32", () => importDirectoryAssets([source], path.join(root, "library"), [".cube"]))
      .finally(() => handleChmod.mockRestore());

    expect(result!.status).toBe("imported");
    expect(handleChmod).not.toHaveBeenCalled();
    expect(fs.readFileSync(result!.entry.path, "utf8")).toBe("LUT_3D_SIZE 2\n");
    expect(fs.statSync(result!.entry.path).mtime.toISOString()).toBe(modified.toISOString());
  });
});
