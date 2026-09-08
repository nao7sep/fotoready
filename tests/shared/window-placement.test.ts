import { describe, expect, it } from "vitest";
import { isUsableWindowBounds, resolveWindowRestoration } from "@shared/window-placement";
import type { WindowPlacementRecord } from "@shared/types/state";

const minimum = { width: 900, height: 600 };
const workAreas = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: -1280, y: 0, width: 1280, height: 1024 }
];

describe("resolveWindowRestoration", () => {
  it("uses FotoReady's maximized default when placement is missing", () => {
    expect(resolveWindowRestoration(null, minimum, workAreas)).toEqual({
      normalBounds: null,
      mode: "maximized"
    });
  });

  it("accepts complete normal bounds wholly contained by a current display", () => {
    const saved: WindowPlacementRecord = {
      normalBounds: { x: -1200, y: 40, width: 1000, height: 700 },
      mode: "normal"
    };
    expect(resolveWindowRestoration(saved, minimum, workAreas)).toEqual(saved);
  });

  it("rejects bounds below the current minimum or partially offscreen", () => {
    expect(isUsableWindowBounds({ x: 20, y: 20, width: 899, height: 700 }, minimum, workAreas)).toBe(false);
    expect(isUsableWindowBounds({ x: 1200, y: 20, width: 900, height: 700 }, minimum, workAreas)).toBe(false);
  });

  it("rejects non-finite, fractional, and cross-display rectangles", () => {
    expect(isUsableWindowBounds({ x: Number.NaN, y: 0, width: 900, height: 600 }, minimum, workAreas)).toBe(false);
    expect(isUsableWindowBounds({ x: 0.5, y: 0, width: 900, height: 600 }, minimum, workAreas)).toBe(false);
    expect(isUsableWindowBounds({ x: -400, y: 0, width: 1000, height: 700 }, minimum, workAreas)).toBe(false);
  });

  it("restores maximized mode independently when saved geometry is unusable", () => {
    const saved: WindowPlacementRecord = {
      normalBounds: { x: 1800, y: 900, width: 1000, height: 700 },
      mode: "maximized"
    };
    expect(resolveWindowRestoration(saved, minimum, workAreas)).toEqual({
      normalBounds: null,
      mode: "maximized"
    });
  });
});
