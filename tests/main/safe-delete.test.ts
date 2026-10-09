import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const trashItem = vi.hoisted(() => vi.fn<(file: string) => Promise<void>>());
vi.mock("electron", () => ({ shell: { trashItem } }));
import { deleteSelectedFiles } from "@main/safe-delete";

let root: string;
let image: string;
let sidecar: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-delete-"));
  image = path.join(root, "image.jpg"); sidecar = path.join(root, "image.json");
  await fs.writeFile(image, "photo bytes");
  trashItem.mockReset().mockImplementation(async (file) => { await fs.rm(file); });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe("deleting an output and its sidecar", () => {
  it("trashes the image and its sidecar without reading the sidecar", async () => {
    await fs.writeFile(sidecar, '{"formatVersion":2,"future":"kept"}');
    const readFile = vi.spyOn(fs, "readFile");
    await deleteSelectedFiles([image, sidecar]);
    expect(trashItem.mock.calls).toEqual([[image], [sidecar]]);
    expect(readFile).not.toHaveBeenCalled();
    readFile.mockRestore();
  });
  it("still deletes an image whose optional sidecar is missing", async () => {
    await deleteSelectedFiles([image, sidecar]);
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(image);
    await expect(fs.access(image)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
