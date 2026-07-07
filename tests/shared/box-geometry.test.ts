import { describe, expect, it } from "vitest";
import {
  clampFractionBox,
  placeFractionBoxRandomly,
  rotatedFractionBoxBounds,
  type BoxBounds
} from "@shared/box-geometry";

const fullBounds: BoxBounds = { maxX: 1, maxY: 1 };

describe("clampFractionBox", () => {
  it("leaves an in-bounds box unchanged", () => {
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const result = clampFractionBox(box, fullBounds);
    expect(result).toMatchObject({ x: 0.1, y: 0.2, w: 0.3, h: 0.4, rotation: 0 });
  });

  it("slides a box inward instead of letting it overshoot the bounds", () => {
    const result = clampFractionBox({ x: 0.9, y: 0.9, w: 0.3, h: 0.3 }, fullBounds);
    expect(result.x + result.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.y + result.h).toBeLessThanOrEqual(1 + 1e-9);
    // Size is preserved; only position moves inward.
    expect(result.w).toBeCloseTo(0.3, 10);
    expect(result.h).toBeCloseTo(0.3, 10);
    expect(result.x).toBeCloseTo(0.7, 10);
    expect(result.y).toBeCloseTo(0.7, 10);
  });

  it("clamps width/height to the bounds and honors the min size floor", () => {
    const tooBig = clampFractionBox({ x: 0, y: 0, w: 5, h: 5 }, fullBounds);
    expect(tooBig.w).toBeLessThanOrEqual(1);
    expect(tooBig.h).toBeLessThanOrEqual(1);

    const tooSmall = clampFractionBox({ x: 0, y: 0, w: 0.0001, h: 0.0001 }, fullBounds, 0.01);
    expect(tooSmall.w).toBeCloseTo(0.01, 10);
    expect(tooSmall.h).toBeCloseTo(0.01, 10);
  });

  it("falls back to defaults for non-finite inputs", () => {
    const result = clampFractionBox(
      { x: NaN, y: Infinity, w: -1, h: NaN },
      fullBounds,
      0.01
    );
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
    expect(result.w).toBeGreaterThanOrEqual(0.01);
    expect(result.h).toBeGreaterThanOrEqual(0.01);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("respects asymmetric bounds (short-edge axis tops out below the long edge)", () => {
    const bounds: BoxBounds = { maxX: 1, maxY: 0.6 };
    const result = clampFractionBox({ x: 0, y: 0, w: 1, h: 1 }, bounds);
    expect(result.w).toBeLessThanOrEqual(1);
    expect(result.h).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  it("scales a rotated box down so its rotated bounds still fit", () => {
    // A square rotated 45° has a diagonal extent of w*sqrt(2); a full-width square
    // must shrink to fit its rotated footprint inside the bounds.
    const result = clampFractionBox({ x: 0, y: 0, w: 1, h: 1, rotation: 45 }, fullBounds);
    const rotated = rotatedFractionBoxBounds(result, result.rotation ?? 0);
    expect(rotated.x).toBeGreaterThanOrEqual(-1e-9);
    expect(rotated.y).toBeGreaterThanOrEqual(-1e-9);
    expect(rotated.x + rotated.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(rotated.y + rotated.height).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.w).toBeLessThan(1);
  });
});

describe("placeFractionBoxRandomly", () => {
  it("keeps the box in bounds for the extreme random values", () => {
    const box = { x: 0, y: 0, w: 0.3, h: 0.3 };

    const atZero = placeFractionBoxRandomly(box, fullBounds, 0.01, () => 0);
    expect(atZero.x).toBeCloseTo(0, 10);
    expect(atZero.y).toBeCloseTo(0, 10);

    const atOne = placeFractionBoxRandomly(box, fullBounds, 0.01, () => 1);
    expect(atOne.x + atOne.w).toBeCloseTo(1, 10);
    expect(atOne.y + atOne.h).toBeCloseTo(1, 10);
  });

  it("preserves the requested size while placing", () => {
    const result = placeFractionBoxRandomly({ x: 0, y: 0, w: 0.25, h: 0.4 }, fullBounds, 0.01, () => 0.5);
    expect(result.w).toBeCloseTo(0.25, 10);
    expect(result.h).toBeCloseTo(0.4, 10);
    expect(result.x).toBeCloseTo((1 - 0.25) * 0.5, 10);
    expect(result.y).toBeCloseTo((1 - 0.4) * 0.5, 10);
  });
});

describe("rotatedFractionBoxBounds", () => {
  it("returns the original box for 0°", () => {
    const result = rotatedFractionBoxBounds({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 0);
    expect(result.x).toBeCloseTo(0.1, 10);
    expect(result.y).toBeCloseTo(0.2, 10);
    expect(result.width).toBeCloseTo(0.3, 10);
    expect(result.height).toBeCloseTo(0.4, 10);
  });

  it("swaps the extents at 90°", () => {
    const result = rotatedFractionBoxBounds({ x: 0, y: 0, w: 0.3, h: 0.4 }, 90);
    expect(result.width).toBeCloseTo(0.4, 10);
    expect(result.height).toBeCloseTo(0.3, 10);
  });

  it("expands a square to its diagonal at 45°", () => {
    const result = rotatedFractionBoxBounds({ x: 0, y: 0, w: 0.2, h: 0.2 }, 45);
    expect(result.width).toBeCloseTo(0.2 * Math.SQRT2, 6);
    expect(result.height).toBeCloseTo(0.2 * Math.SQRT2, 6);
  });
});
