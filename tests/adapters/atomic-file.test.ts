import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atomicWriteFile, PublishedWriteError, temporaryPathFor } from "@adapters/atomic-file";
import { asPlatform } from "../helpers/platform";

const isPosix = process.platform !== "win32";

describe("atomicWriteFile", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-atomic-"));
    filePath = path.join(tmpDir, "out.json");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exclusively creates private staging, then preserves ordinary new-file defaults", async () => {
    const open = fsp.open.bind(fsp);
    const write = vi.fn();
    const opened = vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      if (args[0] === temporaryPathFor(filePath)) {
        const writeFile = file.writeFile.bind(file);
        vi.spyOn(file, "writeFile").mockImplementation(async (...writeArgs) => {
          if (isPosix) expect((await file.stat()).mode & 0o777).toBe(0o600 & ~process.umask());
          write(...writeArgs);
          await writeFile(...writeArgs);
        });
      }
      return file;
    });
    const rename = fsp.rename.bind(fsp);
    const publish = vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      if (isPosix) expect((await fsp.stat(from)).mode & 0o777).toBe(0o666 & ~process.umask());
      await rename(from, to);
    });
    try {
      await atomicWriteFile(filePath, "managed text");
      expect(opened).toHaveBeenCalledWith(temporaryPathFor(filePath), "wx", 0o600);
      expect(write).toHaveBeenCalledExactlyOnceWith(Buffer.from("managed text"));
      expect(await fsp.readFile(filePath, "utf8")).toBe("managed text");
    } finally { opened.mockRestore(); publish.mockRestore(); }
  });

  it.runIf(isPosix)("preserves a same-byte mode repair failure when descriptor close fails", async () => {
    await fsp.writeFile(filePath, "same");
    const primary = new Error("chmod denied");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const open = fsp.open;
    const closeFailure = new Error("close denied");
    const spy = vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      const close = file.close.bind(file);
      vi.spyOn(file, "chmod").mockRejectedValueOnce(primary);
      vi.spyOn(file, "close").mockImplementation(async () => { await close(); throw closeFailure; });
      return file;
    });
    try {
      await expect(atomicWriteFile(filePath, "same", { mode: 0o600 })).rejects.toBe(primary);
      expect(await fsp.readFile(filePath, "utf8")).toBe("same");
      expect(warning).toHaveBeenCalledWith("[atomic-write] could not close inspected file", expect.objectContaining({ err: closeFailure }));
    } finally { warning.mockRestore(); spy.mockRestore(); }
  });

  it("preserves a publication failure when temporary cleanup also fails", async () => {
    const primary = new Error("rename refused");
    const cleanup = new Error("temporary cleanup denied");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The first removal clears a leftover temp before staging; the second is the cleanup after the failure.
    const rm = vi.spyOn(fsp, "rm").mockResolvedValueOnce(undefined).mockRejectedValue(cleanup);
    const rename = vi.spyOn(fsp, "rename").mockRejectedValueOnce(primary);
    try {
      await expect(atomicWriteFile(filePath, "new")).rejects.toBe(primary);
      expect(fs.existsSync(filePath)).toBe(false);
      expect(warning).toHaveBeenCalledWith("[atomic-write] could not remove temporary file", expect.objectContaining({ err: cleanup }));
    } finally { warning.mockRestore(); rm.mockRestore(); rename.mockRestore(); }
  });

  it("writes the content via temp-then-rename and leaves no orphaned temp file", async () => {
    await atomicWriteFile(filePath, "hello world", "utf8");
    expect(await fsp.readFile(filePath, "utf8")).toBe("hello world");
    // Only the target should remain in the directory: no .tmp.* sibling.
    const remaining = await fsp.readdir(tmpDir);
    expect(remaining).toEqual(["out.json"]);
  });

  it("stages under the target's one fixed name, <stem>-<extension>.tmp, in the target's directory", async () => {
    const renameSpy = vi.spyOn(fsp, "rename");
    await atomicWriteFile(filePath, "hello world", "utf8");
    expect(renameSpy.mock.calls[0]?.[0]).toBe(path.join(tmpDir, "out-json.tmp"));
    renameSpy.mockRestore();
    expect(temporaryPathFor(path.join(tmpDir, "photo-k3Jq9xZa.jpg"))).toBe(path.join(tmpDir, "photo-k3Jq9xZa-jpg.tmp"));
    expect(temporaryPathFor(path.join(tmpDir, "photo-k3Jq9xZa.json"))).toBe(path.join(tmpDir, "photo-k3Jq9xZa-json.tmp"));
    expect(temporaryPathFor(path.join(tmpDir, "notes"))).toBe(path.join(tmpDir, "notes.tmp"));
  });

  it("replaces a temp left by an interrupted write, staging the new one with restrictive access", async () => {
    const leftover = path.join(tmpDir, "out-json.tmp");
    await fsp.writeFile(leftover, "stale bytes from an interrupted write");
    if (isPosix) await fsp.chmod(leftover, 0o666);
    const open = fsp.open.bind(fsp);
    const opened = vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      if (args[0] === leftover && isPosix) expect((await file.stat()).mode & 0o777).toBe(0o600 & ~process.umask());
      return file;
    });
    try {
      await atomicWriteFile(filePath, "fresh");
      expect(opened.mock.calls.filter(([file]) => file === leftover)).toEqual([[leftover, "wx", 0o600]]);
    } finally { opened.mockRestore(); }
    expect(await fsp.readFile(filePath, "utf8")).toBe("fresh");
    expect(await fsp.readdir(tmpDir)).toEqual(["out.json"]);
  });

  it("writes buffer content as well", async () => {
    const data = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    await atomicWriteFile(filePath, data);
    expect(Buffer.compare(await fsp.readFile(filePath), data)).toBe(0);
    expect(await fsp.readdir(tmpDir)).toEqual(["out.json"]);
  });

  it.runIf(isPosix)("applies the mode before the rename so 0600 holds regardless of umask", async () => {
    // A permissive umask would mask writeFile's mode bits down; the explicit
    // chmod-before-rename must still produce a 0600 target.
    const previousUmask = process.umask(0o000);
    try {
      await atomicWriteFile(filePath, "secret", { mode: 0o600 });
      const mode = fs.statSync(filePath).mode & 0o777;
      expect(mode).toBe(0o600);
      // No orphaned temp file even with the mode path exercised.
      expect(fs.readdirSync(tmpDir)).toEqual(["out.json"]);
    } finally {
      process.umask(previousUmask);
    }
  });

  it.runIf(isPosix)("keeps the replaced file's mode, but not its times", async () => {
    await fsp.writeFile(filePath, "old");
    await fsp.chmod(filePath, 0o640);
    const past = new Date("2020-01-02T03:04:05.000Z");
    await fsp.utimes(filePath, past, past);

    await atomicWriteFile(filePath, "new", "utf8");

    const stat = fs.statSync(filePath);
    expect(stat.mode & 0o777).toBe(0o640);
    expect(stat.mtime.getTime()).not.toBe(past.getTime());
    expect(fs.readdirSync(tmpDir)).toEqual(["out.json"]);
  });

  it.runIf(isPosix)("applies an explicit mode over the replaced file's", async () => {
    await fsp.writeFile(filePath, "old");
    await fsp.chmod(filePath, 0o644);

    await atomicWriteFile(filePath, "secret", { mode: 0o600 });

    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it("skips a write whose bytes are already on disk, recording nothing", async () => {
    await atomicWriteFile(filePath, "same", "utf8");
    const renameSpy = vi.spyOn(fsp, "rename");
    const afterWrite = vi.fn();

    await atomicWriteFile(filePath, "same", { afterWrite });

    expect(renameSpy).not.toHaveBeenCalled();
    expect(afterWrite).not.toHaveBeenCalled();
    renameSpy.mockRestore();
  });

  it.runIf(isPosix)("still applies an explicit mode when the bytes are unchanged", async () => {
    await fsp.writeFile(filePath, "secret");
    await fsp.chmod(filePath, 0o644);

    await atomicWriteFile(filePath, "secret", { mode: 0o600 });

    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it.runIf(isPosix)("syncs bytes and permissions before publication, then records the exact bytes before syncing the directory", async () => {
    const events: string[] = [];
    const open = fsp.open.bind(fsp);
    vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      const directory = args[0] === tmpDir;
      const write = file.writeFile.bind(file);
      const chmod = file.chmod.bind(file);
      const sync = file.sync.bind(file);
      const close = file.close.bind(file);
      vi.spyOn(file, "writeFile").mockImplementation(async (...writeArgs) => { events.push("write"); await write(...writeArgs); });
      vi.spyOn(file, "chmod").mockImplementation(async (mode) => { events.push("chmod"); await chmod(mode); });
      vi.spyOn(file, "sync").mockImplementation(async () => { events.push(directory ? "directory sync" : "file sync"); await sync(); });
      vi.spyOn(file, "close").mockImplementation(async () => { events.push(directory ? "directory close" : "file close"); await close(); });
      return file;
    });
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, "rename").mockImplementation(async (...args) => { events.push("rename"); await rename(...args); });
    const bytes = Buffer.from([0x61, 0x0d, 0x0a, 0xff]);
    const afterWrite = vi.fn((written: Buffer) => {
      events.push("afterWrite");
      expect(written.equals(bytes)).toBe(true);
      expect(fs.readFileSync(filePath).equals(bytes)).toBe(true);
    });
    await atomicWriteFile(filePath, bytes, { mode: 0o640, afterWrite });
    expect(events).toEqual(["write", "chmod", "file sync", "file close", "rename", "afterWrite", "directory sync", "directory close"]);
    expect(afterWrite).toHaveBeenCalledOnce();
    events.length = 0;
    await atomicWriteFile(filePath, bytes, { mode: 0o600, afterWrite });
    expect(events).toEqual(["chmod", "file sync", "file close", "directory sync", "directory close"]);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(afterWrite).toHaveBeenCalledOnce();
  });

  it.each((isPosix ? ["writeFile", "chmod", "sync", "close"] : ["writeFile", "sync", "close"]) as Array<"writeFile" | "chmod" | "sync" | "close">)("keeps the previous target when staging %s fails", async (operation) => {
    await fsp.writeFile(filePath, "previous");
    const primary = new Error(`${operation} refused`);
    const open = fsp.open.bind(fsp);
    vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      if (args[0] === temporaryPathFor(filePath)) {
        if (operation === "close") {
          const close = file.close.bind(file);
          vi.spyOn(file, "close").mockImplementation(async () => { await close(); throw primary; });
        } else vi.spyOn(file, operation).mockRejectedValueOnce(primary);
      }
      return file;
    });
    const publish = vi.spyOn(fsp, "rename");
    const afterWrite = vi.fn();
    await expect(atomicWriteFile(filePath, "replacement", { afterWrite })).rejects.toBe(primary);
    expect(await fsp.readFile(filePath, "utf8")).toBe("previous");
    expect(fs.existsSync(temporaryPathFor(filePath))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(afterWrite).not.toHaveBeenCalled();
  });

  it("preserves the staging sync failure when closing its descriptor also fails", async () => {
    const primary = new Error("file sync refused");
    const closeFailure = new Error("file close refused");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const open = fsp.open.bind(fsp);
    vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      if (args[0] === temporaryPathFor(filePath)) {
        const close = file.close.bind(file);
        vi.spyOn(file, "sync").mockRejectedValueOnce(primary);
        vi.spyOn(file, "close").mockImplementation(async () => { await close(); throw closeFailure; });
      }
      return file;
    });
    await expect(atomicWriteFile(filePath, "replacement")).rejects.toBe(primary);
    expect(warning).toHaveBeenCalledWith("[atomic-write] could not close temporary file", expect.objectContaining({ err: closeFailure }));
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(temporaryPathFor(filePath))).toBe(false);
  });

  it.runIf(isPosix).each(["open", "sync"] as const)("reports publication when directory %s fails and repairs durability on an unchanged retry", async (operation) => {
    const failure = Object.assign(new Error("directory unavailable"), { code: "EIO" });
    const open = fsp.open.bind(fsp);
    let fail = true;
    const fileSync = vi.fn();
    const directorySync = vi.fn();
    vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const directory = args[0] === tmpDir;
      if (directory && operation === "open" && fail) { fail = false; throw failure; }
      const file = await open(...args);
      const sync = file.sync.bind(file);
      vi.spyOn(file, "sync").mockImplementation(async () => {
        if (directory) {
          directorySync();
          if (operation === "sync" && fail) { fail = false; throw failure; }
        } else fileSync();
        await sync();
      });
      return file;
    });
    const publish = vi.spyOn(fsp, "rename");
    const afterWrite = vi.fn();
    const writing = atomicWriteFile(filePath, "published", { afterWrite });
    await expect(writing).rejects.toMatchObject({ name: "PublishedWriteError", filePath, cause: failure });
    await expect(writing).rejects.toBeInstanceOf(PublishedWriteError);
    expect(await fsp.readFile(filePath, "utf8")).toBe("published");
    expect(fs.existsSync(temporaryPathFor(filePath))).toBe(false);
    expect(afterWrite).toHaveBeenCalledExactlyOnceWith(Buffer.from("published"));

    await atomicWriteFile(filePath, "published", { afterWrite });
    expect(fileSync).toHaveBeenCalledTimes(2);
    expect(directorySync).toHaveBeenCalledTimes(operation === "open" ? 1 : 2);
    expect(publish).toHaveBeenCalledOnce();
    expect(afterWrite).toHaveBeenCalledOnce();
  });

  it.runIf(isPosix).each(["ENOTSUP", "EOPNOTSUPP", "EINVAL", "ENOSYS"].flatMap((code) =>
    ["open", "sync"].map((operation) => ({ code, operation }))
  ))("tolerates unsupported directory $operation ($code), preserving the published file", async ({ code, operation }) => {
    const open = fsp.open.bind(fsp);
    const unsupported = Object.assign(new Error("unsupported"), { code });
    vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      if (args[0] === tmpDir && operation === "open") throw unsupported;
      const file = await open(...args);
      if (args[0] === tmpDir) vi.spyOn(file, "sync").mockRejectedValueOnce(unsupported);
      return file;
    });
    await atomicWriteFile(filePath, "published");
    expect(await fsp.readFile(filePath, "utf8")).toBe("published");
  });
});

