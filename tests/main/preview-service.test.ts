import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Project, Task } from "@shared/types/project";
import type { Pipeline } from "@shared/types/pipeline";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { PreviewService } from "@main/preview-service";
import { ProjectSession } from "@main/session";

const WIDTH = 4;
const HEIGHT = 2;

type StageCall = { strength: number; release(): void };

/** A worker pool whose stage renders fill the bitmap with the LUT strength and can be held open. */
function fakePool(options: { holdStages?: boolean } = {}) {
  const baseCalls: string[] = [];
  const stageCalls: StageCall[] = [];
  const pool = {
    async renderBuffer(input: { sourcePath: string }) {
      baseCalls.push(input.sourcePath);
      return { kind: "preview" as const, bitmap: filled(1).buffer, width: WIDTH, height: HEIGHT, format: "rgba8" as const, appliedPipeline: defaultPipeline() };
    },
    async renderStage(input: { pipeline: Pipeline }) {
      const strength = Number(input.pipeline.ops[0].params.strength);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      stageCalls.push({ strength, release });
      if (!options.holdStages) release();
      await gate;
      return { kind: "preview" as const, bitmap: filled(Math.round(strength * 100)).buffer, width: WIDTH, height: HEIGHT, format: "rgba8" as const, appliedPipeline: input.pipeline };
    }
  };
  return { pool: pool as unknown as PipelineWorkerPool, baseCalls, stageCalls };
}

describe("PreviewService stage cache", () => {
  it("never serves a stage rendered for an edit that was superseded while it rendered", async () => {
    const { pool, stageCalls } = fakePool({ holdStages: true });
    const session = new ProjectSession(defaultGlobalSettings(), null as never, null as never, pool);
    const { task } = arrange(session.snapshot().project);
    const opId = task.pipeline.ops[0].id;

    const late = session.renderPreview(task.id);
    await until(() => stageCalls.length === 1);
    session.updateOpParam(task.id, opId, "strength", 0.2);

    const fresh = session.renderPreview(task.id);
    await until(() => stageCalls.length === 2);
    stageCalls[1].release();
    expect(await firstPixel(await fresh)).toBe(20);

    stageCalls[0].release();
    expect(await firstPixel(await late)).toBe(10);

    // The late v1 render must not have replaced the stage the current value needs.
    expect(await firstPixel(await session.renderPreview(task.id))).toBe(20);
    expect(stageCalls).toHaveLength(2);
  });

  it("renders each stage from the enabled state it was keyed by, even if the op is toggled mid-render", async () => {
    const options = { holdStages: true };
    const { pool, stageCalls } = fakePool(options);
    const session = new ProjectSession(defaultGlobalSettings(), null as never, null as never, pool);
    const { task } = arrange(session.snapshot().project);
    task.pipeline.ops.push({ id: "lut-late", type: "lut", enabled: false, params: { cubePath: "/luts/film.cube", strength: 0.5 } });

    const late = session.renderPreview(task.id);
    await until(() => stageCalls.length === 1);
    session.setOpEnabled(task.id, "lut-late", true);
    options.holdStages = false;
    stageCalls[0].release();
    // Keyed with the second op off, the late render must not apply it.
    expect(await firstPixel(await late)).toBe(10);

    session.setOpEnabled(task.id, "lut-late", false);
    expect(await firstPixel(await session.renderPreview(task.id))).toBe(10);
  });

  it("keeps recently previewed tasks within the byte budget and always keeps the active one", async () => {
    const { pool, baseCalls } = fakePool();
    const bitmapBytes = WIDTH * HEIGHT * 4;
    // Room for one other task's chain (base plus one stage) besides the task being previewed.
    const service = new PreviewService(pool, { budgetBytes: bitmapBytes * 2 });
    const project: Project = { outputDir: null, originals: [], tasks: [] };
    const a = arrange(project, "a");
    const b = arrange(project, "b");
    const c = arrange(project, "c");

    await service.renderTaskPreview(project, a.task.id, 1024);
    await service.renderTaskPreview(project, b.task.id, 1024);
    await service.renderTaskPreview(project, c.task.id, 1024);
    expect(baseCalls).toEqual(["/source/a.jpg", "/source/b.jpg", "/source/c.jpg"]);

    // b was kept; a, the least recently previewed, was dropped when c was rendered.
    await service.renderTaskPreview(project, b.task.id, 1024);
    expect(baseCalls).toHaveLength(3);
    await service.renderTaskPreview(project, a.task.id, 1024);
    expect(baseCalls).toEqual(["/source/a.jpg", "/source/b.jpg", "/source/c.jpg", "/source/a.jpg"]);
  });
});

function arrange(project: Project, name = "photo"): { task: Task; original: Original } {
  const original: Original = {
    id: `original-${name}`,
    sourcePath: `/source/${name}.jpg`,
    sourceHash: `hash-${name}`,
    size: 100,
    format: "jpeg",
    jpegQualityEstimate: null,
    metadataSummary: { editorial: {}, dates: {}, gps: {} },
    width: WIDTH,
    height: HEIGHT,
    addedAt: "2026-09-01T00:00:00.000Z"
  };
  const pipeline = defaultPipeline();
  pipeline.ops = [{ id: `lut-${name}`, type: "lut", enabled: true, params: { cubePath: "/luts/film.cube", strength: 0.1 } }];
  const task: Task = {
    id: `task-${name}`,
    originalId: original.id,
    generateDescription: false,
    generateSlug: false,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline,
    status: "not-saved",
    output: null,
    error: null,
    everEdited: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
  project.originals.push(original);
  project.tasks.push(task);
  return { task, original };
}

function filled(value: number): Uint8Array {
  return new Uint8Array(WIDTH * HEIGHT * 4).fill(value);
}

async function firstPixel(preview: { dataUrl: string }): Promise<number> {
  const png = Buffer.from(preview.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return data[0];
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  if (!condition()) throw new Error("condition was not reached");
}

describe("PreviewService LUT previews", () => {
  it("renders every LUT preview on the worker pool, never parsing a cube on the main process", async () => {
    const { pool, stageCalls } = fakePool();
    const service = new PreviewService(pool);
    const project: Project = { outputDir: null, originals: [], tasks: [] };
    const { task } = arrange(project);
    task.pipeline.ops = [];
    // Paths that do not exist: parsing either one here would fail the call.
    const luts = [
      { path: "/missing/one.cube", name: "one.cube", label: "One", source: "user" },
      { path: "/missing/two.cube", name: "two.cube", label: "Two", source: "user" }
    ] as unknown as Parameters<PreviewService["renderLutPreviews"]>[2];

    const previews = await service.renderLutPreviews(project, task.id, luts, WIDTH, undefined, 0.5);

    expect(previews.map((preview) => preview.path)).toEqual(["/missing/one.cube", "/missing/two.cube"]);
    expect(stageCalls.map((call) => call.strength)).toEqual([0.5, 0.5]);
    expect(await firstPixel(previews[0])).toBe(50);
  });
});
