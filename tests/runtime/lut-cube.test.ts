import { describe, expect, it } from "vitest";
import { parseCubeLut, sampleCubeLut, type CubeLut } from "@runtime/lut-cube";

// A 2x2x2 identity LUT: each entry equals its normalized grid coordinate.
const identityCube = `
TITLE "Identity"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

describe("parseCubeLut", () => {
  it("parses title, size, domain, and data", () => {
    const lut = parseCubeLut(identityCube);
    expect(lut.title).toBe("Identity");
    expect(lut.size).toBe(2);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
    expect(lut.data).toHaveLength(8);
  });

  it("ignores comments and blank lines", () => {
    const lut = parseCubeLut(`# comment\n\nLUT_3D_SIZE 2\n` + identityCube.split("LUT_3D_SIZE 2")[1]);
    expect(lut.size).toBe(2);
    expect(lut.data).toHaveLength(8);
  });

  it("respects DOMAIN_MIN / DOMAIN_MAX directives", () => {
    const lut = parseCubeLut(identityCube.replace("LUT_3D_SIZE 2", "LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 255 255 255"));
    expect(lut.domainMax).toEqual([255, 255, 255]);
  });

  it("throws on a missing or too-small size", () => {
    expect(() => parseCubeLut("0 0 0\n1 1 1")).toThrow(/LUT_3D_SIZE/i);
    expect(() => parseCubeLut("LUT_3D_SIZE 1\n0 0 0")).toThrow(/LUT_3D_SIZE/i);
  });

  it("throws when the entry count does not match size^3", () => {
    expect(() => parseCubeLut("LUT_3D_SIZE 2\n0 0 0\n1 1 1")).toThrow(/Expected 8 LUT entries, got 2/);
  });
});

describe("sampleCubeLut", () => {
  const lut: CubeLut = parseCubeLut(identityCube);

  it("returns the corner values exactly", () => {
    expect(sampleCubeLut(lut, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(sampleCubeLut(lut, 1, 1, 1)).toEqual([1, 1, 1]);
    expect(sampleCubeLut(lut, 1, 0, 0)).toEqual([1, 0, 0]);
  });

  it("interpolates the midpoint of an identity LUT to the input", () => {
    const [r, g, b] = sampleCubeLut(lut, 0.5, 0.25, 0.75);
    expect(r).toBeCloseTo(0.5, 10);
    expect(g).toBeCloseTo(0.25, 10);
    expect(b).toBeCloseTo(0.75, 10);
  });

  it("clamps inputs outside the domain", () => {
    expect(sampleCubeLut(lut, -1, 2, 0.5)).toEqual([0, 1, 0.5]);
  });
});
