import { describe, expect, it } from "vitest";
import { assertSafeRenderedFilename } from "@shared/validation/filename-template";

describe("assertSafeRenderedFilename", () => {
  it("accepts ordinary rendered filenames", () => {
    expect(() => assertSafeRenderedFilename("photo-1024x768.jpg")).not.toThrow();
    expect(() => assertSafeRenderedFilename("my.slug.with.dots.webp")).not.toThrow();
  });

  it("rejects empty names", () => {
    expect(() => assertSafeRenderedFilename("")).toThrow(/empty/i);
  });

  it("rejects dot and dot-dot", () => {
    expect(() => assertSafeRenderedFilename(".")).toThrow(/not allowed/i);
    expect(() => assertSafeRenderedFilename("..")).toThrow(/not allowed/i);
  });

  it("rejects path separators (traversal guard)", () => {
    expect(() => assertSafeRenderedFilename("a/b.jpg")).toThrow(/path separator/i);
    expect(() => assertSafeRenderedFilename("a\\b.jpg")).toThrow(/path separator/i);
    expect(() => assertSafeRenderedFilename("../escape.jpg")).toThrow(/path separator/i);
  });

  it("rejects embedded null bytes", () => {
    expect(() => assertSafeRenderedFilename("evil\0.jpg")).toThrow(/null byte/i);
  });
});
