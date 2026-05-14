import { describe, expect, it } from "vitest";
import "./catalog";
import { requireOpModule } from "./registry";

describe("crop op", () => {
  const module = requireOpModule("crop");

  it("registers with show-input previewBehavior so its overlay lines up with the base image", () => {
    expect(module.previewBehavior).toBe("show-input");
    expect(module.defaultParams).toEqual({ x: 0, y: 0, w: 1, h: 1, aspectLock: null });
  });

  it("accepts null, a numeric ratio, or a string label as aspectLock", () => {
    expect(module.validate({ x: 0, y: 0, w: 0.5, h: 0.5, aspectLock: null })).toMatchObject({ aspectLock: null });
    expect(module.validate({ x: 0, y: 0, w: 0.5, h: 0.5, aspectLock: 1.5 })).toMatchObject({ aspectLock: 1.5 });
    expect(module.validate({ x: 0, y: 0, w: 0.5, h: 0.5, aspectLock: "16:9" })).toMatchObject({ aspectLock: "16:9" });
  });

  it("rejects a zero-size or out-of-range rect", () => {
    expect(() => module.validate({ x: 0, y: 0, w: 0, h: 1, aspectLock: null })).toThrow(/w/);
    expect(() => module.validate({ x: 1.5, y: 0, w: 0.5, h: 0.5, aspectLock: null })).toThrow(/x/);
  });

  it("rejects an empty string aspectLock", () => {
    expect(() => module.validate({ x: 0, y: 0, w: 0.5, h: 0.5, aspectLock: "" })).toThrow(/aspectLock/);
  });
});
