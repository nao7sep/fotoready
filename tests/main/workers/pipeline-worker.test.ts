import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import pipelineWorker from "@main/workers/pipeline-worker";
import { getOpDefinition } from "@core/ops/catalog";
import { defaultOutputSettings } from "@shared/defaults";
import type { OpInstance } from "@shared/types/op";
import type { OutputSettings, Pipeline } from "@shared/types/pipeline";
import type { WorkerResult } from "@runtime/image";

// The worker entry the pool runs, called in process: decode, the ops, encode,
// and the result contract the main process reads. The photo is four solid
// quadrants, so where each colour lands proves what each op did.
const WIDTH = 600;
const HEIGHT = 400;
const RED = { r: 220, g: 30, b: 30 };
const GREEN = { r: 30, g: 200, b: 60 };
const BLUE = { r: 30, g: 60, b: 220 };
const GREY = { r: 128, g: 128, b: 128 };

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-worker-"));
  roots.push(root);
  return root;
}

/** A JPEG photo: red top-left, green top-right, blue bottom-left, grey bottom-right. */
async function quadrantPhoto(root: string): Promise<string> {
  const half = { width: WIDTH / 2, height: HEIGHT / 2, channels: 3 as const };
  const tile = (background: typeof RED) => sharp({ create: { ...half, background } }).png().toBuffer();
  const photo = path.join(root, "photo.jpg");
  await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: GREY } })
    .composite([
      { input: await tile(RED), left: 0, top: 0 },
      { input: await tile(GREEN), left: WIDTH / 2, top: 0 },
      { input: await tile(BLUE), left: 0, top: HEIGHT / 2 }
    ])
    .jpeg({ quality: 95 })
    .toFile(photo);
  return photo;
}

/** An op as the session adds it: the catalog defaults, then the edited params. */
function op(type: string, params: Record<string, unknown> = {}): OpInstance {
  const definition = getOpDefinition(type);
  if (!definition) throw new Error(`Unknown op: ${type}`);
  return { id: `${type}-1`, type, enabled: true, params: { ...structuredClone(definition.defaultParams), ...params } };
}

function pipeline(ops: OpInstance[], output: Partial<OutputSettings> = {}): Pipeline {
  return { ops, output: { ...defaultOutputSettings(), ...output } };
}

async function preview(sourcePath: string, ops: OpInstance[], previewLongEdge: number | null = null) {
  const result = await pipelineWorker({
    jobId: "preview",
    kind: "preview",
    sourcePath,
    pipeline: pipeline(ops),
    outputPath: null,
    previewLongEdge
  });
  if (result.kind !== "preview") throw new Error(`Expected a preview, got ${JSON.stringify(result)}`);
  return result;
}

function pixel(frame: { bitmap: ArrayBuffer; width: number }, x: number, y: number) {
  const bytes = new Uint8Array(frame.bitmap);
  const i = (y * frame.width + x) * 4;
  return { r: bytes[i]!, g: bytes[i + 1]!, b: bytes[i + 2]! };
}

async function filePixel(file: string, x: number, y: number) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
}

function near(actual: { r: number; g: number; b: number }, expected: typeof RED, tolerance = 24): boolean {
  return Math.abs(actual.r - expected.r) <= tolerance
    && Math.abs(actual.g - expected.g) <= tolerance
    && Math.abs(actual.b - expected.b) <= tolerance;
}

describe("the pipeline worker", () => {
  it("renders the editor's preview of a photo at the preview size", async () => {
    const photo = await quadrantPhoto(await workspace());
    const frame = await preview(photo, [], 300);
    expect(frame).toMatchObject({ width: 300, height: 200, format: "rgba8" });
    expect(near(pixel(frame, 75, 50), RED)).toBe(true);
    expect(near(pixel(frame, 225, 50), GREEN)).toBe(true);
    expect(near(pixel(frame, 75, 150), BLUE)).toBe(true);
  });

  it("saves a photo through crop, rotate, flip, and resize", async () => {
    const root = await workspace();
    const photo = await quadrantPhoto(root);
    const outputPath = path.join(root, "photo-edited.jpg");
    // Crop the left half (red over blue), turn it a quarter clockwise (blue left,
    // red right), mirror it (red left, blue right), and fit it into 200 x 200.
    const result: WorkerResult = await pipelineWorker({
      jobId: "save",
      kind: "process",
      sourcePath: photo,
      pipeline: pipeline(
        [
          op("crop", { x: 0, y: 0, w: 0.5, h: HEIGHT / WIDTH }),
          op("rotate", { degrees: 90 }),
          op("flip", { horizontal: true }),
          op("resize", { mode: "fit", width: 200, height: 200 })
        ],
        { format: "jpeg", quality: 90 }
      ),
      outputPath,
      previewLongEdge: null
    });

    if (result.kind !== "process") throw new Error(`Expected a saved file, got ${JSON.stringify(result)}`);
    const written = await fs.readFile(outputPath);
    expect(result.bytes).toBe(written.byteLength);
    expect(await sharp(outputPath).metadata()).toMatchObject({ format: "jpeg", width: 200, height: 150 });
    expect(near(await filePixel(outputPath, 50, 75), RED)).toBe(true);
    expect(near(await filePixel(outputPath, 150, 75), BLUE)).toBe(true);
  });

  it("applies levels and a text watermark to the pixels they own", async () => {
    const photo = await quadrantPhoto(await workspace());
    const plain = await preview(photo, []);
    const toned = await preview(photo, [op("levels", { blackPoint: 64, whitePoint: 255, gamma: 1 })]);
    const marked = await preview(photo, [op("watermark-text", { text: "FotoReady", x: 0.7, y: 0.52, opacity: 1 })]);

    // Levels pulls the grey quadrant darker.
    expect(pixel(toned, 450, 300).r).toBeLessThan(pixel(plain, 450, 300).r - 20);
    // The watermark changes the grey quadrant under its box and leaves the red one alone.
    const differs = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (!near(pixel(marked, x, y), pixel(plain, x, y), 8)) return true;
        }
      }
      return false;
    };
    expect(differs(420, 310, 560, 350), "the watermark is drawn").toBe(true);
    expect(differs(0, 0, 300, 200), "the rest of the photo is untouched").toBe(false);
  });

  it("reports an undecodable source as a decode failure instead of throwing", async () => {
    const root = await workspace();
    const broken = path.join(root, "broken.jpg");
    await fs.writeFile(broken, "not an image");
    const result = await pipelineWorker({
      jobId: "broken",
      kind: "process",
      sourcePath: broken,
      pipeline: pipeline([], { format: "jpeg", quality: 90 }),
      outputPath: path.join(root, "never.jpg"),
      previewLongEdge: null
    });
    expect(result).toMatchObject({ kind: "error", category: "decode" });
  });
});
