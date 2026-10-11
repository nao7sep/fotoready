import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCubeLut } from "@adapters/cube-loader";
import { importDirectoryAssets } from "@main/file-asset-catalog";

vi.mock("electron", () => ({ shell: {} }));

const cube = (title: string) => `TITLE "${title}"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`;

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-cube-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadCubeLut", () => {
  it("reads a replaced imported lattice even when size and preserved source time match", async () => {
    const firstSource = path.join(dir, "first", "film.cube");
    const nextSource = path.join(dir, "next", "film.cube");
    const library = path.join(dir, "library");
    const modified = new Date("2024-01-01T00:00:00.000Z");
    for (const [source, contents] of [[firstSource, cube("Film")], [nextSource, cube("Film").replace("0 0 0\n", "1 0 0\n")]]) {
      await fs.mkdir(path.dirname(source), { recursive: true });
      await fs.writeFile(source, contents);
      await fs.utimes(source, modified, modified);
    }
    const [firstImport] = await importDirectoryAssets([firstSource], library, [".cube"]);
    const cubePath = firstImport!.entry.path;
    const before = await fs.stat(cubePath);
    expect((await loadCubeLut(cubePath)).data[0]).toEqual([0, 0, 0]);
    await fs.rm(cubePath);
    await importDirectoryAssets([nextSource], library, [".cube"]);
    const after = await fs.stat(cubePath);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect((await loadCubeLut(cubePath)).data[0]).toEqual([1, 0, 0]);
  });

  it("parses a file once while it is unchanged, and again after it changes", async () => {
    const cubePath = path.join(dir, "film.cube");
    await fs.writeFile(cubePath, cube("Film"));

    const first = await loadCubeLut(cubePath);
    expect(await loadCubeLut(cubePath)).toBe(first);

    await fs.writeFile(cubePath, cube("Film, regraded"));
    const changed = await loadCubeLut(cubePath);
    expect(changed).not.toBe(first);
    expect(changed.title).toBe("Film, regraded");
  });
});
