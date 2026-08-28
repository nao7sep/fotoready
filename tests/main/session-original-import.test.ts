import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@adapters/exiftool", () => ({
  readSourceMetadataSummary: vi.fn(async () => ({ editorial: {}, dates: {}, gps: {} })),
}));

import { ProjectSession } from "@main/session";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import { createTaskSidecar } from "@shared/task-sidecar";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function session() {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger,
    value: new ProjectSession(defaultGlobalSettings(), null as never, null as never, null as never, logger as never),
  };
}

describe("ProjectSession original import results", () => {
  it("serializes simultaneous imports and reports repeated content as information", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-original-"));
    roots.push(root);
    const imagePath = path.join(root, "photo.png");
    await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toFile(imagePath);
    const project = session().value;

    const [first, repeated] = await Promise.all([
      project.addOriginals([imagePath]),
      project.addOriginals([imagePath]),
    ]);

    expect(first.addedOriginals).toBe(1);
    expect(first.issues).toEqual([]);
    expect(repeated.addedOriginals).toBe(0);
    expect(repeated.issues).toEqual([{
      filePath: imagePath,
      kind: "duplicate",
      severity: "info",
      reason: "This original is already in the project.",
    }]);
    expect(repeated.snapshot.project.originals).toHaveLength(1);
  });

  it("allows the same valid sidecar to restore another task on a later import", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-original-"));
    roots.push(root);
    const imagePath = path.join(root, "photo.png");
    const sidecarPath = path.join(root, "photo-fotoready.json");
    await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toFile(imagePath);
    const project = session().value;
    const imported = await project.addOriginals([imagePath]);
    const original = imported.snapshot.project.originals[0];
    if (!original) throw new Error("original not imported");
    await fs.writeFile(sidecarPath, JSON.stringify(createTaskSidecar({
      original: {
        fileName: path.basename(imagePath),
        sourceHash: original.sourceHash,
        size: original.size,
        format: original.format,
        width: original.width,
        height: original.height,
      },
      generateDescription: false,
      generateSlug: false,
      customSlug: null,
      pipeline: defaultPipeline(),
      vision: null,
    })), "utf8");
    const beforeRestore = imported.snapshot.project.tasks.length;

    const firstRestore = await project.addOriginals([sidecarPath]);
    expect(firstRestore.restoredTasks).toBe(1);
    expect(firstRestore.issues).toEqual([]);
    expect(firstRestore.snapshot.project.tasks).toHaveLength(beforeRestore + 1);

    const secondRestore = await project.addOriginals([sidecarPath]);
    expect(secondRestore.restoredTasks).toBe(1);
    expect(secondRestore.issues).toEqual([]);
    expect(secondRestore.snapshot.project.tasks).toHaveLength(beforeRestore + 2);
  });

  it("reports and fully logs an operational image read failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-original-"));
    roots.push(root);
    const missingPath = path.join(root, "missing.png");
    const { logger, value } = session();

    const result = await value.addOriginals([missingPath]);

    expect(result.issues).toEqual([{
      filePath: missingPath,
      kind: "failed",
      severity: "error",
      reason: "FotoReady could not read this image. Check that it still exists and is accessible.",
    }]);
    expect(logger.error).toHaveBeenCalledWith(
      "original import failed",
      expect.objectContaining({ filePath: missingPath, err: expect.any(Error) }),
    );
  });

  it("reports an invalid image as a warning while retaining the decoder error in the log", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-original-"));
    roots.push(root);
    const invalidPath = path.join(root, "invalid.png");
    await fs.writeFile(invalidPath, "not an image", "utf8");
    const { logger, value } = session();

    const result = await value.addOriginals([invalidPath]);

    expect(result.issues).toEqual([{
      filePath: invalidPath,
      kind: "invalid",
      severity: "warning",
      reason: expect.any(String),
    }]);
    expect(logger.warn).toHaveBeenCalledWith(
      "original image was invalid",
      expect.objectContaining({ filePath: invalidPath, err: expect.any(Error) }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
