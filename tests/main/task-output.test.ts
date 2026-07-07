import { describe, expect, it } from "vitest";
import {
  defaultQualityForFormat,
  defaultTaskOutput,
  imageBoundsForOriginal,
  initializeOpParamsForOriginal,
  nextTaskOutput,
  type TaskOutput
} from "@main/task-output";
import { defaultGlobalSettings, defaultOutputSettings } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";
import type { Original } from "@shared/types/project";

function settings(over: Partial<GlobalSettings> = {}): GlobalSettings {
  return { ...defaultGlobalSettings(null), ...over };
}

function output(over: Partial<TaskOutput> = {}): TaskOutput {
  return { ...defaultOutputSettings(), ...over };
}

function original(over: Partial<Original> = {}): Original {
  return {
    id: "o1",
    sourcePath: "/img.jpg",
    sourceHash: "h",
    size: 1,
    format: "jpeg",
    jpegQualityEstimate: null,
    metadataSummary: { editorial: {}, dates: {}, gps: {} },
    width: 1000,
    height: 1000,
    addedAt: "2026-01-01T00:00:00.000Z",
    ...over
  };
}

describe("defaultQualityForFormat", () => {
  it("uses the configured webp/avif qualities", () => {
    expect(defaultQualityForFormat("webp", settings(), "jpeg", "auto")).toBe(82);
    expect(defaultQualityForFormat("avif", settings(), "jpeg", "auto")).toBe(60);
  });

  it("keeps a numeric png fallback but defaults a non-numeric one to 82", () => {
    expect(defaultQualityForFormat("png", settings(), "jpeg", 70)).toBe(70);
    expect(defaultQualityForFormat("png", settings(), "jpeg", "auto")).toBe(82);
  });

  it("returns auto for jpeg only when estimation is on, mode is auto, and the source is jpeg", () => {
    expect(defaultQualityForFormat("jpeg", settings(), "jpeg", "auto")).toBe("auto");
  });

  it("falls back to the fixed jpeg quality when the source is not jpeg", () => {
    expect(defaultQualityForFormat("jpeg", settings(), "png", "auto")).toBe(85);
  });

  it("falls back to the fixed jpeg quality when estimation is disabled", () => {
    expect(defaultQualityForFormat("jpeg", settings({ enableJpegQualityEstimate: false }), "jpeg", "auto")).toBe(85);
  });

  it("resolves an 'original' format through the source format", () => {
    // original + webp source resolves to webp.
    expect(defaultQualityForFormat("original", settings(), "webp", "auto")).toBe(82);
  });
});

describe("defaultTaskOutput", () => {
  it("applies the configured output defaults and the resolved quality", () => {
    const result = defaultTaskOutput(settings(), "jpeg", defaultOutputSettings());
    expect(result.format).toBe("original"); // settings.defaultOutputFormat
    expect(result.quality).toBe("auto"); // original->jpeg, estimate auto
    expect(result.flattenTransparency).toBe(false);
    expect(result.jpegProgressive).toBe(true);
  });

  it("derives quality from an explicit default output format", () => {
    const result = defaultTaskOutput(settings({ defaultOutputFormat: "webp" }), "jpeg", defaultOutputSettings());
    expect(result.format).toBe("webp");
    expect(result.quality).toBe(82);
  });
});

describe("nextTaskOutput", () => {
  it("changing format to jpeg forces flattenTransparency and recomputes quality", () => {
    const result = nextTaskOutput(output({ format: "png", flattenTransparency: false }), "format", "jpeg", settings(), "jpeg");
    expect(result.format).toBe("jpeg");
    expect(result.flattenTransparency).toBe(true);
    expect(result.quality).toBe("auto");
  });

  it("changing format to webp recomputes quality and leaves flatten alone", () => {
    const result = nextTaskOutput(output({ format: "jpeg", flattenTransparency: false }), "format", "webp", settings(), "jpeg");
    expect(result.format).toBe("webp");
    expect(result.quality).toBe(82);
    expect(result.flattenTransparency).toBe(false);
  });

  it("preserves a user-set numeric quality on a jpeg output", () => {
    const result = nextTaskOutput(output({ format: "jpeg", quality: 90 }), "quality", 75, settings(), "jpeg");
    expect(result.quality).toBe(75);
  });

  it("coerces quality:auto back to a fixed value when the source is not jpeg", () => {
    // auto is only meaningful when the source is jpeg; otherwise it is replaced.
    const result = nextTaskOutput(output({ format: "jpeg", quality: 80 }), "quality", "auto", settings(), "png");
    expect(result.quality).toBe(85);
  });

  it("keeps quality unchanged when toggling an unrelated jpeg setting", () => {
    const result = nextTaskOutput(output({ format: "jpeg", quality: 90 }), "jpegProgressive", false, settings(), "jpeg");
    expect(result.quality).toBe(90);
    expect(result.flattenTransparency).toBe(true);
  });
});

describe("imageBoundsForOriginal", () => {
  it("normalizes against the long edge", () => {
    expect(imageBoundsForOriginal(original({ width: 2000, height: 1000 }))).toEqual({ maxX: 1, maxY: 0.5 });
  });

  it("guards against a zero long edge", () => {
    expect(imageBoundsForOriginal(original({ width: 0, height: 0 }))).toEqual({ maxX: 0, maxY: 0 });
  });
});

describe("initializeOpParamsForOriginal (watermark-text branch, no I/O)", () => {
  it("clamps a watermark-text box into the image bounds in place", async () => {
    const params: Record<string, unknown> = { x: 0.62, y: 0.84, w: 0.22, h: 0.08 };
    await initializeOpParamsForOriginal("watermark-text", params, original({ width: 2000, height: 1000 }));
    // Wide image: maxY = 0.5, so y is clamped down to 0.5 - 0.08 = 0.42.
    expect(params.y).toBe(0.42);
    expect(params.x).toBe(0.62);
    expect(params.h).toBe(0.08);
  });

  it("leaves params untouched when the watermark-text box is not fully numeric", async () => {
    const params: Record<string, unknown> = { x: 0.5, y: 0.5, w: 0.2 };
    await initializeOpParamsForOriginal("watermark-text", params, original());
    expect(params).toEqual({ x: 0.5, y: 0.5, w: 0.2 });
  });

  it("is a no-op for ops without position params", async () => {
    const params: Record<string, unknown> = { radius: 20 };
    await initializeOpParamsForOriginal("blur", params, original());
    expect(params).toEqual({ radius: 20 });
  });
});
