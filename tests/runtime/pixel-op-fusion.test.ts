import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";
import { requireOpModule } from "@core/ops/registry";
import { parseCubeLut } from "@runtime/lut-cube";
import { runPipelineFromRaw } from "@runtime/pipeline-runner";
import { defaultPipeline } from "@shared/defaults";
import type { Pipeline } from "@shared/types/pipeline";

type OpInstance = Pipeline["ops"][number];

// Consecutive per-pixel ops share one buffer in a save; the result must be exactly what running
// each op on its own gives.
const warmCube = parseCubeLut(`LUT_3D_SIZE 2
0.0 0.0 0.1
1.0 0.1 0.0
0.0 1.0 0.1
1.0 1.0 0.0
0.1 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 0.95 0.9
`);

function op(type: string, params: Record<string, unknown>): OpInstance {
  return { id: type, type, enabled: true, params: { ...structuredClone(requireOpModule(type).defaultParams), ...params } } as OpInstance;
}

const OPS: OpInstance[] = [
  op("curves", { rgb: [[0, 10], [128, 150], [255, 240]] }),
  op("levels", { blackPoint: 12, whitePoint: 230, gamma: 1.3 }),
  op("hsl", { all: { hue: 20, sat: 0.2, lum: -0.05 } }),
  op("lut", { cubePath: "warm.cube", strength: 0.6 }),
  op("crop", { x: 0.1, y: 0.1, w: 0.7, h: 0.8 })
];

async function source(): Promise<{ bytes: Buffer; width: number; height: number }> {
  const { data, info } = await sharp({ create: { width: 48, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } })
    .raw().toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
}

async function oneAtATime(ops: OpInstance[], start: { bytes: Buffer; width: number; height: number }): Promise<Buffer> {
  let image = sharp(Buffer.from(start.bytes), { raw: { width: start.width, height: start.height, channels: 4 } });
  let width = start.width;
  let height = start.height;
  for (const instance of ops) {
    const result = await requireOpModule(instance.type).apply!(image, instance.params as never, { sourceWidth: width, sourceHeight: height, resolveLut: async () => warmCube });
    if ("image" in result && "width" in result) {
      image = result.image;
      width = result.width;
      height = result.height;
    } else {
      image = result as Sharp;
    }
  }
  return image.ensureAlpha().raw().toBuffer();
}

describe("per-pixel ops sharing one buffer", () => {
  for (const order of [
    ["curves", "levels", "hsl", "lut"],
    ["lut", "crop", "curves", "hsl"],
    ["crop", "levels", "lut", "curves", "hsl"]
  ]) {
    it(`gives exactly the one-op-at-a-time result for ${order.join(" → ")}`, async () => {
      const start = await source();
      const ops = order.map((type) => OPS.find((candidate) => candidate.type === type)!);
      const pipeline = { ...defaultPipeline(), ops };
      const shared = await runPipelineFromRaw(pipeline, { bytes: Buffer.from(start.bytes), width: start.width, height: start.height }, { resolveLut: async () => warmCube });
      expect(Buffer.compare(shared.bytes, await oneAtATime(ops, start))).toBe(0);
    });
  }
});
