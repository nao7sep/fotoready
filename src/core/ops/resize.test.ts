import { describe, expect, it } from "vitest";
import "./catalog";
import { requireOpModule } from "./registry";

describe("resize op", () => {
  const module = requireOpModule("resize");

  it("registers with the expected metadata", () => {
    expect(module.label).toBe("Resize");
    expect(module.previewBehavior).toBe("show-output");
    expect(module.defaultParams.mode).toBe("long-edge");
  });

  it("accepts each supported mode", () => {
    for (const mode of ["fit", "fill", "width", "height", "long-edge", "short-edge"] as const) {
      expect(module.validate({ mode, value: 1024, interpolation: "lanczos3" })).toMatchObject({ mode });
    }
  });

  it("rejects an unknown mode", () => {
    expect(() => module.validate({ mode: "bizarre", value: 1024, interpolation: "lanczos3" })).toThrow(/mode/);
  });

  it("requires a positive integer value", () => {
    expect(() => module.validate({ mode: "long-edge", value: 0, interpolation: "lanczos3" })).toThrow(/value/);
    expect(() => module.validate({ mode: "long-edge", value: 1024.5, interpolation: "lanczos3" })).toThrow(/value/);
  });
});
