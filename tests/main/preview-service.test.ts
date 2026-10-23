import sharp from "sharp";
import { mkdtemp, writeFile, rm, rename, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Project, Task } from "@shared/types/project";
import type { LutEntry } from "@shared/types/ipc";
import type { Pipeline } from "@shared/types/pipeline";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { PreviewService } from "@main/preview-service";
import { ProjectSession } from "@main/session";

let assetRoot: string;
let assetPath: string;
beforeEach(async () => {
  assetRoot = await mkdtemp(join(tmpdir(), "fotoready-preview-"));
  assetPath = join(assetRoot, "asset.cube");
  await writeFile(assetPath, "asset contents");
});
afterEach(async () => { await rm(assetRoot, { recursive: true, force: true }); });

const WIDTH = 4;
const HEIGHT = 2;

type StageCall = { strength: number; lane?: string; release(): void };

/** A worker pool whose stage renders fill the bitmap with the LUT strength and can be held open. */
function fakePool(options: { holdStages?: boolean; assetPixel?: number; backgroundCapacity?: number } = {}) {
  const baseCalls: string[] = [];
  const stageCalls: StageCall[] = [];
  const pool = {
    backgroundCapacity: options.backgroundCapacity ?? 1,
    async renderBuffer(input: { sourcePath: string }) {
      baseCalls.push(input.sourcePath);
      return { kind: "preview" as const, bitmap: filled(1).buffer, width: WIDTH, height: HEIGHT, format: "rgba8" as const, appliedPipeline: defaultPipeline() };
    },
    async renderStage(input: { pipeline: Pipeline; lane?: string }) {
      const strength = Number(input.pipeline.ops[0].params.strength);
      const pixel = options.assetPixel ?? Math.round(strength * 100);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      stageCalls.push({ strength, release, lane: input.lane });
      if (!options.holdStages) release();
      await gate;
      return { kind: "preview" as const, bitmap: filled(pixel).buffer, width: WIDTH, height: HEIGHT, format: "rgba8" as const, appliedPipeline: input.pipeline };
    }
  };
  return { pool: pool as unknown as PipelineWorkerPool, baseCalls, stageCalls };
}

/**
 * Renders through a service of its own over the session's live project. The session runs one preview
 * at a time, but the main preview and the LUT picker still render concurrently through one cache.
 */
function directRender(pool: PipelineWorkerPool, session: ProjectSession, taskId: string) {
  const service = new PreviewService(pool);
  return () => service.renderTaskPreview(session.snapshot().project, taskId, defaultGlobalSettings().previewLongEdge);
}

