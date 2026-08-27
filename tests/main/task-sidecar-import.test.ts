import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskSidecar } from "@shared/task-sidecar";
import { defaultPipeline } from "@shared/defaults";
import { loadTaskSidecars, matchingTaskSidecar } from "@main/task-sidecar";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("task sidecar import", () => {
  it("accounts for invalid JSON instead of silently dropping it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-sidecar-"));
    roots.push(root);
    const invalidPath = path.join(root, "broken.json");
    await fs.writeFile(invalidPath, "not json", "utf8");

    const result = await loadTaskSidecars([invalidPath]);

    expect(result.loaded).toEqual([]);
    expect(result.rejected).toEqual([{
      filePath: invalidPath,
      kind: "invalid",
      severity: "warning",
      reason: "This JSON file is not a valid FotoReady task sidecar.",
    }]);
  });

  it("keeps an unreadable sidecar as an operational error with the full exception in the log", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-sidecar-"));
    roots.push(root);
    const missingPath = path.join(root, "missing.json");
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = await loadTaskSidecars([missingPath], logger);

    expect(result.loaded).toEqual([]);
    expect(result.rejected).toEqual([{
      filePath: missingPath,
      kind: "failed",
      severity: "error",
      reason: "FotoReady could not read this task sidecar. Check that it still exists and is accessible.",
    }]);
    expect(logger.error).toHaveBeenCalledWith(
      "task sidecar read failed",
      expect.objectContaining({ filePath: missingPath, err: expect.any(Error) }),
    );
  });

  it("loads a saved sidecar that can match an already-imported original", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-sidecar-"));
    roots.push(root);
    const sidecarPath = path.join(root, "photo.json");
    const sidecar = createTaskSidecar({
      original: {
        fileName: "photo.jpg",
        sourceHash: "source-hash",
        size: 100,
        format: "jpeg",
        width: 20,
        height: 10,
      },
      generateDescription: false,
      generateSlug: false,
      customSlug: null,
      pipeline: defaultPipeline(),
      vision: null,
    });
    await fs.writeFile(sidecarPath, JSON.stringify(sidecar), "utf8");

    const result = await loadTaskSidecars([sidecarPath]);

    expect(result.rejected).toEqual([]);
    expect(result.loaded).toHaveLength(1);
    expect(matchingTaskSidecar({
      id: "original-id",
      sourcePath: path.join(root, "renamed.jpg"),
      sourceHash: "source-hash",
      size: 100,
      format: "jpeg",
      width: 20,
      height: 10,
      metadataSummary: { editorial: {}, dates: {}, gps: {} },
      jpegQualityEstimate: null,
      addedAt: "2026-08-28T00:00:00.000Z",
    }, result.loaded)?.path).toBe(sidecarPath);
  });
});
