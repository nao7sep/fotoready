import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Task } from "@shared/types/project";
import { PathVariableError } from "@main/configured-path";
import { ProjectSession } from "@main/session";

// The default image watermark is a configured path: a new watermark op gets it expanded
// and made absolute against the home folder, so the overlay never depends on the launch cwd.

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-watermark-home-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  await fs.mkdir(path.join(home, "marks"));
  await sharp({ create: { width: 4, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toFile(path.join(home, "marks", "logo.png"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

describe("a new image watermark op with a default watermark", () => {
  it("resolves a relative default against the home folder", async () => {
    const { session, task } = arrange("marks/logo.png");
    await session.addOp(task.id, "watermark-image");
    expect(task.pipeline.ops[0].params.assetPath).toBe(path.join(home, "marks", "logo.png"));
  });

  it("expands an environment reference in the default", async () => {
    vi.stubEnv("FOTOREADY_WATERMARK_TEST", "marks");
    const { session, task } = arrange("~/${FOTOREADY_WATERMARK_TEST}/logo.png");
    await session.addOp(task.id, "watermark-image");
    expect(task.pipeline.ops[0].params.assetPath).toBe(path.join(home, "marks", "logo.png"));
  });

  it("fails on an unset variable and leaves the task and its undo history unchanged", async () => {
    vi.stubEnv("FOTOREADY_WATERMARK_TEST_UNSET", undefined);
    const { session, task } = arrange("$FOTOREADY_WATERMARK_TEST_UNSET/logo.png");
    const before = structuredClone(task);

    await expect(session.addOp(task.id, "watermark-image")).rejects.toThrow(PathVariableError);

    expect(task).toEqual(before);
    session.undoTaskEdit(task.id);
    expect(session.snapshot().project.tasks[0]).toBe(task);
  });
});

function arrange(defaultWatermarkImage: string): { session: ProjectSession; task: Task } {
  const session = new ProjectSession(
    { ...defaultGlobalSettings(), defaultWatermarkImage },
    null as never,
    null as never,
    null as never,
    "resources/stamps"
  );
  const task: Task = {
    id: "task-1",
    originalId: "original-1",
    generateDescription: false,
    generateSlug: false,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline: defaultPipeline(),
    status: "not-saved",
    output: null,
    error: null,
    everEdited: false,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z"
  };
  const project = session.snapshot().project;
  project.originals.push(original());
  project.tasks.push(task);
  return { session, task };
}

function original(): Original {
  return {
    id: "original-1",
    sourcePath: "/originals/photo.jpg",
    sourceHash: "source-hash",
    size: 1024,
    format: "jpeg",
    jpegQualityEstimate: null,
    metadataSummary: { editorial: {}, dates: {}, gps: {} },
    width: 1000,
    height: 800,
    addedAt: "2026-10-06T00:00:00.000Z"
  };
}
