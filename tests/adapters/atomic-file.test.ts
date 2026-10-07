import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atomicWriteFile } from "@adapters/atomic-file";

const isPosix = process.platform !== "win32";

describe("atomicWriteFile", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-atomic-"));
    filePath = path.join(tmpDir, "out.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exclusively creates private staging, then preserves ordinary new-file defaults", async () => {
    const writeFile = fsp.writeFile.bind(fsp);
    const write = vi.spyOn(fsp, "writeFile").mockImplementation(async (file, data, options) => {
      await writeFile(file, data, options);
      if (isPosix) expect((await fsp.stat(file as string)).mode & 0o777).toBe(0o600 & ~process.umask());
    });
    const rename = fsp.rename.bind(fsp);
    const publish = vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      if (isPosix) expect((await fsp.stat(from)).mode & 0o777).toBe(0o666 & ~process.umask());
      await rename(from, to);
    });
    try {
      await atomicWriteFile(filePath, "managed text");
      expect(write).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), Buffer.from("managed text"), { flag: "wx", mode: 0o600 });
      expect(await fsp.readFile(filePath, "utf8")).toBe("managed text");
    } finally { write.mockRestore(); publish.mockRestore(); }
  });

  it("preserves a same-byte admission refusal when descriptor close fails", async () => {
    await fsp.writeFile(filePath, "same");
    const primary = new Error("newer store refusal");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const open = fsp.open;
    const closeFailure = new Error("close denied");
    const spy = vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const file = await open(...args);
      const close = file.close.bind(file);
      vi.spyOn(file, "close").mockImplementation(async () => { await close(); throw closeFailure; });
      return file;
    });
    let checks = 0;
    try {
      await expect(atomicWriteFile(filePath, "same", { beforeWrite: async () => { if (++checks === 2) throw primary; } })).rejects.toBe(primary);
      expect(await fsp.readFile(filePath, "utf8")).toBe("same");
      expect(warning).toHaveBeenCalledWith("[atomic-write] could not close inspected file", expect.objectContaining({ err: closeFailure }));
    } finally { warning.mockRestore(); spy.mockRestore(); }
  });

  it("preserves publication refusal when temporary cleanup also fails", async () => {
    const primary = new Error("store admission refused");
    const cleanup = new Error("temporary cleanup denied");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rm = vi.spyOn(fsp, "rm").mockRejectedValue(cleanup);
    let checks = 0;
    try {
      await expect(atomicWriteFile(filePath, "new", { beforeWrite: async () => { if (++checks === 2) throw primary; } })).rejects.toBe(primary);
      expect(fs.existsSync(filePath)).toBe(false);
      expect(warning).toHaveBeenCalledWith("[atomic-write] could not remove temporary file", expect.objectContaining({ err: cleanup }));
    } finally { warning.mockRestore(); rm.mockRestore(); }
  });

  it("writes the content via temp-then-rename and leaves no orphaned temp file", async () => {
    await atomicWriteFile(filePath, "hello world", "utf8");
    expect(await fsp.readFile(filePath, "utf8")).toBe("hello world");
    // Only the target should remain in the directory: no .tmp.* sibling.
    const remaining = await fsp.readdir(tmpDir);
    expect(remaining).toEqual(["out.json"]);
  });

  it("names the temp file <stem>-<nanoid>.tmp in the same directory as the target", async () => {
    const renameSpy = vi.spyOn(fsp, "rename");
    await atomicWriteFile(filePath, "hello world", "utf8");
    const tempArg = renameSpy.mock.calls[0]?.[0] as string;
    expect(path.dirname(tempArg)).toBe(tmpDir);
    expect(path.basename(tempArg)).toMatch(/^out-[A-Za-z0-9_-]{8}\.tmp$/);
    renameSpy.mockRestore();
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
});
