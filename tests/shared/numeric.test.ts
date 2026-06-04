import { describe, expect, it } from "vitest";
import { clamp, clamp01 } from "@shared/numeric";

describe("clamp", () => {
  it("returns the value when inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to the bounds", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("clamp01", () => {
  it("clamps into [0, 1]", () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});
