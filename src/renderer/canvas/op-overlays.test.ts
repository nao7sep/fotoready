import { describe, expect, it } from "vitest";
import {
  applyCropAspect,
  cropAspectOptionId,
  fullCropRect,
  imageBoundsFromSize,
  resolveCropAspectRatio
} from "./op-overlays";

describe("op overlays crop helpers", () => {
  it("computes image bounds from landscape size", () => {
    expect(imageBoundsFromSize({ width: 1600, height: 900 })).toEqual({
      maxX: 1,
      maxY: 0.5625
    });
  });

  it("returns the full crop for image bounds", () => {
    expect(fullCropRect({ maxX: 1, maxY: 0.75 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 0.75
    });
  });

  it("applies a square crop without leaving image bounds", () => {
    const bounds = imageBoundsFromSize({ width: 1600, height: 900 });
    const crop = applyCropAspect(fullCropRect(bounds), 1, bounds);
    expect(crop).toEqual({
      x: 0.21875,
      y: 0,
      w: 0.5625,
      h: 0.5625
    });
  });

  it("resolves crop aspect ratios from preset values", () => {
    expect(resolveCropAspectRatio("16:9", 4 / 3)).toBeCloseTo(16 / 9);
    expect(resolveCropAspectRatio("original", 4 / 3)).toBeCloseTo(4 / 3);
    expect(resolveCropAspectRatio(null, 4 / 3)).toBeNull();
  });

  it("detects named crop aspect options", () => {
    expect(cropAspectOptionId(null, 4 / 3)).toBe("free");
    expect(cropAspectOptionId("original", 4 / 3)).toBe("original");
    expect(cropAspectOptionId(1, 4 / 3)).toBe("1:1");
    expect(cropAspectOptionId("16:9", 4 / 3)).toBe("16:9");
  });
});
