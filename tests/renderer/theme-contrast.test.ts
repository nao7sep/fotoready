import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every color pair the stylesheet draws keeps high contrast in both themes, by this app's own
// floor: 4.5:1 for text, 3:1 for a field's outline and for focus, selection, and status marks.
// Light tokens live in the top-level :root block; dark tokens in the :root block inside
// @media (prefers-color-scheme: dark).
const css = readFileSync(resolve("src/renderer/styles/app.css"), "utf8");

type Rgb = [number, number, number];

function themeBlock(theme: "light" | "dark"): string {
  if (theme === "light") {
    const start = css.search(/^:root\s*\{/m);
    return css.slice(css.indexOf("{", start), css.indexOf("\n}", start));
  }
  const media = css.indexOf("@media (prefers-color-scheme: dark) {");
  expect(media, "the dark theme must be a prefers-color-scheme block").toBeGreaterThanOrEqual(0);
  const start = css.indexOf("  :root {", media);
  return css.slice(css.indexOf("{", start), css.indexOf("\n  }", start));
}

function hexOf(block: string, token: string): Rgb {
  const value = block.match(new RegExp(`${token.replaceAll("-", "\\-")}\\s*:\\s*(#[0-9a-f]{6})\\s*;`, "i"))?.[1];
  expect(value, `${token} must be an opaque six-digit hex color`).toBeTruthy();
  return [1, 3, 5].map((offset) => Number.parseInt(value!.slice(offset, offset + 2), 16)) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const SURFACES = ["--app-bg", "--surface-bg", "--surface-raised-bg", "--surface-muted-bg", "--header-bg", "--status-bar-bg"];
const STATUS: ReadonlyArray<[string, string]> = [
  ["--idle-text", "--idle-soft-bg"],
  ["--saved-text", "--saved-soft-bg"],
  ["--info-text", "--info-soft-bg"],
  ["--danger-text", "--danger-soft-bg"],
  ["--warning-text", "--warning-soft-bg"]
];

const TEXT_PAIRS: ReadonlyArray<[string, string]> = [
  ...["--text-color", "--text-strong-color", "--text-muted-color"].flatMap((ink): Array<[string, string]> => SURFACES.map((surface) => [ink, surface])),
  ["--text-soft-color", "--app-bg"],
  ["--text-soft-color", "--surface-bg"],
  ["--text-soft-color", "--surface-raised-bg"],
  ["--text-color", "--button-bg"],
  ["--text-strong-color", "--button-bg"],
  ["--text-strong-color", "--button-active-bg"],
  ["--text-strong-color", "--menu-hover-bg"],
  ["--brand-primary-fill-text", "--brand-primary"],
  ["--brand-chrome-text", "--brand-chrome-bg"],
  ["--brand-primary-text", "--surface-bg"],
  ["--brand-primary-text", "--surface-raised-bg"],
  ["--text-color", "--brand-primary-soft-bg"],
  ["--brand-secondary-soft-text", "--brand-secondary-soft-bg"],
  ["--brand-secondary-soft-text", "--brand-secondary-soft-border"],
  ["--brand-secondary-soft-text", "--surface-raised-bg"],
  ["--accent-text", "--accent-bg"],
  ["--accent-text", "--accent-hover-bg"],
  ["--accent-text", "--accent-pressed-bg"],
  // Buttons and palette rows on their hover step, tab labels on the track, and field text.
  ["--text-strong-color", "--button-hover-bg"],
  ["--text-muted-color", "--track-bg"],
  ["--text-strong-color", "--field-bg"],
  ["--accent-soft-text", "--accent-soft-bg"],
  ["--accent-soft-text", "--surface-bg"],
  ["--accent-soft-text", "--button-bg"],
  ...STATUS.flatMap(([ink, tint]): Array<[string, string]> => [[ink, tint], [ink, "--surface-bg"], [ink, "--surface-raised-bg"]]),
  // A destructive CONFIRM button is filled, so its ink is read on that fill and
  // nowhere else — unlike a status colour, which is also read on the surface.
  ["--on-danger", "--danger-fill"],
  ["--on-danger", "--danger-fill-hover"]
];

const MARK_PAIRS: ReadonlyArray<[string, string]> = [
  ...SURFACES.map((surface): [string, string] => ["--field-border-color", surface]),
  ["--field-border-color", "--field-bg"],
  ["--selection-border-color", "--surface-raised-bg"],
  ["--accent-border", "--surface-bg"],
  ["--accent-border", "--surface-raised-bg"],
  ["--accent-bg", "--surface-bg"],
  ["--accent-bg", "--surface-raised-bg"],
  ["--text-soft-color", "--surface-muted-bg"],
  ["--brand-secondary", "--surface-muted-bg"]
];

describe("theme token contrast", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`keeps text at 4.5:1 or more in the ${theme} theme`, () => {
      const block = themeBlock(theme);
      for (const [foreground, background] of TEXT_PAIRS) {
        expect(contrast(hexOf(block, foreground), hexOf(block, background)), `${foreground} on ${background}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`keeps field outlines and focus, selection, and status marks at 3:1 or more in the ${theme} theme`, () => {
      const block = themeBlock(theme);
      for (const [foreground, background] of MARK_PAIRS) {
        expect(contrast(hexOf(block, foreground), hexOf(block, background)), `${foreground} on ${background}`)
          .toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("defines every light token again in the dark block", () => {
    const tokens = (block: string) => new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*#/g)].map((match) => match[1]));
    const dark = tokens(themeBlock("dark"));
    for (const token of tokens(themeBlock("light"))) {
      expect(dark.has(token), `${token} in the dark theme`).toBe(true);
    }
  });

  it("references only defined tokens", () => {
    // The asset picker sets its preview size inline from Settings at runtime.
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]).concat("--asset-picker-preview-size"));
    for (const [, token] of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
      expect(defined.has(token), `${token} is defined`).toBe(true);
    }
  });
});
