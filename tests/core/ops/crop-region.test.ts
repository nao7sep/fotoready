import { describe, expect, it } from "vitest";
import { cropExtractRegion } from "@core/ops/_crop-region";

describe("cropExtractRegion", () => {
  it("projects an in-bounds crop (long-edge normalized) onto pixel coordinates", () => {
    // Landscape 4000x3000, long edge 4000; both axes scale by the long edge.
    expect(cropExtractRegion({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 4000, 3000)).toEqual({
      left: 400,
      top: 400,
      width: 2000,
      height: 2000
    });
  });

  it("caps a full-frame crop at the image bounds", () => {
    expect(cropExtractRegion({ x: 0, y: 0, w: 1, h: 1 }, 4000, 3000)).toEqual({
      left: 0,
      top: 0,
      width: 4000,
      height: 3000
    });
  });

  it("clamps an origin past the right edge to a 1px window instead of a zero/negative one", () => {
    // x = 1 on a 4000px-wide image would put left at the edge: extract would be 0px wide.
    const region = cropExtractRegion({ x: 1, y: 0, w: 1, h: 1 }, 4000, 3000);
    expect(region.width).toBeGreaterThanOrEqual(1);
    expect(region.left + region.width).toBeLessThanOrEqual(4000);
  });

  it("clamps a vertical origin past the bottom edge (a hand-edited sidecar) to stay in bounds", () => {
    // y = 0.8 * long edge 4000 = 3200, past the 3000px height.
    const region = cropExtractRegion({ x: 0, y: 0.8, w: 1, h: 1 }, 4000, 3000);
    expect(region.height).toBeGreaterThanOrEqual(1);
    expect(region.top + region.height).toBeLessThanOrEqual(3000);
  });

  it("never yields a non-positive or out-of-bounds region for any in- or out-of-range params", () => {
    for (const x of [0, 0.5, 1, 1.5]) {
      for (const y of [0, 0.5, 1, 2]) {
        for (const w of [0.0001, 0.5, 1, 3]) {
          for (const h of [0.0001, 0.5, 1, 3]) {
            const region = cropExtractRegion({ x, y, w, h }, 4000, 3000);
            expect(region.left).toBeGreaterThanOrEqual(0);
            expect(region.top).toBeGreaterThanOrEqual(0);
            expect(region.width).toBeGreaterThanOrEqual(1);
            expect(region.height).toBeGreaterThanOrEqual(1);
            expect(region.left + region.width).toBeLessThanOrEqual(4000);
            expect(region.top + region.height).toBeLessThanOrEqual(3000);
          }
        }
      }
    }
  });
});