describe("atomicWriteFile on Windows", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-atomic-win-")); });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and repeats a write without applying POSIX modes, which Windows does not use", async () => {
    const filePath = path.join(tmpDir, "secrets.json");
    const chmod = vi.fn();
    const pathChmod = vi.spyOn(fsp, "chmod");
    const open = fsp.open.bind(fsp);
    const openedFiles: string[] = [];
    const opened = vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      openedFiles.push(String(args[0]));
      const handleChmod = file.chmod.bind(file);
      vi.spyOn(file, "chmod").mockImplementation(async (mode) => { chmod(mode); await handleChmod(mode); });
      return file;
    });
    await asPlatform("win32", async () => {
      await atomicWriteFile(filePath, "key", { mode: 0o600 });
      await atomicWriteFile(filePath, "key", { mode: 0o600 });
      await atomicWriteFile(filePath, "new key", { mode: 0o600 });
    });
    expect(chmod).not.toHaveBeenCalled();
    expect(pathChmod).not.toHaveBeenCalled();
    expect(opened.mock.calls.filter(([file]) => file === filePath).every(([, flags]) => flags === "r+")).toBe(true);
    expect(openedFiles).toContain(temporaryPathFor(filePath));
    expect(openedFiles).toContain(filePath);
    expect(openedFiles).not.toContain(tmpDir);
    expect(await fsp.readFile(filePath, "utf8")).toBe("new key");
  });
});
