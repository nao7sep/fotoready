import { describe, expect, it } from "vitest";
import { applyOutputSettingChange, validateOutputSettings } from "@shared/validation/pipeline";
import { defaultOutputSettings } from "@shared/defaults";

const valid = defaultOutputSettings();

describe("validateOutputSettings", () => {
  it("returns a normalized copy for valid input", () => {
    expect(validateOutputSettings(valid)).toEqual(valid);
  });

  it("accepts both 'auto' and a numeric quality", () => {
    expect(validateOutputSettings({ ...valid, quality: "auto" }).quality).toBe("auto");
    expect(validateOutputSettings({ ...valid, quality: 80 }).quality).toBe(80);
  });

  it("rejects an unknown quality keyword", () => {
    expect(() => validateOutputSettings({ ...valid, quality: "high" })).toThrow(/quality/);
  });

  it("rejects an out-of-range numeric quality", () => {
    expect(() => validateOutputSettings({ ...valid, quality: 0 })).toThrow(/at least 1/);
    expect(() => validateOutputSettings({ ...valid, quality: 101 })).toThrow(/at most 100/);
  });

  it("rejects an unknown format", () => {
    expect(() => validateOutputSettings({ ...valid, format: "bmp" })).toThrow(/format/);
  });

  it("defaults flattenTransparency to false when omitted", () => {
    const { flattenTransparency, ...rest } = valid;
    void flattenTransparency;
    expect(validateOutputSettings(rest).flattenTransparency).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(() => validateOutputSettings(null)).toThrow(/output must be an object/);
  });

  it("enforces webpMethod and avifEffort ranges", () => {
    expect(() => validateOutputSettings({ ...valid, webpMethod: 7 })).toThrow(/webpMethod/);
    expect(() => validateOutputSettings({ ...valid, avifEffort: 10 })).toThrow(/avifEffort/);
  });
});

describe("applyOutputSettingChange", () => {
  it("applies a valid change", () => {
    expect(applyOutputSettingChange(valid, "format", "jpeg").format).toBe("jpeg");
  });

  it("rejects an unknown setting key", () => {
    expect(() => applyOutputSettingChange(valid, "bogus", 1)).toThrow(/Unknown output setting "bogus"/);
  });

  it("re-validates the changed value", () => {
    expect(() => applyOutputSettingChange(valid, "quality", 0)).toThrow(/quality/);
  });
});
