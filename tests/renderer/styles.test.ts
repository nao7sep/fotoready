import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/renderer/styles/app.css"), "utf8");
const compact = css.replace(/\s+/g, "");

describe("renderer scrollbar contract", () => {
  it("keeps a 16px gutter around a 10px inset thumb", () => {
    expect(compact).toMatch(/::-webkit-scrollbar\{[^}]*width:16px;[^}]*height:16px/);
    expect(compact).toMatch(/::-webkit-scrollbar-thumb\{[^}]*border:3pxsolidtransparent/);
    expect(compact).toContain("scrollbar-width:auto");
  });

  it("uses readable text tokens and strengthens the whole owner in use", () => {
    expect(compact).toContain("--scrollbar-thumb:var(--text-soft-color)");
    expect(compact).toContain("--scrollbar-thumb-hover:var(--text-muted-color)");
    expect(compact).toContain("*:hover::-webkit-scrollbar-thumb");
    expect(compact).toContain("*:focus-within::-webkit-scrollbar-thumb");
    expect(compact).toContain("scrollbar-gutter:stable");
  });
});

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

  // One answer for a disabled control, not two. The app fades every disabled
  // button at 0.55; the toolbar button also swapped its ink, and the two together
  // left its label at about 1.5:1 — alone among the four roles that share this
  // anatomy.
  it("lets a disabled button recede without restating its ink", () => {
    expect(compact).not.toContain(".toolbar-button:disabled{");
    expect(compact).toMatch(/button:disabled,[^{]*\{[^}]*opacity:0\.55/);
  });
});
