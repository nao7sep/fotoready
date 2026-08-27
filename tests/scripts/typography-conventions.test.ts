import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/renderer/styles/app.css");
const css = readFileSync(cssPath, "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  expect(matches.length, `missing CSS rule for ${selector}`).toBeGreaterThan(0);
  return matches.map((match) => match[1]).join("\n");
}

describe("interface typography conventions", () => {
  it("owns the inherited UI font family and base size", () => {
    expect(css).toMatch(/--font-ui:\s*system-ui/);
    expect(css).toMatch(/:root\s*{[^}]*font-family:\s*var\(--font-ui\)/);
    expect(css).toMatch(/body\s*{[^}]*font-size:\s*13px/);
  });

  it.each([
    ".status-chip",
    ".row-detail",
    ".rename-preview-state",
    ".asset-picker-preview",
    ".field-help",
    ".shortcut-row-copy small",
  ])("keeps standing, control, and help text at the 12px compact floor: %s", (selector) => {
    expect(declarations(selector)).toMatch(/font-size:\s*12px/);
  });

  it("lets status and error labels inherit their 12px surface size", () => {
    expect(declarations(".status-bar")).toMatch(/font-size:\s*12px/);
    expect(declarations(".status-active-label")).not.toMatch(/font-size\s*:/);
    expect(declarations(".error-strip")).toMatch(/font-size:\s*12px/);
    expect(declarations(".error-strip strong")).not.toMatch(/font-size\s*:/);
  });

  it.each([
    ".preview-detail em",
    ".metadata-summary-row",
    ".rename-preview-meta",
    ".asset-picker-badge",
  ])("reserves the 11px floor for genuinely tertiary metadata: %s", (selector) => {
    expect(declarations(selector)).toMatch(/font-size:\s*11px/);
  });
});
