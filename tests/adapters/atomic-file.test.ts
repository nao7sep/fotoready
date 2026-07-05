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
});
