import { describe, expect, it } from "vitest";
import { fitImage } from "./crop-focus";

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
