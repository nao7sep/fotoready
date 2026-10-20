import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireOpModule } from "@core/ops/registry";
import { decodeImage } from "@runtime/decode";
import { runPipeline } from "@runtime/pipeline-runner";
import { defaultPipeline } from "@shared/defaults";

// A portrait phone photo is usually stored on its side with an orientation tag; every edit and the
// saved image see it upright.
let dir: string;
let portrait: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-upright-"));
  portrait = path.join(dir, "portrait.jpg");
  // Stored 300 wide and 200 high; orientation 6 turns it upright to 200 × 300.
  await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg().withMetadata({ orientation: 6 }).toFile(portrait);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a photo with an orientation tag", () => {
  it("is decoded at its upright size", async () => {
    const { image } = await decodeImage(portrait);
    expect([image.width, image.height]).toEqual([200, 300]);
  });

  it("saves with a crop measured on the upright photo", async () => {
    const pipeline = defaultPipeline();
    pipeline.ops = [{ id: "crop", type: "crop", enabled: true, params: { ...structuredClone(requireOpModule("crop").defaultParams), x: 0.05, y: 0.5, w: 0.6, h: 0.45 } }] as never;
    pipeline.output = { ...pipeline.output, format: "jpeg", quality: 90 };
    const output = path.join(dir, "out.jpg");
    await runPipeline(pipeline, { sourcePath: portrait, outputPath: output });
    const saved = await sharp(output).metadata();
    // Crop rectangles are fractions of the long side, here 300; this one reaches below 200 px, so
    // it fits only the upright photo.
    expect([saved.width, saved.height]).toEqual([180, 135]);
  });
});
