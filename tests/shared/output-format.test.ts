import { describe, expect, it } from "vitest";
import {
  availableOutputFormats,
  formatLabel,
  normalizeSourceOutputFormat,
  outputFormatExtension,
  resolveOutputFormat
} from "@shared/output-format";

describe("resolveOutputFormat", () => {
  it("passes through an explicit encoded format", () => {
    expect(resolveOutputFormat("jpeg", "png")).toBe("jpeg");
    expect(resolveOutputFormat("webp", "jpeg")).toBe("webp");
  });

  it("adopts a recognized source format when set to 'original'", () => {
    expect(resolveOutputFormat("original", "jpeg")).toBe("jpeg");
    expect(resolveOutputFormat("original", "avif")).toBe("avif");
  });

  it("falls back to png for unrecognized source formats", () => {
    // heic stays here on purpose: this sharp build has no HEVC encoder, so heic can be
    // read and never written. png is the honest lossless landing place for it.
    expect(resolveOutputFormat("original", "heic")).toBe("png");
    expect(resolveOutputFormat("original", "")).toBe("png");
  });

  it("keeps a tiff source as tiff — the whole point of the format existing here", () => {
    expect(resolveOutputFormat("original", "tiff")).toBe("tiff");
  });
});

describe("normalizeSourceOutputFormat", () => {
  it("returns the format for encodable sources and null otherwise", () => {
    expect(normalizeSourceOutputFormat("webp")).toBe("webp");
    // TIFF is encodable now. This asserted null before, which was accurate and was the
    // bug: a .tif import with "Same as original" resolved to null and fell through to
    // png, so a scan silently came back as a PNG.
    expect(normalizeSourceOutputFormat("tiff")).toBe("tiff");
    expect(normalizeSourceOutputFormat("heic")).toBeNull();
  });
});

describe("outputFormatExtension", () => {
  it("normalizes the long spellings and is identity otherwise", () => {
    expect(outputFormatExtension("jpeg")).toBe("jpg");
    expect(outputFormatExtension("tiff")).toBe("tif");
    expect(outputFormatExtension("png")).toBe("png");
    expect(outputFormatExtension("webp")).toBe("webp");
    expect(outputFormatExtension("avif")).toBe("avif");
  });
});

describe("formatLabel", () => {
  it("labels known formats and uppercases unknowns", () => {
    expect(formatLabel("original")).toBe("Same as original");
    expect(formatLabel("jpeg")).toBe("JPEG");
    expect(formatLabel("tiff")).toBe("TIFF");
    expect(formatLabel("heic")).toBe("HEIC");
  });
});

describe("availableOutputFormats", () => {
  it("lists 'original' first followed by the encoded formats", () => {
    expect(availableOutputFormats()).toEqual(["original", "jpeg", "png", "webp", "avif", "tiff"]);
  });
});
