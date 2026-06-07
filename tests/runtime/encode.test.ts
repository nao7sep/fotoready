import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { applyOutputEncoding } from "@runtime/encode";
import type { OutputSettings } from "@shared/types/pipeline";

function makeImage(): sharp.Sharp {
  // A tiny opaque RGBA frame is enough to exercise the encoder configuration path.
  return sharp(Buffer.alloc(2 * 2 * 4, 200), { raw: { width: 2, height: 2, channels: 4 } });
}

function output(overrides: Partial<OutputSettings>): OutputSettings {
  return {
    format: "jpeg",
    quality: 80,
    flattenTransparency: false,
    jpegProgressive: false,
    jpegChromaSubsampling: "4:2:0",
    webpMethod: 4,
    avifEffort: 4,
    pngPalette: false,
    backgroundForTransparency: "#ffffff",
    ...overrides
  };
}

describe("applyOutputEncoding", () => {
  it("halts when the format has not been resolved", () => {
    expect(() => applyOutputEncoding(makeImage(), output({ format: "original" })))
      .toThrow(/format must be resolved/i);
  });

  it("halts when quality is still 'auto' for a lossy format instead of silently defaulting", () => {
    for (const format of ["jpeg", "webp", "avif"] as const) {
      expect(() => applyOutputEncoding(makeImage(), output({ format, quality: "auto" })))
        .toThrow(/quality must be resolved/i);
    }
  });

  it("halts on a non-finite numeric quality (NaN) instead of passing it to the encoder", () => {
    // NaN is typeof "number", so a plain type check would let it through to sharp.
    expect(() => applyOutputEncoding(makeImage(), output({ format: "jpeg", quality: NaN })))
      .toThrow(/quality must be resolved/i);
  });

  it("encodes when format and quality are both resolved", async () => {
    const encoded = await applyOutputEncoding(makeImage(), output({ format: "jpeg", quality: 90 })).toBuffer();
    expect(encoded.byteLength).toBeGreaterThan(0);
  });

  it("ignores quality for png, so an unresolved value does not block a lossless encode", async () => {
    const encoded = await applyOutputEncoding(makeImage(), output({ format: "png", quality: "auto" })).toBuffer();
    expect(encoded.byteLength).toBeGreaterThan(0);
  });
});
