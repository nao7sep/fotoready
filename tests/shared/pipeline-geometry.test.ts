import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { cropExtractRegion, maximumPipelinePixels, outputSizeForOp, stageInputSizes, type ImageSize } from "@shared/pipeline-geometry";
import type { OpInstance } from "@shared/types/op";
import { cropModule } from "@core/ops/crop";
import { rotateModule } from "@core/ops/rotate";
import { resizeModule } from "@core/ops/resize";

const op = (type: string, params: Record<string, unknown>, enabled = true): OpInstance => ({ id: type, type, params, enabled });
const rotate = (degrees: number) => op("rotate", { degrees, fillColor: "rgba(0,0,0,0)" });
const resize = (width: number, height: number, mode = "exact") => op("resize", { mode, width, height, interpolation: "lanczos3" });
const crop = (x: number, y: number, w: number, h: number) => op("crop", { x, y, w, h, aspectLock: null });

describe("pipeline stage frames", () => {
  it("reports inputs in card order through crop, rotation, resize and unchanged stages", () => {
    expect(stageInputSizes({ width: 400, height: 300 }, [crop(0.1, 0.1, 0.5, 0.5), rotate(90), resize(80, 40), op("exposure", {})])).toEqual([
      { width: 400, height: 300 },
      { width: 200, height: 200 },
      { width: 200, height: 200 },
      { width: 80, height: 40 }
    ]);
  });

  it("retains disabled card indices while skipping their geometry", () => {
    const disabled = { ...resize(900, 700), enabled: false };
    expect(stageInputSizes({ width: 240, height: 160 }, [disabled, rotate(90), crop(0, 0, 1, 1)])).toEqual([
      { width: 240, height: 160 }, { width: 240, height: 160 }, { width: 160, height: 240 }
    ]);
    expect(outputSizeForOp({ width: 240, height: 160 }, disabled)).toEqual({ width: 240, height: 160 });
    expect(maximumPipelinePixels({ width: 240, height: 160 }, [disabled])).toBe(240 * 160);
  });

  it("uses the rotated input frame for a crop reset to the full image", () => {
    const source = { width: 240, height: 160 };
    const rotated = outputSizeForOp(source, rotate(30));
    expect(rotated).toEqual({ width: 288, height: 259 });
    const longEdge = Math.max(rotated.width, rotated.height);
    const reset = crop(0, 0, rotated.width / longEdge, rotated.height / longEdge);
    expect(outputSizeForOp(rotated, reset)).toEqual(rotated);
    expect(cropExtractRegion(reset.params as { x: number; y: number; w: number; h: number }, rotated.width, rotated.height)).toEqual({ left: 0, top: 0, ...rotated });
  });

  it("keeps the largest intermediate when enlargement is followed by shrinking", () => {
    expect(maximumPipelinePixels({ width: 240, height: 160 }, [resize(2000, 1000), resize(80, 40)])).toBe(2_000_000);
    expect(maximumPipelinePixels({ width: 240, height: 160 }, [])).toBe(240 * 160);
  });

  it("compares actual frame areas rather than independent maximum dimensions", () => {
    expect(maximumPipelinePixels({ width: 1000, height: 100 }, [resize(100, 1000)])).toBe(100_000);
  });

  it.each([0, 90, -90, 180, -180, 30, -30, 45, 135])("matches native rotation dimensions at %s degrees", async (degrees) => {
    await expectNativeSize({ width: 240, height: 160 }, rotate(degrees));
  });

  it.each([
    { source: { width: 241, height: 163 }, operation: resize(101, 99, "fit") },
    { source: { width: 163, height: 241 }, operation: resize(600, 350, "fit") },
    { source: { width: 1000, height: 3 }, operation: resize(2, 2, "fit") },
    { source: { width: 241, height: 163 }, operation: resize(101, 99) },
    { source: { width: 241, height: 163 }, operation: crop(0.1, 0.2, 0.5, 0.4) },
    { source: { width: 163, height: 241 }, operation: crop(0.4, 0.8, 0.7, 0.5) }
  ])("matches native crop and resize dimensions for $source.width x $source.height", async ({ source, operation }) => {
    await expectNativeSize(source, operation);
  });
});

async function expectNativeSize(source: ImageSize, operation: OpInstance): Promise<void> {
  const image = sharp({ create: { ...source, channels: 4, background: "white" } });
  const context = { sourceWidth: source.width, sourceHeight: source.height };
  let result;
  switch (operation.type) {
    case "crop": result = await cropModule.apply!(image, cropModule.validate(operation.params), context); break;
    case "rotate": result = await rotateModule.apply!(image, rotateModule.validate(operation.params), context); break;
    case "resize": result = await resizeModule.apply!(image, resizeModule.validate(operation.params), context); break;
    default: throw new Error(`No native geometry oracle for ${operation.type}`);
  }
  if (!("image" in result)) throw new Error("Geometry operations must materialize their output frame.");
  expect(outputSizeForOp(source, operation)).toEqual({ width: result.width, height: result.height });
}
