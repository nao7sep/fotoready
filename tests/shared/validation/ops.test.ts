import { describe, expect, it } from "vitest";
import {
  applyOpParamChange,
  applyOpParamPatch,
  validateOpInstance,
  type OpValidator,
  type OpValidatorLookup
} from "@shared/validation/ops";

// A fake registry: one op "resize" with width/height params, validated independently of
// the real op modules so this stays a pure unit test.
const resizeValidator: OpValidator = {
  defaultParams: { width: 1024, height: 768 },
  validate(params) {
    const record = (params ?? {}) as Record<string, unknown>;
    const width = Number(record.width ?? 1024);
    const height = Number(record.height ?? 768);
    if (!Number.isInteger(width) || width < 1) throw new Error("resize.params.width must be a positive integer.");
    if (!Number.isInteger(height) || height < 1) throw new Error("resize.params.height must be a positive integer.");
    return { width, height };
  }
};

const lookup: OpValidatorLookup = (type) => (type === "resize" ? resizeValidator : undefined);

describe("validateOpInstance", () => {
  it("returns a normalized op instance for valid input", () => {
    const op = validateOpInstance(
      { id: "op-1", type: "resize", enabled: true, params: { width: 800, height: 600 } },
      lookup
    );
    expect(op).toEqual({ id: "op-1", type: "resize", enabled: true, params: { width: 800, height: 600 } });
  });

  it("rejects an unregistered op type", () => {
    expect(() =>
      validateOpInstance({ id: "x", type: "nope", enabled: true, params: {} }, lookup)
    ).toThrow(/must reference a registered op.*nope/i);
  });

  it("requires id, type, and enabled", () => {
    expect(() => validateOpInstance({ type: "resize", enabled: true, params: {} }, lookup)).toThrow(/id/);
    expect(() => validateOpInstance({ id: "x", type: "", enabled: true, params: {} }, lookup)).toThrow(/type/);
    expect(() => validateOpInstance({ id: "x", type: "resize", enabled: "yes", params: {} }, lookup)).toThrow(/enabled/);
  });

  it("delegates param validation to the op validator", () => {
    expect(() =>
      validateOpInstance({ id: "x", type: "resize", enabled: true, params: { width: -1, height: 600 } }, lookup)
    ).toThrow(/width/);
  });

  it("rejects a non-object", () => {
    expect(() => validateOpInstance(null, lookup)).toThrow(/op must be an object/);
  });
});

describe("applyOpParamChange", () => {
  const op = { id: "op-1", type: "resize", enabled: true, params: { width: 800, height: 600 } };

  it("applies and re-validates a known param", () => {
    expect(applyOpParamChange(op, "width", 1200, lookup).params.width).toBe(1200);
  });

  it("rejects an unknown param key", () => {
    expect(() => applyOpParamChange(op, "depth", 1, lookup)).toThrow(/Unknown resize param "depth"/);
  });

  it("rejects an invalid new value", () => {
    expect(() => applyOpParamChange(op, "width", 0, lookup)).toThrow(/width/);
  });

  it("rejects an unknown op type", () => {
    expect(() => applyOpParamChange({ ...op, type: "ghost" }, "width", 1, lookup)).toThrow(/Unknown op type "ghost"/);
  });
});

describe("applyOpParamPatch", () => {
  const op = { id: "op-1", type: "resize", enabled: true, params: { width: 800, height: 600 } };

  it("merges a patch and re-validates", () => {
    const patched = applyOpParamPatch(op, { width: 640, height: 480 }, lookup);
    expect(patched.params).toEqual({ width: 640, height: 480 });
  });

  it("rejects a patch that violates validation", () => {
    expect(() => applyOpParamPatch(op, { height: -5 }, lookup)).toThrow(/height/);
  });
});
