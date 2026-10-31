import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@adapters/exiftool", () => ({
  readSourceMetadataSummary: vi.fn(async () => ({ editorial: {}, dates: {}, gps: {} })),
}));

import { ProjectSession } from "@main/session";
import { defaultGlobalSettings } from "@shared/defaults";

// A sidecar exactly as FotoReady v0.1.0 (published 2026-07-07) wrote it, made by running v0.1.0's own
// `createTaskSidecar` and op catalogue defaults, with every op v0.1.0 offered. A sidecar sits beside
// a saved image and belongs to the user, so it keeps opening as it is.
const FIXTURES = path.join(import.meta.dirname, "fixtures", "v0.1.0");

const roots: string[] = [];
const prevDataDir = process.env.FOTOREADY_DATA_DIR;

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env.FOTOREADY_DATA_DIR;
  else process.env.FOTOREADY_DATA_DIR = prevDataDir;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-v010-"));
  roots.push(root);
  process.env.FOTOREADY_DATA_DIR = root;
  return root;
}

describe("files written by v0.1.0", () => {
  it("imports a v0.1.0 task sidecar and reopens its task", async () => {
    const root = await tempRoot();
    const imagePath = path.join(root, "IMG_0412.png");
    await sharp({ create: { width: 4, height: 3, channels: 3, background: "teal" } }).png().toFile(imagePath);
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const project = new ProjectSession(defaultGlobalSettings(), null as never, null as never, null as never, "resources/stamps", logger as never);
    const original = (await project.addOriginals([imagePath])).snapshot.project.originals[0];
    if (!original) throw new Error("original not imported");

    // The fixture's own hash names a photo this test does not have; point it at the imported one.
    const fixture = JSON.parse(await fs.readFile(path.join(FIXTURES, "IMG_0412.json"), "utf8")) as { version: number; original: { sourceHash: string } };
    expect(fixture.version).toBe(1);
    expect(fixture).not.toHaveProperty("formatVersion");
    fixture.original.sourceHash = original.sourceHash;
    const sidecarPath = path.join(root, "IMG_0412-k3Jq9xZa.json");
    await fs.writeFile(sidecarPath, `${JSON.stringify(fixture, null, 2)}\n`);

    const reopened = await project.addOriginals([sidecarPath]);

    expect(reopened.issues).toEqual([]);
    expect(reopened.restoredTasks).toBe(1);
    const task = reopened.snapshot.project.tasks.at(-1)!;
    expect(task.originalId).toBe(original.id);
    expect(task.pipeline.ops.map((op) => op.type)).toEqual([
      "crop", "auto-tone", "resize", "watermark-text", "stamp", "strip-metadata", "inject-metadata",
      "rotate", "flip", "levels", "white-balance", "curves", "hsl", "unsharp-mask", "denoise", "lut",
      "cover", "blur", "mosaic", "watermark-image",
    ]);
    expect(task.pipeline.output).toMatchObject({ format: "webp", quality: 82 });
    expect(task).toMatchObject({ generateDescription: true, generateSlug: true, customSlug: null });
  });
});
