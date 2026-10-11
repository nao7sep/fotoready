import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const trashItem = vi.hoisted(() => vi.fn<(file: string) => Promise<void>>());
vi.mock("electron", () => ({ shell: { trashItem } }));
import { deleteSelectedFiles } from "@main/safe-delete";
import { ProjectSession } from "@main/session";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Task } from "@shared/types/project";

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
  it.each(["sidecar", "image", "both"])("reconciles saved state when trash refuses the %s", async (refused) => {
    await fs.writeFile(sidecar, "recipe");
    trashItem.mockImplementation(async (file) => {
      if (refused === "both" || file === (refused === "image" ? image : sidecar)) throw new Error("TRASH_DIAGNOSTIC_SENTINEL");
      await fs.rm(file);
    });
    const session = new ProjectSession(defaultGlobalSettings(), null as never, { snapshot: () => ({}) } as never, null as never, "resources/stamps");
    const task = {
      id: "task", originalId: "missing-original", pipeline: defaultPipeline(), status: "saved", visionRunning: false,
      output: { finalPath: image, stagedPath: image, finalParamsPath: sidecar, stagedParamsPath: sidecar }, error: null
    } as unknown as Task;
    session.snapshot().project.tasks.push(task);
    const broadcast = vi.fn();
    session.setSnapshotListener(broadcast);
    await expect(session.deleteSavedOutput(task.id)).rejects.toThrow();
    if (refused === "sidecar") {
      expect(task).toMatchObject({ status: "not-saved", output: null });
      expect(broadcast).toHaveBeenCalledOnce();
      await expect(fs.access(image)).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(task.status).toBe("saved");
      expect(task.output?.finalPath).toBe(image);
      await expect(fs.access(image)).resolves.toBeUndefined();
    }
    // Retry uses the actual remaining files, including an already missing image or sidecar.
    trashItem.mockImplementation(async (file) => { await fs.rm(file); });
    await deleteSelectedFiles([image, sidecar]);
    await expect(fs.access(image)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(sidecar)).rejects.toMatchObject({ code: "ENOENT" });
  });
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
