import { describe, expect, it } from "vitest";
import { cleanMetadataField, multiline, singleLine } from "@shared/text-cleanup";

describe("singleLine", () => {
  it("trims both ends by default", () => {
    expect(singleLine("  hello  ")).toBe("hello");
  });

  it("flattens a line break into one space by default", () => {
    expect(singleLine("a\nb")).toBe("a b");
  });

  it("collapses a mixed break run (blank lines and indentation) to one space", () => {
    expect(singleLine("aaa\n \n\nbbb")).toBe("aaa bbb");
  });

  it("preserves interior horizontal spacing by default", () => {
    expect(singleLine("a    b")).toBe("a    b");
  });

  it("keeps a lone full-width space when there is no line break (default)", () => {
    expect(singleLine("a　b")).toBe("a　b");
  });

  it("leaves line breaks intact when flattenLineBreaks is off", () => {
    expect(singleLine("  a\nb  ", { flattenLineBreaks: false })).toBe("a\nb");
  });

  it("collapses every horizontal whitespace run when minify is on", () => {
    expect(singleLine("a    b", { minify: true })).toBe("a b");
  });

  it("collapses a full-width-space run to one ASCII space when minify is on", () => {
    expect(singleLine("a　　b", { minify: true })).toBe("a b");
  });

  it("collapses a single lone full-width space when minify is on", () => {
    expect(singleLine("a　b", { minify: true })).toBe("a b");
  });

  it("returns empty for all-whitespace input", () => {
    expect(singleLine("\n\n  \n")).toBe("");
    expect(singleLine("　　", { minify: true })).toBe("");
  });
});

describe("multiline", () => {
  it("drops edge blank lines and trailing whitespace while keeping indentation", () => {
    expect(multiline("\n\n  hello  \n\n")).toBe("  hello");
  });

  it("trims trailing whitespace on each line by default", () => {
    expect(multiline("a  \nb  ")).toBe("a\nb");
  });

  it("keeps trailing whitespace when trimLineEnds is off (Markdown hard breaks)", () => {
    expect(multiline("a  \nb  ", { trimLineEnds: false })).toBe("a  \nb  ");
  });

  it("preserves interior blank runs by default", () => {
    expect(multiline("a\n\n\nb")).toBe("a\n\n\nb");
  });

  it("collapses interior blank runs to one when collapseBlankLines is on", () => {
    expect(multiline("a\n\n\nb", { collapseBlankLines: true })).toBe("a\n\nb");
  });

  it("normalizes CRLF and CR to LF", () => {
    expect(multiline("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("treats a whitespace-only line (full-width space) as blank", () => {
    expect(multiline("a\n　\nb")).toBe("a\n\nb");
  });

  it("returns empty for all-blank input", () => {
    expect(multiline("   \n　\n   ")).toBe("");
  });

  it("preserves indentation on visible lines", () => {
    expect(multiline("  indented\n    more")).toBe("  indented\n    more");
  });
});

describe("cleanMetadataField", () => {
  it("single-lines scalar editorial fields, collapsing pasted newlines", () => {
    expect(cleanMetadataField("author", "Jane\nDoe")).toBe("Jane Doe");
    expect(cleanMetadataField("credit", "  Studio  ")).toBe("Studio");
    expect(cleanMetadataField("copyright", "© 2026\nOwner")).toBe("© 2026 Owner");
    expect(cleanMetadataField("source", "Collection\n")).toBe("Collection");
    expect(cleanMetadataField("contactEmail", " a@b.com\n")).toBe("a@b.com");
    expect(cleanMetadataField("contactUrl", "https://x\n")).toBe("https://x");
    expect(cleanMetadataField("webStatement", "https://rights\n")).toBe("https://rights");
  });

  it("preserves interior horizontal spacing in scalar fields (single-line default, not minify)", () => {
    expect(cleanMetadataField("author", "Jane    Doe")).toBe("Jane    Doe");
  });

  it("keeps line structure for the multi-line fields, dropping edge blanks", () => {
    expect(cleanMetadataField("description", "\nLine one\nLine two\n\n")).toBe("Line one\nLine two");
    expect(cleanMetadataField("usageTerms", "  Reuse allowed.  \n\nAttribute the author.  ")).toBe(
      "  Reuse allowed.\n\nAttribute the author.",
    );
  });
});
