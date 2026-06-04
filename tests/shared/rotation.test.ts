import { describe, expect, it } from "vitest";
import { formatAngle, normalizeAngle, wrapAngle } from "@shared/rotation";

describe("wrapAngle", () => {
  it("leaves values already in (-180, 180] untouched", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(45)).toBe(45);
    expect(wrapAngle(-179)).toBe(-179);
  });

  it("keeps 180 but wraps -180 up to 180", () => {
    expect(wrapAngle(180)).toBe(180);
    expect(wrapAngle(-180)).toBe(180);
  });

  it("wraps values outside the canonical range", () => {
    expect(wrapAngle(360)).toBe(0);
    expect(wrapAngle(270)).toBe(-90);
    expect(wrapAngle(-270)).toBe(90);
    expect(wrapAngle(540)).toBe(180);
  });

  it("preserves sub-degree precision", () => {
    expect(wrapAngle(200.5)).toBeCloseTo(-159.5, 10);
  });
});

describe("normalizeAngle", () => {
  it("rounds to the nearest integer degree before wrapping", () => {
    expect(normalizeAngle(89.6)).toBe(90);
    // -0.4 rounds toward zero; the result is numerically 0 (the sign of zero is irrelevant —
    // it serializes to 0 and compares === 0). `+ 0` normalizes -0 to +0 for the assertion.
    expect(normalizeAngle(-0.4) + 0).toBe(0);
    expect(normalizeAngle(179.5)).toBe(180);
    expect(normalizeAngle(180.5)).toBe(-179);
  });
});

describe("formatAngle", () => {
  it("prefixes positive angles with + and rounds", () => {
    expect(formatAngle(90)).toBe("+90°");
    expect(formatAngle(45.4)).toBe("+45°");
  });

  it("renders zero and negatives without a leading +", () => {
    expect(formatAngle(0)).toBe("0°");
    expect(formatAngle(-90)).toBe("-90°");
  });
});
