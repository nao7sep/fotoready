import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCubeLut } from "@adapters/cube-loader";

const cube = (title: string) => `TITLE "${title}"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`;

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-cube-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadCubeLut", () => {
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