describe("PreviewService stage cache", () => {
  it("rereads an explicitly reselected overlay without manufacturing a recipe edit", async () => {
    const options = { assetPixel: 10 };
    const { pool, stageCalls } = fakePool(options);
    const session = new ProjectSession(defaultGlobalSettings(), null as never, null as never, pool, "resources/stamps");
    const { task } = arrange(session.project());
    task.pipeline.ops = [{ id: "stamp", type: "stamp", enabled: true, params: {
      assetPath, x: 0, y: 0, width: 0.2, height: 0.2,
      lockAspectRatio: true, flipHorizontal: false, flipVertical: false, opacity: 1, rotation: 0
    } }];
    expect(await firstPixel(await session.renderPreview(task.id))).toBe(10);
    const before = structuredClone(task);
    options.assetPixel = 20;
    session.updateOpParams(task.id, "stamp", { assetPath }, {
      expectedParams: structuredClone(task.pipeline.ops[0].params), expectedOriginalId: task.originalId
    });
    expect(await firstPixel(await session.renderPreview(task.id))).toBe(20);
    expect(task).toEqual(before);
    expect(stageCalls).toHaveLength(2);
  });

  it.each(["cubePath", "assetPath"])("retires %s task stages on library mutation, including held renders and other tasks", async (assetParam) => {
    const options = { holdStages: false, assetPixel: 10 };
    const { pool, stageCalls } = fakePool(options);
    const session = new ProjectSession(defaultGlobalSettings(), null as never, null as never, pool, "resources/stamps");
    const a = arrange(session.project(), "a").task;
    const b = arrange(session.project(), "b").task;
    for (const task of [a, b]) {
      task.pipeline.ops[0].params = { [assetParam]: assetPath, strength: 0.1 };
    }
    expect(await firstPixel(await session.renderPreview(a.id))).toBe(10);
    options.holdStages = true;
    const held = session.renderPreview(b.id);
    await until(() => stageCalls.length === 2);
    const before = structuredClone(session.project());
    session.invalidateAssetPreviews();
    options.assetPixel = 20;
    options.holdStages = false;
    stageCalls[1].release();
    expect(await firstPixel(await held)).toBe(10);
    expect(await firstPixel(await session.renderPreview(a.id))).toBe(20);
    expect(await firstPixel(await session.renderPreview(b.id))).toBe(20);
    expect(await firstPixel(await session.renderPreview(b.id))).toBe(20);
    expect(stageCalls).toHaveLength(4);
    expect(session.project()).toEqual(before);
  });

  it.each(["cubePath", "assetPath"])("checks external %s replacement before serving a cache hit", async (assetParam) => {
    const options = { assetPixel: 10 };
    const { pool, stageCalls } = fakePool(options);
    const service = new PreviewService(pool);
    const project: Project = { outputDir: null, originals: [], tasks: [] };
    const { task } = arrange(project);
    task.pipeline.ops[0].params = { [assetParam]: assetPath, strength: 0.1 };
    expect(await firstPixel(await service.renderTaskPreview(project, task.id, 1024))).toBe(10);
    const originalStat = await stat(assetPath);
    const replacement = join(assetRoot, "replacement.cube");
    await writeFile(replacement, "asset contents");
    await utimes(replacement, originalStat.atime, originalStat.mtime);
    await rename(replacement, assetPath);
    options.assetPixel = 20;
    expect(await firstPixel(await service.renderTaskPreview(project, task.id, 1024))).toBe(20);
    expect(stageCalls).toHaveLength(2);
    await rm(assetPath);
    await expect(service.renderTaskPreview(project, task.id, 1024)).rejects.toThrow(/ENOENT/);
  });

  it("inspects only enabled references through the requested stage", async () => {
    const { pool, stageCalls } = fakePool();
    const service = new PreviewService(pool);
    const project: Project = { outputDir: null, originals: [], tasks: [] };
    const { task } = arrange(project);
    task.pipeline.ops.push({ id: "missing", type: "lut", enabled: true, params: { cubePath: join(assetRoot, "missing.cube"), strength: 0.2 } });
    await service.renderTaskPreview(project, task.id, 1024, { mode: "input", targetOpId: "missing" });
    expect(stageCalls).toHaveLength(1);
    await expect(service.renderTaskPreview(project, task.id, 1024)).rejects.toThrow(/ENOENT/);
    task.pipeline.ops[1].enabled = false;
    await service.renderTaskPreview(project, task.id, 1024);
    expect(stageCalls).toHaveLength(1);
  });

  it("never serves a stage rendered for an edit that was superseded while it rendered", async () => {
    const { pool, stageCalls } = fakePool({ holdStages: true });
    const session = new ProjectSession(defaultGlobalSettings(), null as never, null as never, pool, "resources/stamps");
    const { task } = arrange(session.snapshot().project);
    const render = directRender(pool, session, task.id);
    const opId = task.pipeline.ops[0].id;

    const late = render();
    await until(() => stageCalls.length === 1);
    session.updateOpParam(task.id, opId, "strength", 0.2);

    const fresh = render();
    await until(() => stageCalls.length === 2);
    stageCalls[1].release();
    expect(await firstPixel(await fresh)).toBe(20);

    stageCalls[0].release();
    expect(await firstPixel(await late)).toBe(10);

    // The late v1 render must not have replaced the stage the current value needs.
    expect(await firstPixel(await render())).toBe(20);
    expect(stageCalls).toHaveLength(2);
  });

  it("renders each stage from the enabled state it was keyed by, even if the op is toggled mid-render", async () => {
    const options = { holdStages: true };
    const { pool, stageCalls } = fakePool(options);
    const session = new ProjectSession(defaultGlobalSettings(), null as never, null as never, pool, "resources/stamps");
    const { task } = arrange(session.snapshot().project);
    const render = directRender(pool, session, task.id);
    task.pipeline.ops.push({ id: "lut-late", type: "lut", enabled: false, params: { cubePath: assetPath, strength: 0.5 } });

    const late = render();
    await until(() => stageCalls.length === 1);
    session.setOpEnabled(task.id, "lut-late", true);
    options.holdStages = false;
    stageCalls[0].release();
    // Keyed with the second op off, the late render must not apply it.
    expect(await firstPixel(await late)).toBe(10);

    session.setOpEnabled(task.id, "lut-late", false);
    expect(await firstPixel(await render())).toBe(10);
  });

  it("does not retain an active bitmap larger than the entire budget", async () => {
    const { pool, baseCalls } = fakePool();
    const service = new PreviewService(pool, { budgetBytes: 1 });
    const project: Project = { outputDir: null, originals: [], tasks: [] };
    const { task } = arrange(project);
    const first = await service.renderTaskPreview(project, task.id, 1024);
    const second = await service.renderTaskPreview(project, task.id, 1024);
    expect(second).toEqual(first);
    expect(baseCalls).toHaveLength(2);
  });

  it("charges active and inactive chains against the same byte budget", async () => {
    const { pool, baseCalls } = fakePool();
    const bitmapBytes = WIDTH * HEIGHT * 4;
    // Room for two chains, including the current one.
    const service = new PreviewService(pool, { budgetBytes: bitmapBytes * 4 });
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
  pipeline.ops = [{ id: `lut-${name}`, type: "lut", enabled: true, params: { cubePath: assetPath, strength: 0.1 } }];
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

async function firstPixel(preview: { dataUrl: string } | null): Promise<number> {
  if (!preview) throw new Error("preview unexpectedly superseded");
  const png = Buffer.from(preview.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return data[0];
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  if (!condition()) throw new Error("condition was not reached");
}

describe("PreviewService LUT previews", () => {
  const luts = (count: number): LutEntry[] => Array.from({ length: count }, (_, index) => ({ name: `LUT ${index}`, path: `/luts/${index}.cube`, builtin: false }));

  it("bounds admitted LUT work by background capacity and stops future work on cancellation", async () => {
    const { pool, stageCalls } = fakePool({ holdStages: true, backgroundCapacity: 2 });
    const service = new PreviewService(pool);
    const project: Project = { outputDir: null, originals: [], tasks: [] };
    const { task } = arrange(project);
    task.pipeline.ops = [];
    const controller = new AbortController();
    const pending = service.renderLutPreviews(project, task.id, luts(20), WIDTH, undefined, 0.5, controller.signal);
    await until(() => stageCalls.length === 2);
    expect(stageCalls.map((call) => call.lane)).toEqual(["background", "background"]);
    controller.abort();
    stageCalls[0].release();
    stageCalls[1].release();
    expect(await pending).toBeNull();
    expect(stageCalls).toHaveLength(2);
  });

  it("supersedes an old library run after its admitted LUT settles", async () => {
    const options = { holdStages: true };
    const { pool, stageCalls } = fakePool(options);
    const session = new ProjectSession(defaultGlobalSettings(), null as never, null as never, pool, "resources/stamps");
    const { task } = arrange(session.project());
    task.pipeline.ops = [];
    const old = session.renderLutPreviews(task.id, luts(20), undefined, 0.1, WIDTH);
    await until(() => stageCalls.length === 1);
    const fresh = session.renderLutPreviews(task.id, luts(2), undefined, 0.2, WIDTH);
    options.holdStages = false;
    stageCalls[0].release();
    expect(await old).toBeNull();
    expect(await fresh).toHaveLength(2);
    expect(stageCalls.map((call) => call.strength)).toEqual([0.1, 0.2, 0.2]);
  });

  it("stops further library work when the session cancels a closed picker", async () => {
    const { pool, stageCalls } = fakePool({ holdStages: true });
    const session = new ProjectSession(defaultGlobalSettings(), null as never, null as never, pool, "resources/stamps");
    const { task } = arrange(session.project());
    task.pipeline.ops = [];
    const pending = session.renderLutPreviews(task.id, luts(20), undefined, 0.1, WIDTH);
    await until(() => stageCalls.length === 1);
    session.cancelLutPreview();
    stageCalls[0].release();
    expect(await pending).toBeNull();
    expect(stageCalls).toHaveLength(1);
  });

  it("retains healthy native LUT previews beside a malformed file", async () => {
    const project: Project = { outputDir: null, originals: [], tasks: [] };
    const { task, original } = arrange(project);
    task.pipeline.ops = [];
    original.sourcePath = join(assetRoot, "source.png");
    await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: "red" } }).png().toFile(original.sourcePath);
    const goodPath = join(assetRoot, "identity.cube");
    await writeFile(goodPath, "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n");
    const entries = [assetPath, goodPath].map((path) => ({ name: path, path, builtin: false }));
    const result = await new PreviewService(null).renderLutPreviews(project, task.id, entries, WIDTH, undefined, 1);
    expect(result![0]).toMatchObject({ dataUrl: "", width: 0, height: 0, error: expect.any(String) });
    expect(result![1].error).toBeUndefined();
    expect(await firstPixel(result![1])).toBe(255);
  });

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

    expect(previews!.map((preview) => preview.path)).toEqual(["/missing/one.cube", "/missing/two.cube"]);
    expect(stageCalls.map((call) => call.strength)).toEqual([0.5, 0.5]);
    expect(await firstPixel(previews![0])).toBe(50);
  });
});
