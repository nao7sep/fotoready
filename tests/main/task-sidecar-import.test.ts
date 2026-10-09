import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskSidecar } from "@shared/task-sidecar";
import { FORMAT_VERSIONS, versionedJson } from "@shared/format-versions";
import { defaultPipeline } from "@shared/defaults";
import { loadTaskSidecars, matchingTaskSidecar, writeTaskSidecarFile } from "@main/task-sidecar";
import type { Original, Task } from "@shared/types/project";
import { getOpModule } from "@core/ops/catalog";

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

    const result = await loadTaskSidecars([invalidPath], "resources/stamps");

    expect(result.loaded).toEqual([]);
    expect(result.rejected).toEqual([{
      filePath: invalidPath,
      kind: "invalid",
      severity: "warning",
      reason: { key: "importReason.sidecarInvalid" },
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

    const result = await loadTaskSidecars([missingPath], "resources/stamps", logger);

    expect(result.loaded).toEqual([]);
    expect(result.rejected).toEqual([{
      filePath: missingPath,
      kind: "failed",
      severity: "error",
      reason: { key: "importReason.sidecarUnreadable" },
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
    await fs.writeFile(sidecarPath, versionedJson(FORMAT_VERSIONS.taskSidecar, sidecar), "utf8");

    const result = await loadTaskSidecars([sidecarPath], "resources/stamps");

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

  it("rejects a sidecar without its original's source hash as invalid", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-sidecar-"));
    roots.push(root);
    const sidecarPath = path.join(root, "photo.json");
    const { sourceHash: _omitted, ...original } = { fileName: "photo.jpg", sourceHash: "source-hash", size: 100, format: "jpeg", width: 20, height: 10 };
    const body = createTaskSidecar({
      original: original as never, generateDescription: false, generateSlug: false, customSlug: null, pipeline: defaultPipeline(), vision: null,
    });
    await fs.writeFile(sidecarPath, versionedJson(FORMAT_VERSIONS.taskSidecar, body), "utf8");

    const result = await loadTaskSidecars([sidecarPath], "resources/stamps");

    expect(result.loaded).toEqual([]);
    expect(result.rejected).toEqual([{
      filePath: sidecarPath,
      kind: "invalid",
      severity: "warning",
      reason: { key: "importReason.sidecarInvalid" },
    }]);
  });

  it("matches a sidecar to an original by its source hash alone", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-sidecar-"));
    roots.push(root);
    const sidecarPath = path.join(root, "photo.json");
    await fs.writeFile(sidecarPath, versionedJson(FORMAT_VERSIONS.taskSidecar, createTaskSidecar({
      original: { fileName: "photo.jpg", sourceHash: "source-hash", size: 100, format: "jpeg", width: 20, height: 10 },
      generateDescription: false, generateSlug: false, customSlug: null, pipeline: defaultPipeline(), vision: null,
    })), "utf8");
    const { loaded } = await loadTaskSidecars([sidecarPath], "resources/stamps");
    const original = {
      id: "original-id", sourcePath: path.join(root, "photo.jpg"), size: 100, format: "jpeg", width: 20, height: 10,
      metadataSummary: { editorial: {}, dates: {}, gps: {} }, jpegQualityEstimate: null, addedAt: "2026-08-28T00:00:00.000Z",
    };

    expect(matchingTaskSidecar({ ...original, sourceHash: "other-hash" }, loaded)).toBeNull();
    expect(matchingTaskSidecar({ ...original, sourceHash: "source-hash", sourcePath: path.join(root, "renamed.png") }, loaded)?.path).toBe(sidecarPath);
  });

  it("loads a stamp saved under another install as the current built-in and leaves a missing imported stamp as saved", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-sidecar-"));
    roots.push(root);
    const sidecarPath = path.join(root, "photo.json");
    const stamp = (id: string, assetPath: string) => ({
      id, type: "stamp", enabled: true, params: { ...structuredClone(getOpModule("stamp")!.defaultParams), assetPath }
    });
    const pipeline = {
      ...defaultPipeline(),
      ops: [stamp("built-in", path.join(root, "other-install", "stamps", "heart.png")), stamp("imported", path.join(root, "gone", "my-own.png"))]
    };
    const sidecar = createTaskSidecar({
      original: { fileName: "photo.jpg", sourceHash: "source-hash", size: 100, format: "jpeg", width: 20, height: 10 },
      generateDescription: false,
      generateSlug: false,
      customSlug: null,
      pipeline,
      vision: null,
    });
    await fs.writeFile(sidecarPath, versionedJson(FORMAT_VERSIONS.taskSidecar, sidecar), "utf8");
    const bundledStampsDir = path.resolve("resources/stamps");

    const result = await loadTaskSidecars([sidecarPath], bundledStampsDir);

    expect(result.rejected).toEqual([]);
    expect(result.loaded[0]!.sidecar.task.pipeline.ops.map((op) => op.params.assetPath)).toEqual([
      path.join(bundledStampsDir, "heart.png"),
      path.join(root, "gone", "my-own.png"),
    ]);
  });
});

describe("the task sidecar format version", () => {
  const sidecarOriginal = { fileName: "photo.jpg", sourceHash: "source-hash", size: 100, format: "jpeg", width: 20, height: 10 };
  const sidecarBody = () => createTaskSidecar({
    original: sidecarOriginal,
    generateDescription: false,
    generateSlug: true,
    customSlug: "pier",
    pipeline: defaultPipeline(),
    vision: null,
  });

  async function tempRoot(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-sidecar-"));
    roots.push(root);
    return root;
  }

  it("reads v0.1.0's `version: 1` sidecar as its known earlier form, leaving the file as it is", async () => {
    const sidecarPath = path.join(await tempRoot(), "photo.json");
    const text = JSON.stringify({ version: 1, ...sidecarBody() });
    await fs.writeFile(sidecarPath, text, "utf8");

    const result = await loadTaskSidecars([sidecarPath], "resources/stamps");

    expect(result.rejected).toEqual([]);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]?.sidecar).not.toHaveProperty("version");
    expect(await fs.readFile(sidecarPath, "utf8")).toBe(text);
  });

  it.each([
    ["no marker at all", {}],
    ["an unknown old `version`", { version: 2 }],
  ])("rejects a sidecar with %s as invalid", async (_label, marker) => {
    const sidecarPath = path.join(await tempRoot(), "photo.json");
    const text = JSON.stringify({ ...marker, ...sidecarBody() });
    await fs.writeFile(sidecarPath, text, "utf8");

    const result = await loadTaskSidecars([sidecarPath], "resources/stamps");

    expect(result.loaded).toEqual([]);
    expect(result.rejected).toEqual([{
      filePath: sidecarPath,
      kind: "invalid",
      severity: "warning",
      reason: { key: "importReason.sidecarInvalid" },
    }]);
    expect(await fs.readFile(sidecarPath, "utf8")).toBe(text);
  });

  it("writes the current version first and reads the sidecar back", async () => {
    const root = await tempRoot();
    const original = {
      id: "original-id", sourcePath: path.join(root, "photo.jpg"), ...sidecarOriginal,
      metadataSummary: { editorial: {}, dates: {}, gps: {} }, jpegQualityEstimate: null, addedAt: "2026-08-28T00:00:00.000Z",
    } as unknown as Original;
    const task = { generateDescription: false, generateSlug: true, customSlug: "pier", output: null } as unknown as Task;

    const sidecarPath = await writeTaskSidecarFile(path.join(root, "photo-out.jpg"), original, task, defaultPipeline());

    expect(Object.keys(JSON.parse(await fs.readFile(sidecarPath, "utf8")))[0]).toBe("formatVersion");
    expect(JSON.parse(await fs.readFile(sidecarPath, "utf8")).formatVersion).toBe(1);
    const result = await loadTaskSidecars([sidecarPath], "resources/stamps");
    expect(result.rejected).toEqual([]);
    expect(result.loaded[0]!.sidecar).toEqual(sidecarBody());
  });

  it("refuses a sidecar a newer FotoReady saved and leaves it byte-identical", async () => {
    const sidecarPath = path.join(await tempRoot(), "photo.json");
    const text = `${JSON.stringify({ formatVersion: 2, ...sidecarBody() }, null, 2)}\n`;
    await fs.writeFile(sidecarPath, text, "utf8");

    const result = await loadTaskSidecars([sidecarPath], "resources/stamps");

    expect(result.loaded).toEqual([]);
    expect(result.rejected).toEqual([{
      filePath: sidecarPath,
      kind: "unsupported",
      severity: "warning",
      reason: { key: "importReason.sidecarNewer" },
    }]);
    expect(await fs.readFile(sidecarPath, "utf8")).toBe(text);
  });
});
