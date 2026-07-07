import { describe, expect, it } from "vitest";
import { normalizeSlugCandidate } from "@core/slug/rules";

describe("normalizeSlugCandidate", () => {
  it("lowercases and replaces runs of non-alphanumerics with a single hyphen", () => {
    expect(normalizeSlugCandidate("Hello World")).toBe("hello-world");
    expect(normalizeSlugCandidate("Foo   Bar___Baz")).toBe("foo-bar-baz");
    expect(normalizeSlugCandidate("a.b.c")).toBe("a-b-c");
  });

  it("trims leading and trailing hyphens", () => {
    expect(normalizeSlugCandidate("  spaced  ")).toBe("spaced");
    expect(normalizeSlugCandidate("--edge--")).toBe("edge");
    expect(normalizeSlugCandidate("!leading and trailing!")).toBe("leading-and-trailing");
  });

  it("collapses consecutive separators", () => {
    expect(normalizeSlugCandidate("a---b")).toBe("a-b");
  });

  it("drops non-ASCII characters", () => {
    expect(normalizeSlugCandidate("café déjà")).toBe("caf-d-j");
  });

  it("returns an empty string when nothing survives", () => {
    expect(normalizeSlugCandidate("!!!")).toBe("");
    expect(normalizeSlugCandidate("   ")).toBe("");
    expect(normalizeSlugCandidate("")).toBe("");
  });

  it("keeps digits", () => {
    expect(normalizeSlugCandidate("Photo 2026 v2")).toBe("photo-2026-v2");
  });
});
