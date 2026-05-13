import { describe, expect, it } from "vitest";
import { builtinFilenameTemplate } from "../defaults";
import { assertSafeRenderedFilename, validateFilenameTemplatePattern, validateFilenameTemplates } from "./filename-template";

describe("validateFilenameTemplatePattern", () => {
  it("allows supported placeholders including date timezones", () => {
    expect(validateFilenameTemplatePattern("{slug}-{index:03}-{hash:8}-{date:saved|Asia/Tokyo|yyyymmdd}.{ext}")).toEqual([]);
  });

  it("rejects unsupported placeholders and literal path separators", () => {
    expect(validateFilenameTemplatePattern("{slug}/{camera}.{ext}")).toEqual([
      'contains unsupported placeholder "{camera}".',
      "must not include path separators outside placeholders."
    ]);
  });
});

describe("validateFilenameTemplates", () => {
  it("flags duplicate names and patterns", () => {
    const issues = validateFilenameTemplates([
      builtinFilenameTemplate,
      { id: "a", name: "Blog", pattern: "{slug}.{ext}" },
      { id: "b", name: "Blog", pattern: "{slug}.{ext}" }
    ], "a");

    expect(issues.map((issue) => issue.message)).toContain('Template name duplicates "Blog".');
    expect(issues.map((issue) => issue.message)).toContain('Template pattern duplicates "{slug}.{ext}".');
  });

  it("requires the builtin template to stay intact", () => {
    const issues = validateFilenameTemplates([
      { ...builtinFilenameTemplate, pattern: "{slug}.{ext}" }
    ], builtinFilenameTemplate.id);

    expect(issues.map((issue) => issue.message)).toContain("Built-in template must keep its original name, pattern, and builtin flag.");
  });
});

describe("assertSafeRenderedFilename", () => {
  it("rejects path traversal-like output", () => {
    expect(() => assertSafeRenderedFilename("../bad-name.jpg")).toThrow("contains path separators");
  });
});
