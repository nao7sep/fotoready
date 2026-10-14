import { describe, expect, it } from "vitest";
import { sourceToChooseFirst } from "@renderer/ops/add-op-source";

describe("adding a step that needs a file", () => {
  it("chooses the LUT, the stamp or the image before the step exists", () => {
    expect(sourceToChooseFirst("lut", "")).toBe("lut");
    expect(sourceToChooseFirst("stamp", "")).toBe("stamp");
    expect(sourceToChooseFirst("watermark-image", "")).toBe("image-file");
    expect(sourceToChooseFirst("watermark-image", "  ")).toBe("image-file");
  });

  it("adds an image watermark straight from the default image, and every other step at once", () => {
    expect(sourceToChooseFirst("watermark-image", "~/marks/logo.png")).toBeNull();
    expect(sourceToChooseFirst("watermark-text", "")).toBeNull();
    expect(sourceToChooseFirst("crop", "")).toBeNull();
  });
});
