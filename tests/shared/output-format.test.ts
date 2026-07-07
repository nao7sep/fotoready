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
    expect(resolveOutputFormat("original", "heic")).toBe("png");
    expect(resolveOutputFormat("original", "")).toBe("png");
  });
});

describe("normalizeSourceOutputFormat", () => {
  it("returns the format for encodable sources and null otherwise", () => {
    expect(normalizeSourceOutputFormat("webp")).toBe("webp");
    expect(normalizeSourceOutputFormat("tiff")).toBeNull();
  });
});

describe("outputFormatExtension", () => {
  it("maps jpeg to jpg and is identity otherwise", () => {
    expect(outputFormatExtension("jpeg")).toBe("jpg");
    expect(outputFormatExtension("png")).toBe("png");
    expect(outputFormatExtension("webp")).toBe("webp");
    expect(outputFormatExtension("avif")).toBe("avif");
  });
});

describe("formatLabel", () => {
  it("labels known formats and uppercases unknowns", () => {
    expect(formatLabel("original")).toBe("Same as original");
    expect(formatLabel("jpeg")).toBe("JPEG");
    expect(formatLabel("heic")).toBe("HEIC");
  });
});

describe("availableOutputFormats", () => {
  it("lists 'original' first followed by the encoded formats", () => {
    expect(availableOutputFormats()).toEqual(["original", "jpeg", "png", "webp", "avif"]);
  });
});
