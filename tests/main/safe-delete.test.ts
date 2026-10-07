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

describe("deleting an output and its governing sidecar", () => {
  it("refuses a newer sidecar before trashing any file", async () => {
    await fs.writeFile(sidecar, '{"formatVersion":2,"future":"kept"}');
    await expect(deleteSelectedFiles([image, sidecar], [sidecar])).rejects.toMatchObject({ reason: { key: "failure.outputSidecarNewer" } });
    expect(trashItem).not.toHaveBeenCalled();
    expect(await fs.readFile(image, "utf8")).toBe("photo bytes");
    expect(await fs.readFile(sidecar, "utf8")).toBe('{"formatVersion":2,"future":"kept"}');
  });
  it("still deletes an image whose optional sidecar is missing", async () => {
    await deleteSelectedFiles([image, sidecar], [sidecar]);
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(image);
    await expect(fs.access(image)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rechecks the current marker before the next destructive leaf", async () => {
    await fs.writeFile(sidecar, '{"formatVersion":1}');
    trashItem.mockImplementation(async (file) => {
      await fs.rm(file);
      await fs.writeFile(sidecar, '{"formatVersion":2}');
    });
    await expect(deleteSelectedFiles([image, sidecar], [sidecar])).rejects.toMatchObject({ reason: { key: "failure.outputSidecarNewer" } });
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(image);
    expect(await fs.readFile(sidecar, "utf8")).toBe('{"formatVersion":2}');
  });
});
