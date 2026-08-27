import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The renderer stylesheet must carry the global thin, rounded, palette-matched scroll bar required
// by the window-chrome conventions — a color-scheme declaration alone leaves the thick square OS
// default in place. Read the CSS text (the suite is environment: node, so there is no real
// stylesheet to query) and assert the load-bearing declarations are present, mirroring the
// content-security-policy guard's file-read pattern.
const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/renderer/styles/app.css");
const css = readFileSync(cssPath, "utf8");

describe("scroll-bar styling", () => {
  it("styles the WebKit/Chromium scroll bar (the OS default would otherwise stay thick and square)", () => {
    expect(css).toContain("::-webkit-scrollbar");
    expect(css).toContain("::-webkit-scrollbar-thumb");
  });

  it("declares the Firefox thin-bar shorthand alongside the pseudo-elements", () => {
    expect(css).toMatch(/scrollbar-width:\s*thin/);
    expect(css).toMatch(/scrollbar-color:/);
  });

  it("makes the thumb a rounded pill inset from the gutter", () => {
    // Rounded thumb.
    expect(css).toMatch(/::-webkit-scrollbar-thumb[\s\S]*?border-radius:/);
    // Inset pill: transparent border + background clipped to the padding box.
    expect(css).toMatch(/background-clip:\s*padding-box/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb[\s\S]*?border:\s*3px solid transparent/);
  });

  it("uses the palette scroll-bar tokens, brightening on hover", () => {
    expect(css).toContain("--scrollbar-thumb");
    expect(css).toContain("--scrollbar-thumb-hover");
    expect(css).toMatch(/::-webkit-scrollbar-thumb:hover[\s\S]*?var\(--scrollbar-thumb-hover\)/);
  });
});
