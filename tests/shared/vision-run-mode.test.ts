import { describe, expect, it } from "vitest";
import {
  includesDescriptionGeneration,
  includesSlugGeneration,
  resolveSlugRegenerationMode,
  resolveVisionRunMode
} from "@shared/vision-run-mode";

describe("resolveVisionRunMode", () => {
  it("honors an explicit mode over the task flags", () => {
    expect(resolveVisionRunMode({ generateDescription: false, generateSlug: false }, { mode: "slug" })).toBe("slug");
  });

  it("maps slug to description-and-slug, description to description, neither to null", () => {
    expect(resolveVisionRunMode({ generateDescription: true, generateSlug: true })).toBe("description-and-slug");
    expect(resolveVisionRunMode({ generateDescription: true, generateSlug: false })).toBe("description");
    expect(resolveVisionRunMode({ generateDescription: false, generateSlug: false })).toBeNull();
  });
});

describe("includes* predicates", () => {
  it("classifies which sub-generations each mode runs", () => {
    expect(includesDescriptionGeneration("description")).toBe(true);
    expect(includesDescriptionGeneration("description-and-slug")).toBe(true);
    expect(includesDescriptionGeneration("slug")).toBe(false);
    expect(includesSlugGeneration("slug")).toBe(true);
    expect(includesSlugGeneration("description-and-slug")).toBe(true);
    expect(includesSlugGeneration("description")).toBe(false);
  });
});

describe("resolveSlugRegenerationMode", () => {
  it("regenerates the slug alone when a non-blank description already exists", () => {
    expect(resolveSlugRegenerationMode("a sunset over the bay")).toBe("slug");
  });

  it("regenerates both when the description is missing or blank", () => {
    expect(resolveSlugRegenerationMode(null)).toBe("description-and-slug");
    expect(resolveSlugRegenerationMode(undefined)).toBe("description-and-slug");
    expect(resolveSlugRegenerationMode("")).toBe("description-and-slug");
    expect(resolveSlugRegenerationMode("   ")).toBe("description-and-slug");
  });
});
