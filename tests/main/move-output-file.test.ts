import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveOutputFile } from "@main/move-output-file";

let root: string;
let source: string;
let destination: string;
/** The destination's one fixed staging folder. */
const staging = () => path.join(root, "destination-jpg.tmp");
const crossDevice = () => Object.assign(new Error("cross-device"), { code: "EXDEV" });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-move-"));
  source = path.join(root, "source.jpg");
  destination = path.join(root, "destination.jpg");
  await fs.writeFile(source, "complete image bytes");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function crossVolume(): void {
  const link = fs.link;
  vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
    if (from === source) throw crossDevice();
    return link(from, to);
  });
}

describe("output file publication", () => {
  it("does not overwrite a destination that appeared after preflight", async () => {
    const link = fs.link;
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (from === source) throw crossDevice();
      await fs.writeFile(to, "someone else's output");
      return link(from, to);
    });
    await expect(moveOutputFile(source, destination)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(destination, "utf8")).toBe("someone else's output");
    expect(await fs.readFile(source, "utf8")).toBe("complete image bytes");
    expect((await fs.readdir(root)).sort()).toEqual(["destination.jpg", "source.jpg"]);
  });

  it("keeps the published destination as success when removing the source fails", async () => {
    crossVolume();
    const rm = fs.rm;
    const denied = Object.assign(new Error("source cleanup denied"), { code: "EACCES" });
    vi.spyOn(fs, "rm").mockImplementation(async (file, options) => {
      if (file === source) throw denied;
      return rm(file, options);
    });
    expect(await moveOutputFile(source, destination)).toEqual([{ path: source, kind: "source", error: denied }]);
    expect(await fs.readFile(destination, "utf8")).toBe("complete image bytes");
    expect(await fs.readFile(source, "utf8")).toBe("complete image bytes");
  });

  it("reports staging cleanup after publication without denying the move", async () => {
    crossVolume();
    const rm = fs.rm;
    let stagingRemovals = 0;
    vi.spyOn(fs, "rm").mockImplementation(async (file, options) => {
      // The first removal clears a leftover staging folder before the move; the second is its cleanup.
      if (file === staging() && ++stagingRemovals === 2) throw new Error("staging cleanup denied");
      return rm(file, options);
    });
    expect(await moveOutputFile(source, destination)).toEqual([
      { path: staging(), kind: "staging", error: expect.objectContaining({ message: "staging cleanup denied" }) }
    ]);
    await expect(fs.access(source)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(destination, "utf8")).toBe("complete image bytes");
  });

  it("preserves the original copy error when staging cleanup also fails", async () => {
    crossVolume();
    const primary = new Error("copy sentinel");
    vi.spyOn(fs, "copyFile").mockRejectedValue(primary);
    vi.spyOn(fs, "rm").mockResolvedValueOnce(undefined).mockRejectedValue(new Error("cleanup sentinel"));
    const logger = { warn: vi.fn() } as never;
    await expect(moveOutputFile(source, destination, logger)).rejects.toBe(primary);
    await expect(fs.access(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("copies privately and publishes exclusively on a volume without hard links", async () => {
    vi.spyOn(fs, "link").mockRejectedValue(Object.assign(new Error("links unsupported"), { code: "ENOTSUP" }));
    const bytes = Buffer.alloc(150_000, 0x5a);
    await fs.writeFile(source, bytes);
    const modified = new Date("2024-03-04T05:06:07.000Z");
    await fs.chmod(source, 0o640);
    await fs.utimes(source, modified, modified);
    const copyFile = fs.copyFile;
    vi.spyOn(fs, "copyFile").mockImplementation(async (from, to, mode) => {
      if (process.platform !== "win32") expect((await fs.stat(path.dirname(String(to)))).mode & 0o777).toBe(0o700);
      return copyFile(from, to, mode);
    });
    expect(await moveOutputFile(source, destination)).toEqual([]);
    expect(await fs.readFile(destination)).toEqual(bytes);
    const stat = await fs.stat(destination);
    expect(stat.mtime.toISOString()).toBe(modified.toISOString());
    if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o640);
    expect(await fs.readdir(root)).toEqual(["destination.jpg"]);
  });

  it("replaces a staging folder left by an interrupted move, creating the new one with restrictive access", async () => {
    crossVolume();
    await fs.mkdir(staging(), { mode: 0o755 });
    await fs.writeFile(path.join(staging(), "destination.jpg"), "partial bytes");
    if (process.platform !== "win32") await fs.chmod(staging(), 0o755);
    const copyFile = fs.copyFile;
    vi.spyOn(fs, "copyFile").mockImplementation(async (from, to, mode) => {
      if (process.platform !== "win32") expect((await fs.stat(path.dirname(String(to)))).mode & 0o777).toBe(0o700);
      return copyFile(from, to, mode);
    });
    expect(await moveOutputFile(source, destination)).toEqual([]);
    expect(await fs.readFile(destination, "utf8")).toBe("complete image bytes");
    expect(await fs.readdir(root)).toEqual(["destination.jpg"]);
  });

  it("also refuses collisions during a same-volume move", async () => {
    await fs.writeFile(destination, "kept");
    await expect(moveOutputFile(source, destination)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(destination, "utf8")).toBe("kept");
    await expect(fs.access(source)).resolves.toBeUndefined();
  });
});
