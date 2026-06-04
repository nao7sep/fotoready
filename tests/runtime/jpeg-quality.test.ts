import { describe, expect, it, beforeAll } from "vitest";
import sharp from "sharp";
import { detectJpegQuality } from "@runtime/jpeg-quality";

// Encode a small noisy image to JPEG at a known quality so the DQT tables are non-trivial.
// A flat image can collapse to identical quantization tables across qualities, so we use noise.
async function encodeJpeg(quality: number): Promise<Buffer> {
  const width = 64;
  const height = 64;
  const channels = 3;
  const pixels = Buffer.alloc(width * height * channels);
  // Deterministic pseudo-noise (no Math.random — keep the fixture reproducible).
  let seed = 12345;
  for (let i = 0; i < pixels.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = seed % 256;
  }
  return sharp(pixels, { raw: { width, height, channels } }).jpeg({ quality }).toBuffer();
}

describe("detectJpegQuality", () => {
  let q90: Buffer;
  let q75: Buffer;
  let q50: Buffer;

  beforeAll(async () => {
    [q90, q75, q50] = await Promise.all([encodeJpeg(90), encodeJpeg(75), encodeJpeg(50)]);
  });

  it("estimates a quality close to the encode quality", () => {
    // The DQT-based estimate is approximate; allow a tolerance band.
    expect(detectJpegQuality(q90).jpegQualityEstimate?.value).toBeGreaterThanOrEqual(85);
    expect(detectJpegQuality(q75).jpegQualityEstimate?.value).toBeGreaterThanOrEqual(70);
    expect(detectJpegQuality(q75).jpegQualityEstimate?.value).toBeLessThanOrEqual(80);
    expect(detectJpegQuality(q50).jpegQualityEstimate?.value).toBeGreaterThanOrEqual(45);
    expect(detectJpegQuality(q50).jpegQualityEstimate?.value).toBeLessThanOrEqual(55);
  });

  it("orders estimates monotonically with encode quality", () => {
    const e90 = detectJpegQuality(q90).jpegQualityEstimate!.value;
    const e75 = detectJpegQuality(q75).jpegQualityEstimate!.value;
    const e50 = detectJpegQuality(q50).jpegQualityEstimate!.value;
    expect(e90).toBeGreaterThan(e75);
    expect(e75).toBeGreaterThan(e50);
  });

  it("tags the estimate method", () => {
    expect(detectJpegQuality(q75).jpegQualityEstimate?.method).toBe("dqt-estimate");
  });

  it("returns null when there are no DQT tables (not a JPEG)", () => {
    expect(detectJpegQuality(Buffer.from([0x00, 0x01, 0x02, 0x03])).jpegQualityEstimate).toBeNull();
    expect(detectJpegQuality(Buffer.alloc(0)).jpegQualityEstimate).toBeNull();
  });

  it("returns null for a truncated JPEG header with no quantization segment", () => {
    // SOI marker only.
    expect(detectJpegQuality(Buffer.from([0xff, 0xd8])).jpegQualityEstimate).toBeNull();
  });
});
