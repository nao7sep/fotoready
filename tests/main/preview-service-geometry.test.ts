import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreviewService } from "@main/preview-service";
import { runPipeline } from "@runtime/pipeline-runner";
import { defaultPipeline } from "@shared/defaults";
import type { OpInstance } from "@shared/types/op";
import type { Original, Project, Task } from "@shared/types/project";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "fotoready-preview-geometry-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const op = (type: string, params: Record<string, unknown>): OpInstance => ({ id: type, type, enabled: true, params });
const blur = (radius: number, rects = [{ x: 0, y: 0, w: 1, h: 1, rotation: 0, shape: "rectangle" }]) => op("blur", { radius, rects });
const rotate = (degrees: number) => op("rotate", { degrees, fillColor: "#ffffff" });
const crop = (x: number, y: number, w: number, h: number) => op("crop", { x, y, w, h, aspectLock: null });
const resize = (width: number, height: number, mode = "exact") => op("resize", { width, height, mode, interpolation: "lanczos3" });

describe("PreviewService geometry and blur scale", () => {
  it.each([96, 160, 240])("matches full-render blur after downsampling to a %s-pixel preview", async (longEdge) => {
    await compareWithFullRender([blur(12)], longEdge);
  });

  it.each([
    [rotate(90), crop(0.1, 0.1, 0.5, 0.7), resize(240, 360), blur(12)],
    [resize(720, 480), rotate(30), crop(0.1, 0.1, 0.6, 0.4), blur(16)],
    [crop(0.1, 0.1, 0.6, 0.4), resize(120, 120, "fit"), blur(6)],
    [rotate(-35), resize(640, 640, "fit"), blur(10, [{ x: 0.2, y: 0.2, w: 0.4, h: 0.3, rotation: 17, shape: "ellipse" }])]
  ])("uses the full entering frame after a geometry chain", async (...ops) => {
    await compareWithFullRender(ops, 160);
  });

  it("conceals contrast within the blur region and preserves pixels outside it", async () => {
    const project = await sourceProject("stripes");
    const task = project.tasks[0];
    const service = new PreviewService(null);
    const before = await previewPixels(await service.renderTaskPreview(project, task.id, 240));
    task.pipeline.ops = [blur(12, [{ x: 0.25, y: 0.1, w: 0.4, h: 0.4, rotation: 0, shape: "rectangle" }])];
    const after = await previewPixels(await service.renderTaskPreview(project, task.id, 240));
    const insideBefore = sample(before.data, before.width, { x: 72, y: 48, w: 72, h: 48 });
    const insideAfter = sample(after.data, after.width, { x: 72, y: 48, w: 72, h: 48 });
    expect(standardDeviation(insideBefore)).toBeGreaterThan(90);
    expect(standardDeviation(insideAfter)).toBeLessThan(standardDeviation(insideBefore) / 4);
    expect(sample(after.data, after.width, { x: 8, y: 30, w: 32, h: 80 })).toEqual(sample(before.data, before.width, { x: 8, y: 30, w: 32, h: 80 }));
  });

  it("bounds resize previews by their full target and the configured preview edge", async () => {
    const project = await sourceProject("waves");
    const task = project.tasks[0];
    task.pipeline.ops = [resize(90, 45)];
    const service = new PreviewService(null);
    expect(await service.renderTaskPreview(project, task.id, 160)).toMatchObject({ width: 90, height: 45 });
    task.pipeline.ops = [resize(1200, 600)];
    expect(await service.renderTaskPreview(project, task.id, 160)).toMatchObject({ width: 160, height: 80 });
  });
});

async function compareWithFullRender(ops: OpInstance[], longEdge: number): Promise<void> {
  const project = await sourceProject("waves");
  const task = project.tasks[0];
  task.pipeline.ops = ops;
  const full = await runPipeline(task.pipeline, { sourcePath: project.originals[0].sourcePath });
  if (full.kind !== "buffer") throw new Error("Expected a full-resolution render buffer");
  const actual = await previewPixels(await new PreviewService(null).renderTaskPreview(project, task.id, longEdge));
  const expected = await sharp(full.bytes, { raw: { width: full.width, height: full.height, channels: 4 } })
    .resize({ width: actual.width, height: actual.height, fit: "fill" }).raw().toBuffer();
  // Blur and downsampling commute approximately; stage rounding and mask antialiasing differ.
  // Average RGB error stays small enough to detect using an unscaled full-resolution radius.
  let absoluteError = 0;
  for (let index = 0; index < expected.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) absoluteError += Math.abs(expected[index + channel] - actual.data[index + channel]);
  }
  expect(absoluteError / (actual.width * actual.height * 3)).toBeLessThan(8);
}

async function sourceProject(pattern: "waves" | "stripes"): Promise<Project> {
  const width = 480;
  const height = 320;
  const sourcePath = join(directory, `${pattern}.png`);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        pixels[index + channel] = pattern === "stripes" ? (Math.floor(x / 12) % 2) * 255 : Math.round(127 + 110 * Math.sin((x + y * 0.3) * 2 * Math.PI / [96, 48, 24][channel]));
      }
      pixels[index + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(sourcePath);
  const original = { id: "original", sourcePath, sourceHash: "source", width, height, format: "png" } as Original;
  const task = { id: "task", originalId: original.id, pipeline: defaultPipeline() } as Task;
  return { outputDir: null, originals: [original], tasks: [task] };
}

async function previewPixels(preview: { dataUrl: string }) {
  return sharp(Buffer.from(preview.dataUrl.split(",")[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => ({ data, width: info.width, height: info.height }));
}

function sample(data: Buffer, width: number, rect: { x: number; y: number; w: number; h: number }): number[] {
  const values: number[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) values.push(data[(y * width + x) * 4]);
  }
  return values;
}

function standardDeviation(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}
