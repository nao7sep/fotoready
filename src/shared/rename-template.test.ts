import { describe, expect, it } from "vitest";
import {
  BUILTIN_RENAME_TEMPLATE_IDS,
  DEFAULT_RENAME_TEMPLATE_ID,
  builtinRenameTemplates,
  findRenameTemplate,
  renameTemplateUsesOriginal,
  renameTemplateUsesSlug,
  renderRenameTemplate
} from "@shared/rename-template";

const input = { slug: "sunset-pier", original: "DSC_0001", w: 1024, h: 768, ext: "jpg" };

describe("findRenameTemplate", () => {
  it("returns the matching builtin template", () => {
    const template = findRenameTemplate(BUILTIN_RENAME_TEMPLATE_IDS.slug);
    expect(template.id).toBe(BUILTIN_RENAME_TEMPLATE_IDS.slug);
  });

  it("falls back to the first template for unknown or missing ids", () => {
    expect(findRenameTemplate("does-not-exist").id).toBe(builtinRenameTemplates[0].id);
    expect(findRenameTemplate(undefined).id).toBe(builtinRenameTemplates[0].id);
  });

  it("uses slug + size as the default", () => {
    expect(DEFAULT_RENAME_TEMPLATE_ID).toBe(BUILTIN_RENAME_TEMPLATE_IDS.slugSize);
  });
});

describe("renameTemplateUsesSlug / renameTemplateUsesOriginal", () => {
  it("classifies each builtin template by base", () => {
    for (const template of builtinRenameTemplates) {
      const isSlug = template.base === "slug";
      expect(renameTemplateUsesSlug(template)).toBe(isSlug);
      expect(renameTemplateUsesOriginal(template)).toBe(!isSlug);
    }
  });
});

describe("renderRenameTemplate", () => {
  it("slug + size", () => {
    const template = findRenameTemplate(BUILTIN_RENAME_TEMPLATE_IDS.slugSize);
    expect(renderRenameTemplate(template, input)).toBe("sunset-pier-1024x768.jpg");
  });

  it("slug only", () => {
    const template = findRenameTemplate(BUILTIN_RENAME_TEMPLATE_IDS.slug);
    expect(renderRenameTemplate(template, input)).toBe("sunset-pier.jpg");
  });

  it("original + size", () => {
    const template = findRenameTemplate(BUILTIN_RENAME_TEMPLATE_IDS.originalSize);
    expect(renderRenameTemplate(template, input)).toBe("DSC_0001-1024x768.jpg");
  });

  it("original only", () => {
    const template = findRenameTemplate(BUILTIN_RENAME_TEMPLATE_IDS.original);
    expect(renderRenameTemplate(template, input)).toBe("DSC_0001.jpg");
  });
});
