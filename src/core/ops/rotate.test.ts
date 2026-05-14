import { describe, expect, it } from "vitest";
import "./catalog";
import { requireOpModule } from "./registry";

describe("rotate op", () => {
  const module = requireOpModule("rotate");

  it("registers with the expected metadata", () => {
    expect(module.label).toBe("Rotate");
    expect(module.category).toBe("Geometry");
    expect(module.previewBehavior).toBe("show-output");
    expect(module.defaultParams).toEqual({ degrees: 0, fillColor: "#ffffff" });
  });

  it("validates well-formed params", () => {
    expect(module.validate({ degrees: 45, fillColor: "#abcdef" })).toEqual({ degrees: 45, fillColor: "#abcdef" });
  });

  it("rejects degrees outside the supported range", () => {
    expect(() => module.validate({ degrees: 200, fillColor: "#ffffff" })).toThrow(/degrees/);
    expect(() => module.validate({ degrees: -181, fillColor: "#ffffff" })).toThrow(/degrees/);
  });

  it("rejects unknown params", () => {
    expect(() => module.validate({ degrees: 0, fillColor: "#ffffff", bogus: true })).toThrow(/bogus/);
  });

  it("rejects an empty fill color", () => {
    expect(() => module.validate({ degrees: 0, fillColor: "" })).toThrow(/fillColor/);
  });
});
