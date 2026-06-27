import { describe, expect, it } from "vitest";
import "@core/ops/catalog"; // side-effect: registers every op module
import { listOpModules, requireOpModule } from "@core/ops/registry";

const modules = listOpModules();

function paramsFor(type: string): Record<string, unknown> {
  return structuredClone(requireOpModule(type).defaultParams) as Record<string, unknown>;
}

describe("op validate() — every registered op", () => {
  it("registers the full catalog", () => {
    // Guards against a module dropping out of the catalog's side-effect imports.
    expect(modules.length).toBe(20);
  });

  for (const module of modules) {
    describe(module.type, () => {
      it("accepts its own defaultParams and normalizes idempotently", () => {
        const once = module.validate(structuredClone(module.defaultParams));
        // A validator may normalize (e.g. strip-metadata folds aliases); the
        // second pass must be a fixed point, and the defaults must survive it.
        expect(module.validate(structuredClone(once))).toEqual(once);
      });

      it("rejects a non-object params value", () => {
        expect(() => module.validate(null)).toThrow();
        expect(() => module.validate(42)).toThrow();
      });

      it("rejects an unrecognized param key", () => {
        expect(() => module.validate({ ...module.defaultParams, __nope: 1 })).toThrow();
      });
    });
  }
});

describe("crop bounds", () => {
  it("rejects zero width/height (must be > 0) but accepts a zero position", () => {
    const crop = requireOpModule("crop");
    expect(() => crop.validate({ ...paramsFor("crop"), w: 0 })).toThrow();
    expect(() => crop.validate({ ...paramsFor("crop"), h: 0 })).toThrow();
    expect(() => crop.validate({ ...paramsFor("crop"), x: 0, y: 0 })).not.toThrow();
  });

  it("rejects positions and sizes outside the 0..1 fraction range", () => {
    const crop = requireOpModule("crop");
    expect(() => crop.validate({ ...paramsFor("crop"), x: -0.01 })).toThrow();
    expect(() => crop.validate({ ...paramsFor("crop"), w: 1.01 })).toThrow();
    expect(() => crop.validate({ ...paramsFor("crop"), x: 1, w: 1 })).not.toThrow();
  });
});

describe("resize bounds", () => {
  it("treats width/height as integer pixels with an inclusive floor of 1", () => {
    const resize = requireOpModule("resize");
    expect(() => resize.validate({ ...paramsFor("resize"), width: 0 })).toThrow();
    expect(() => resize.validate({ ...paramsFor("resize"), width: 1.5 })).toThrow();
    expect(() => resize.validate({ ...paramsFor("resize"), width: 1 })).not.toThrow();
  });
});

describe("proportional width/height ops are consistent: 0 is rejected everywhere", () => {
  // crop/watermark-text use w/h; watermark-image/stamp use width/height — all
  // proportional (0..1) and all minExclusive, unlike resize's absolute pixels.
  const cases: Array<{ type: string; keys: [string, string] }> = [
    { type: "crop", keys: ["w", "h"] },
    { type: "watermark-text", keys: ["w", "h"] },
    { type: "watermark-image", keys: ["width", "height"] },
    { type: "stamp", keys: ["width", "height"] }
  ];
  for (const { type, keys } of cases) {
    it(`${type} rejects a zero ${keys.join("/")}`, () => {
      const op = requireOpModule(type);
      expect(() => op.validate({ ...paramsFor(type), [keys[0]]: 0 })).toThrow();
      expect(() => op.validate({ ...paramsFor(type), [keys[1]]: 0 })).toThrow();
    });
  }
});

describe("levels cross-field rule", () => {
  it("requires whitePoint > blackPoint", () => {
    const levels = requireOpModule("levels");
    expect(() => levels.validate({ ...paramsFor("levels"), blackPoint: 200, whitePoint: 100 })).toThrow();
    expect(() => levels.validate({ ...paramsFor("levels"), blackPoint: 10, whitePoint: 200 })).not.toThrow();
  });
});
