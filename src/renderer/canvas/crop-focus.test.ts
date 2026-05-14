import { describe, expect, it } from "vitest";
import { fitImage, zoomToCropRect } from "./crop-focus";

describe("fitImage", () => {
  it("centers a landscape image in a landscape frame", () => {
    const placement = fitImage(1600, 900, 800, 600);
    expect(placement.scale).toBeCloseTo(0.5);
    expect(placement.width).toBeCloseTo(800);
    expect(placement.height).toBeCloseTo(450);
    expect(placement.x).toBeCloseTo(0);
    expect(placement.y).toBeCloseTo(75);
  });

  it("centers a portrait image in a landscape frame", () => {
    const placement = fitImage(900, 1600, 800, 600);
    expect(placement.scale).toBeCloseTo(600 / 1600);
    expect(placement.height).toBeCloseTo(600);
  });
});

describe("zoomToCropRect", () => {
  it("zooms so the larger crop dimension occupies 50% of the frame", () => {
    // image 1600×900, frame 800×600, crop covers 400×225 (25% of frame each)
    // after zoom: max(cropW/frameW, cropH/frameH) = 0.5
    const rect = { x: 600, y: 337, w: 400, h: 225 };
    const p = zoomToCropRect(1600, 900, 800, 600, rect);
    const ratioW = (rect.w * p.scale) / 800;
    const ratioH = (rect.h * p.scale) / 600;
    expect(Math.max(ratioW, ratioH)).toBeCloseTo(0.5);
  });

  it("does not zoom out below fitImage scale", () => {
    // crop is almost the full image — fitImage scale should win
    const fit = fitImage(1600, 900, 800, 600);
    const rect = { x: 0, y: 0, w: 1600, h: 900 };
    const p = zoomToCropRect(1600, 900, 800, 600, rect);
    expect(p.scale).toBeCloseTo(fit.scale);
  });
});
