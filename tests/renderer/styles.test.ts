import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/renderer/styles/app.css"), "utf8");
const compact = css.replace(/\s+/g, "");

// A mouse press matches :hover and :active at once, so a pressed rule only paints
// if it beats the hover rule for the same button; a keyboard press matches only
// :active, so a role with no pressed rule of its own falls through to a more
// general one. The toolbar/icon/inline rule was a rung short of its own hover
// rule and painted nothing under the pointer, while the destructive confirm,
// having no pressed rule at all, took the teal accent on a keyboard press.
// Deriving the pressed selector from the hover selector asserts both halves at
// once: the same shape means the same specificity, and a later position breaks
// the tie. Asserting merely that some :active rule exists passes while the
// pressed fill is unreachable, which is how this shipped.
const PRESSABLE_ROLES = [
  ":is(.toolbar-button,.icon-button,.inline-action):hover:not(:disabled):not(.active)",
  ".primary-action:hover:not(:disabled)",
  ".primary-action.danger:hover:not(:disabled)",
  ".inline-action.danger:hover:not(:disabled)",
];

describe("button pressed states", () => {
  it("gives every filled button role a pressed rule that beats its own hover rule", () => {
    for (const hover of PRESSABLE_ROLES) {
      const pressed = hover.replace(":hover", ":active");
      const hoverAt = compact.indexOf(`${hover}{`);
      const pressedAt = compact.indexOf(pressed);
      expect(hoverAt, `${hover} must exist`).toBeGreaterThanOrEqual(0);
      expect(pressedAt, `${pressed} must exist and follow its hover rule`).toBeGreaterThan(hoverAt);
    }
  });
});

// Truncation is an audited exception: each site draws one marker and has a click-and-keyboard path to
// the complete value, so a new truncation or a marker-less clip has to come through this list rather
// than appear unreviewed.
describe("truncation", () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim().replace(/\s+/g, " "),
    declarations: Object.fromEntries(
      match[2]!.split(";").filter((declaration) => declaration.includes(":")).map((declaration) => {
        const [property, ...value] = declaration.split(":");
        return [property!.trim(), value.join(":").trim()];
      })
    ) as Record<string, string>
  }));

  it("shortens only identifying text", () => {
    // Selects, menu items under their cap, the status label, the badge's path, list rows, the preview
    // toolbar, an op card's asset name, picker tiles and Records rows and headers name their item;
    // text read whole is never in this list.
    expect(rules.filter((rule) => rule.declarations["text-overflow"] === "ellipsis").map((rule) => rule.selector))
      .toEqual([
        "select", ".status-active-label", ".app-menu button", ".path-head, .path-tail",
        ".list-row .row-title, .list-row .row-detail", ".preview-name, .preview-facts", ".pipeline-op-card .op-card-header .op-card-title", ".asset-source-value",
        ".records-row-title", ".records-detail-title"
      ]);
    expect(rules.filter((rule) => "-webkit-line-clamp" in rule.declarations).map((rule) => rule.selector))
      .toEqual([".asset-picker-name", ".records-row-text"]);
  });

  it("wraps text that is read whole inside a height limit that scrolls", () => {
    for (const selector of [".vision-description", ".pipeline-op-card .operation-result-content", ".error-strip span", ".asset-file-name-list"]) {
      const rule = rules.find((candidate) => candidate.selector === selector);
      expect(rule?.declarations["max-height"], selector).toBeDefined();
      expect(rule?.declarations["overflow-y"], selector).toBe("auto");
    }
    expect(rules.find((rule) => rule.selector === ".modal-message")?.declarations["overflow-wrap"]).toBe("anywhere");
  });

  it("never clips a line without a marker", () => {
    const clipped = rules.filter(({ declarations }) =>
      declarations["white-space"] === "nowrap"
      && ["hidden", "clip"].includes(declarations.overflow ?? declarations["overflow-x"] ?? "")
      && declarations["text-overflow"] !== "ellipsis");
    // The screen-reader-only utility hides its text from sight on purpose.
    expect(clipped.map((rule) => rule.selector)).toEqual([".sr-only"]);
  });
});
